/**
 * Hubungkan nomor owner baru ke sesi agent (Yuki) nomor lama: `.agent login <nomor lama>`.
 *
 * Sesi agent (riwayat, file kerja, catatan, status `.agent on`) dikunci per pengirim lewat sessionKey().
 * Di sini nomor baru "ditautkan" ke nomor lama, jadi sessionKey() mengembalikan kunci nomor lama dan
 * semua ingatannya terbaca dari nomor baru. Data nomor lama tidak disalin atau diubah.
 *
 * Tautan disimpan di <OMP_AGENT_DIR>/link.json: { "<jid baru>": "<jid lama>" }.
 */
import crypto from 'node:crypto'
import fsSync from 'node:fs'
import path from 'node:path'

const ROOT = () => path.resolve(process.env.OMP_AGENT_DIR || path.join(process.cwd(), 'data', 'omp-agent'))
const FILE = () => path.join(ROOT(), 'link.json')
const MAX_HOPS = 5

let cache = null
let cacheFile = ''

function load() {
    const file = FILE()
    if (cache && cacheFile === file) return cache
    cacheFile = file
    try {
        const raw = JSON.parse(fsSync.readFileSync(file, 'utf8'))
        cache = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    } catch {
        cache = {}
    }
    return cache
}

function save(map) {
    fsSync.mkdirSync(ROOT(), { recursive: true })
    fsSync.writeFileSync(FILE(), JSON.stringify(map, null, 2), 'utf8')
    cache = map
}

/** Kunci sesi (12 hex) untuk satu pengirim, tanpa memperhitungkan tautan. */
export function hashKey(sender) {
    return crypto.createHash('sha1').update(String(sender || 'owner')).digest('hex').slice(0, 12)
}

/** "0851-9125-3733", "+62 851 9125 3733", "6285191253733" atau "1234@lid" → jid; selain itu null. */
export function normalizeSender(input) {
    const raw = String(input || '').trim().replace(/^@/, '')
    if (!raw) return null
    if (/^\d+@(s\.whatsapp\.net|lid)$/.test(raw)) return raw
    let digits = raw.replace(/[\s()+-]/g, '')
    if (!/^\d{8,16}$/.test(digits)) return null
    if (digits.startsWith('0')) digits = `62${digits.slice(1)}`
    return `${digits}@s.whatsapp.net`
}

/** Pengirim yang sesinya dipakai: ikuti tautan sampai ujung (aman dari siklus). */
export function resolveSender(sender) {
    const map = load()
    let current = String(sender || '')
    for (let i = 0; i < MAX_HOPS && map[current]; i++) current = map[current]
    return current || sender
}

export function getLink(sender) {
    return load()[String(sender || '')] || null
}

/** @returns {{ok:true}|{ok:false, error:string}} */
export function setLink(sender, target) {
    const from = String(sender || '')
    if (!from || !target) return { ok: false, error: 'pengirim/target kosong' }
    if (String(target) === from) return { ok: false, error: 'tidak bisa menautkan nomor ke dirinya sendiri' }
    const map = { ...load() }
    delete map[from]
    // Tolak bila target (lewat tautannya) berakhir di nomor ini: akan jadi siklus.
    let probe = String(target)
    for (let i = 0; i < MAX_HOPS && map[probe]; i++) probe = map[probe]
    if (probe === from) return { ok: false, error: 'tautan itu membentuk siklus' }
    map[from] = target
    save(map)
    return { ok: true }
}

export function removeLink(sender) {
    const map = { ...load() }
    const had = Boolean(map[String(sender || '')])
    delete map[String(sender || '')]
    if (had) save(map)
    return had
}

/** Apakah nomor ini sudah punya data sesi (dipakai untuk memperingatkan salah ketik nomor). */
export function hasSessionData(sender) {
    const key = hashKey(resolveSender(sender))
    const root = ROOT()
    return ['sessions', 'work', 'home'].some(dir => fsSync.existsSync(path.join(root, dir, key)))
        || fsSync.existsSync(path.join(root, 'notes', `${key}.md`))
}

const short = jid => String(jid).split('@')[0]

export const LINK_HELP = [
    '*Login nomor lama (`.agent login`)*',
    '• `.agent login <nomor lama>` — nomor ini memakai sesi, catatan & file kerja nomor lama',
    '• `.agent login` — lihat tautan nomor ini',
    '• `.agent logout` — lepas tautan (nomor ini kembali punya sesi sendiri)',
].join('\n')

/** Dipanggil plugins/ai/agent.js untuk `.agent login ...` dan `.agent logout`. Hanya owner (sudah dicek plugin). */
export async function handleLinkCommand(m, action, rest = '') {
    const me = m.sender
    if (action === 'logout') {
        return m.reply(removeLink(me)
            ? '🔓 Tautan dilepas. Nomor ini kembali memakai sesi agent sendiri. Data nomor lama tidak berubah.'
            : 'Nomor ini memang tidak sedang ditautkan ke nomor lain.')
    }
    const arg = String(rest || '').trim()
    if (!arg) {
        const link = getLink(me)
        return m.reply(link
            ? `🔗 Nomor ini memakai sesi *${short(resolveSender(me))}*.\nLepas: \`.agent logout\`.`
            : ['Nomor ini memakai sesi sendiri.', '', LINK_HELP].join('\n'))
    }
    const target = normalizeSender(arg)
    if (!target) return m.reply('❓ Nomor tidak valid. Contoh: `.agent login 6281234567890`')
    const result = setLink(me, target)
    if (!result.ok) return m.reply(`⛔ ${result.error}.`)
    const lines = [
        `🔗 *Login berhasil.* Nomor ini sekarang memakai sesi *${short(resolveSender(me))}*.`,
        'Riwayat, catatan, file kerja, dan status `.agent on` ikut nomor lama (dipakai bersama).',
        'Lepas: `.agent logout`.',
    ]
    if (!hasSessionData(me)) lines.push('', '⚠️ Nomor itu belum punya data sesi agent. Cek lagi nomornya bila salah ketik.')
    return m.reply(lines.join('\n'))
}
