/**
 * Gambar inline per-info untuk jawaban Yuki.
 *
 * Cara kerja (mirip banner animasi agentSection: satu bagian HTML di dalam pesan rich):
 *   1. Yuki menulis marker di baris sendiri, tepat SETELAH info yang butuh gambar:
 *        [[gambar: Genshin Impact Teyvat world map]]
 *        [[gambar: Genshin Impact Skyward Blade | https://.../skyward.png]]   (URL langsung, opsional)
 *   2. Bot memecah jawaban di marker -> teks, gambar, teks, gambar, ... (urutan terjaga).
 *   3. Tiap marker dicari/diunduh, dipotong ke 16:9 (atau 1:1 kalau gambar aslinya hampir persegi),
 *      dikecilkan, lalu ditanam base64 di bagian HTML pesan rich.
 *   4. Marker yang gagal dicari dibuang diam-diam (teks tetap utuh).
 *
 * Env: OMP_IMG=0 mematikan semua | OMP_IMG_MAX (default 4 gambar/jawaban) | OMP_IMG_MAX_KB (default 45 KB/gambar)
 *      OMP_IMG_TOTAL_KB (default 160 KB total) | OMP_IMG_SEARCH_URL (default API pinterest bot) | OMP_IMG_TIMEOUT_MS (default 12000)
 */
import dns from 'node:dns/promises'
import net from 'node:net'

const MARKER_RE = /\[\[\s*(?:gambar|img|image|foto)\s*:\s*([^\]\n]{2,300}?)\s*\]\]/gi
const DANGLING_RE = /\[\[\s*(?:gambar|img|image|foto)\b[^\]]*$/i

export const imgConfig = (env = process.env) => ({
    enabled: env.OMP_IMG !== '0',
    max: Math.max(1, Math.min(8, Number(env.OMP_IMG_MAX) || 4)),
    maxBytes: Math.max(12, Number(env.OMP_IMG_MAX_KB) || 45) * 1024,
    totalBytes: Math.max(24, Number(env.OMP_IMG_TOTAL_KB) || 160) * 1024,
    searchUrl: String(env.OMP_IMG_SEARCH_URL || 'https://theresapis.vercel.app/search/pinterest?q='),
    timeoutMs: Math.max(3000, Number(env.OMP_IMG_TIMEOUT_MS) || 12000),
})

// ── parsing ─────────────────────────────────────────────────────────────

/** "query | https://url" -> { query, url }. URL boleh juga berdiri sendiri. */
export function parseMarkerBody(body) {
    const raw = String(body || '').trim()
    const urlMatch = raw.match(/https?:\/\/[^\s|]+/i)
    const url = urlMatch ? urlMatch[0] : ''
    const query = raw.replace(url, '').replace(/[|]+/g, ' ').replace(/\s+/g, ' ').trim()
    return { query, url }
}

/** Pecah teks di marker. Hasil: [{type:'text', value}, {type:'img', query, url}, ...] sesuai urutan asli. */
export function splitImageMarkers(text) {
    const src = String(text || '').replace(DANGLING_RE, '')
    const out = []
    let last = 0
    let match
    MARKER_RE.lastIndex = 0
    while ((match = MARKER_RE.exec(src))) {
        const before = src.slice(last, match.index).trim()
        if (before) out.push({ type: 'text', value: before })
        const { query, url } = parseMarkerBody(match[1])
        if (query || url) out.push({ type: 'img', query, url })
        last = match.index + match[0].length
    }
    const tail = src.slice(last).trim()
    if (tail) out.push({ type: 'text', value: tail })
    return out
}

/** Hapus semua marker (untuk hitung panjang, versi lengkap/preview, atau saat gambar dimatikan). */
export function stripImageMarkers(text) {
    return String(text || '')
        .replace(MARKER_RE, '')
        .replace(DANGLING_RE, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

export const hasImageMarkers = text => { MARKER_RE.lastIndex = 0; return MARKER_RE.test(String(text || '')) }

// ── unduh aman ──────────────────────────────────────────────────────────

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./]
function isPrivateIp(ip) {
    if (net.isIPv4(ip)) return PRIVATE_V4.some(re => re.test(ip))
    if (net.isIPv6(ip)) return /^(::1?$|fc|fd|fe80|::ffff:(10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\.)/i.test(ip)
    return true
}

/** https/http publik saja; host yang menunjuk ke IP privat/lokal ditolak (anti-SSRF, karena URL bisa datang dari agent). */
export async function assertPublicUrl(url, lookup = dns.lookup) {
    const u = new URL(url)
    if (!/^https?:$/.test(u.protocol)) throw new Error('protokol tidak didukung')
    const host = u.hostname.replace(/^\[|\]$/g, '')
    if (/^localhost$|\.local$|\.internal$/i.test(host)) throw new Error('host lokal')
    if (net.isIP(host)) {
        if (isPrivateIp(host)) throw new Error('IP privat')
        return u
    }
    const addrs = await lookup(host, { all: true })
    if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('host mengarah ke IP privat')
    return u
}

async function downloadImage(url, { timeoutMs, maxBytes = 6 * 1024 * 1024, lookup }) {
    let current = (await assertPublicUrl(url, lookup)).href
    for (let hop = 0; hop < 3; hop++) {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), timeoutMs)
        try {
            const res = await fetch(current, {
                signal: ctrl.signal, redirect: 'manual',
                headers: { 'user-agent': 'Mozilla/5.0 (compatible; YukiBot/1.0)', accept: 'image/*,*/*;q=0.5' },
            })
            if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
                current = (await assertPublicUrl(new URL(res.headers.get('location'), current).href, lookup)).href
                continue
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const len = Number(res.headers.get('content-length') || 0)
            if (len > maxBytes) throw new Error('gambar terlalu besar')
            const buf = Buffer.from(await res.arrayBuffer())
            if (buf.length > maxBytes) throw new Error('gambar terlalu besar')
            return buf
        } finally {
            clearTimeout(timer)
        }
    }
    throw new Error('terlalu banyak redirect')
}

/** Cari kandidat URL gambar lewat API pencarian bot (format pinterest: { result: [{directLink|link}] }). */
export async function searchImageUrls(query, { searchUrl, timeoutMs, max = 6 } = imgConfig()) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
        const res = await fetch(searchUrl + encodeURIComponent(query), { signal: ctrl.signal })
        if (!res.ok) throw new Error(`pencarian HTTP ${res.status}`)
        const data = await res.json()
        const list = Array.isArray(data?.result) ? data.result : []
        return list.map(item => item?.directLink || item?.link).filter(u => typeof u === 'string' && /^https?:\/\//i.test(u)).slice(0, max)
    } finally {
        clearTimeout(timer)
    }
}

// ── bentuk & ukuran ─────────────────────────────────────────────────────

/** Gambar hampir persegi (rasio 0.85–1.18) tetap 1:1; selain itu dipotong 16:9. */
export function pickShape(width, height) {
    const ratio = width / height
    return ratio >= 0.85 && ratio <= 1.18 ? 'square' : 'wide'
}

const SHAPES = {
    // px = ukuran file (tajam di HP), cssMax = lebar maksimum di layar (sengaja kecil supaya tidak memenuhi layar)
    wide: { ratio: [16, 9], steps: [[480, 270, 72], [416, 234, 62], [352, 198, 52], [288, 162, 44]], cssMax: 320 },
    square: { ratio: [1, 1], steps: [[300, 300, 72], [260, 260, 62], [220, 220, 52], [180, 180, 44]], cssMax: 180 },
}

/** Potong + kecilkan sampai muat maxBytes. @returns {{buffer,width,height,shape}} */
export async function fitImage(input, { maxBytes = 45 * 1024, sharpLib } = {}) {
    const sharp = sharpLib || (await import('sharp')).default
    const meta = await sharp(input, { failOn: 'none' }).metadata()
    if (!meta.width || !meta.height) throw new Error('bukan gambar')
    if (meta.width < 120 || meta.height < 90) throw new Error('gambar terlalu kecil')
    const shape = pickShape(meta.width, meta.height)
    const cfg = SHAPES[shape]
    for (const [w, h, q] of cfg.steps) {
        const buffer = await sharp(input, { failOn: 'none' })
            .rotate()
            .resize(w, h, { fit: 'cover', position: sharp.strategy.attention })
            .flatten({ background: '#202124' })
            .jpeg({ quality: q, mozjpeg: true })
            .toBuffer()
        if (buffer.length <= maxBytes) return { buffer, width: w, height: h, shape }
    }
    throw new Error('gambar tidak bisa diperkecil')
}

/** Bagian HTML satu gambar (base64). Lebar dibatasi supaya tidak memenuhi layar; 1:1 lebih kecil dari 16:9. */
export function inlineImgHtml({ buffer, width, height, shape }) {
    const cssMax = (SHAPES[shape] || SHAPES.wide).cssMax
    return '<!doctype html><html><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<style>html,body{margin:0;padding:0;background:transparent}body{padding:2px 0}' +
        `.s{width:100%;max-width:${cssMax}px;aspect-ratio:${width}/${height};border-radius:12px;overflow:hidden;background:#2a2a2f}` +
        '.s img{display:block;width:100%;height:100%;object-fit:cover}</style></head><body>' +
        `<div class="s"><img alt="gambar" src="data:image/jpeg;base64,${Buffer.from(buffer).toString('base64')}"></div></body></html>`
}

export function imgSection(image) {
    return {
        view_model: {
            __typename: 'GenAISingleLayoutViewModel',
            primitive: {
                __typename: 'FOAHtmlPrimitiveDemoDONOTUSE',
                trusted_sources: [],
                payload: inlineImgHtml(image),
            },
        },
    }
}

// ── resolusi semua marker ───────────────────────────────────────────────

/**
 * Cari & siapkan gambar untuk semua bagian type:'img'. Mengembalikan array sejajar dengan `parts`
 * (null untuk bagian teks atau gambar yang gagal). Batas jumlah & total byte ditegakkan berurutan.
 * Dependensi bisa disuntik (test): { search, download, fit, lookup }.
 */
export async function resolveImageParts(parts, { cfg = imgConfig(), search, download, fit, lookup, onError } = {}) {
    const doSearch = search || (query => searchImageUrls(query, cfg))
    const doDownload = download || (url => downloadImage(url, { timeoutMs: cfg.timeoutMs, lookup }))
    const doFit = fit || (buf => fitImage(buf, { maxBytes: cfg.maxBytes }))
    const used = new Set()

    const wanted = []
    parts.forEach((part, index) => { if (part.type === 'img' && wanted.length < cfg.max) wanted.push(index) })

    const one = async index => {
        const { query, url } = parts[index]
        const candidates = []
        if (url) candidates.push(url)
        if (query) {
            try { candidates.push(...await doSearch(query)) } catch (error) { onError?.(error, `cari "${query}"`) }
        }
        let tries = 0
        for (const candidate of candidates) {
            if (used.has(candidate) || tries >= 4) continue
            tries++
            used.add(candidate) // diklaim dulu supaya marker paralel tidak memilih gambar yang sama
            try {
                return await doFit(await doDownload(candidate))
            } catch (error) { onError?.(error, candidate) }
        }
        return null
    }

    const results = await Promise.all(wanted.map(one))
    const out = parts.map(() => null)
    let total = 0
    wanted.forEach((index, i) => {
        const image = results[i]
        if (!image || total + image.buffer.length > cfg.totalBytes) return
        total += image.buffer.length
        out[index] = image
    })
    return out
}
