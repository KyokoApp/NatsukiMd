// ============================================================
//  lib/omp-anim-live.js — animasi OMP yang selalu berubah
//
//  Dibanding omp-agent-anim.js (6 layout tetap), modul ini:
//   1. Mengacak tampilan tiap kali dirender: 14 palet warna, judul, ikon, dan teks status
//      dari kumpulan besar, jadi tidak pernah persis sama.
//   2. Punya scene tambahan: radar, hujan kode, equalizer, rasi bintang, terminal log,
//      plus layar "selesai" dan "gagal".
//   3. Memilih scene menurut kebutuhan (mode chat/html/zip/link/gambar/plugin, sedang
//      mencari web atau tidak) dan menghindari scene yang sama dengan sebelumnya.
//   4. Mode "pipeline": node = langkah rencana asli (cari web, gambar, build, preview).
//      Tiap langkah berganti, animasinya ikut diganti real-time (✅ selesai, ⏳ aktif)
//      dan strip aktivitas di bawahnya menyesuaikan jenis langkah yang sedang jalan.
//   5. createLiveAnim(): mengganti section animasi di pesan AIRich secara berkala
//      (ticker) atau saat status berubah, dengan antrean supaya edit tidak saling tabrak.
//
//  Murni HTML + CSS + SVG, tanpa gambar eksternal. Teks dinamis selalu di-escape.
// ============================================================
import { build, STYLES as BASE } from './omp-agent-anim.js'

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const clipText = (value, max) => esc(String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max))
const f1 = (n) => Number(n).toFixed(1)

function mulberry32(seed) {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
const pick = (r, list) => list[Math.floor(r() * list.length)]
const range = (r, a, b) => a + r() * (b - a)
function pickN(r, list, n) {
    const copy = [...list]
    const out = []
    while (out.length < n && copy.length) out.push(copy.splice(Math.floor(r() * copy.length), 1)[0])
    return out
}

// ------------------------------------------------------------
//  Bahan acak
// ------------------------------------------------------------
export const PALETTES = [
    { ac: '#ffd23f', gl: '#ffb300', c3: '#fb923c' }, { ac: '#38bdf8', gl: '#0ea5e9', c3: '#818cf8' },
    { ac: '#4ade80', gl: '#22c55e', c3: '#2dd4bf' }, { ac: '#f472b6', gl: '#ec4899', c3: '#c084fc' },
    { ac: '#c084fc', gl: '#a855f7', c3: '#38bdf8' }, { ac: '#fb923c', gl: '#f97316', c3: '#fde047' },
    { ac: '#22d3ee', gl: '#06b6d4', c3: '#4ade80' }, { ac: '#fb7185', gl: '#f43f5e', c3: '#fbbf24' },
    { ac: '#a3e635', gl: '#84cc16', c3: '#22d3ee' }, { ac: '#e879f9', gl: '#d946ef', c3: '#f472b6' },
    { ac: '#2dd4bf', gl: '#14b8a6', c3: '#60a5fa' }, { ac: '#818cf8', gl: '#6366f1', c3: '#f0abfc' },
    { ac: '#fbbf24', gl: '#f59e0b', c3: '#f87171' }, { ac: '#86efac', gl: '#4ade80', c3: '#fde68a' },
]

const TITLES = {
    chat: ['BUILD AI AGENTS', 'OMP SEDANG BERPIKIR', 'AGENT AKTIF', 'RACIK JAWABAN', 'OTAK OMP ONLINE', 'MODE MIKIR KERAS', 'AI WORKFLOW'],
    html: ['BUILD HTML APP', 'BANGUN HALAMAN', 'PABRIK WEB', 'RACIK UI', 'CODE FORGE', 'RAKIT PROJECT', 'STUDIO OMP'],
    zip: ['ANALISIS ZIP', 'BONGKAR ARSIP', 'SCAN PROJECT', 'ZIP INSPECTOR', 'MEMBEDAH KODE'],
    link: ['BACA LINK', 'WEB READER', 'JELAJAH HALAMAN', 'PANEN INFO WEB', 'RADAR TAUTAN'],
    image: ['ANALISIS GAMBAR', 'MATA OMP', 'VISION MODE', 'PINDAI VISUAL', 'LIHAT DETAIL'],
    plugin: ['PLUGIN AGENT', 'BONGKAR FITUR', 'PLUGIN LAB', 'SCAN COMMAND', 'ORBIT PLUGIN'],
    pipeline: ['MULTI-LANGKAH', 'PIPELINE OMP', 'RENCANA AKSI', 'JALUR KERJA', 'AUTO WORKFLOW', 'ALUR PROJECT'],
    done: ['SELESAI', 'BERES!', 'HASIL SIAP'],
    fail: ['ADA KENDALA', 'BELUM BERHASIL'],
}
const S0 = ['⚙️ Menyiapkan agent…', '🔌 Menghubungkan modul…', '🧪 Memanaskan mesin…', '☕ Menyeduh ide…', '🛰️ Menyelaraskan sinyal…', '🧭 Menentukan arah…']
const STATUS = {
    chat: ['📥 Membaca pesan…', '🧠 Memanggil model…', '🔧 Menimbang tools…', '✍️ Menyusun jawaban…', '🧩 Merangkai konteks…', '🔎 Mengecek fakta…', '💭 Mikir sebentar…', '🪄 Memoles kalimat…', '🧹 Merapikan hasil…', '📡 Menunggu model…'],
    html: ['🎨 Merancang layout…', '⌨️ Menulis kode…', '📱 Menyesuaikan layar HP…', '🔍 Mengecek dan merevisi…', '🧱 Menyusun komponen…', '🌈 Memilih palet warna…', '🕹️ Memasang kontrol…', '✨ Menambah animasi…', '🧪 Menguji tampilan…', '📦 Membungkus satu file…'],
    zip: ['🗂️ Memindai struktur…', '🔎 Membaca isi file…', '🧾 Merangkum…', '📂 Membuka folder…', '🧬 Melacak dependensi…', '🧩 Menyambung antar file…', '🧹 Menyaring file biner…'],
    link: ['🌐 Mengambil halaman…', '🔎 Mengekstrak isi…', '✍️ Merangkum…', '🧼 Membersihkan teks…', '🔗 Menelusuri tautan…', '📄 Membaca judul dan meta…'],
    image: ['👁️ Memindai gambar…', '🔎 Mengenali objek dan teks…', '✍️ Menyusun deskripsi…', '🎯 Mencari detail kecil…', '🔤 Membaca tulisan…', '🌈 Mengamati warna…'],
    plugin: ['🔌 Menghubungkan plugin…', '⚙️ Menjalankan tools…', '✍️ Menyusun hasil…', '🧩 Mencocokkan command…', '📜 Membaca alur kode…', '🛰️ Memetakan fitur…'],
    search: ['🔎 Menelusuri web…', '📰 Membaca hasil pencarian…', '🧼 Menyaring sumber…', '🧾 Meringkas temuan…', '🧭 Memilah yang relevan…', '📡 Menunggu hasil…'],
    image_step: ['🎨 Mencampur warna…', '🖌️ Menggambar detail…', '🧪 Meracik komposisi…', '✨ Memoles cahaya…', '🖼️ Menyiapkan kanvas…', '🔬 Mengasah ketajaman…'],
    build_step: ['🎨 Merancang layout…', '⌨️ Menulis kode…', '📱 Menyesuaikan layar HP…', '🧱 Menyusun komponen…', '🕹️ Memasang kontrol…', '🔍 Mengecek dan merevisi…'],
    preview_step: ['🌐 Menyiapkan preview…', '📦 Menanam gambar ke halaman…', '🧪 Menyesuaikan ukuran layar…'],
    plan: ['🧭 Menyusun rencana…', '🧠 Memilih langkah terbaik…', '📋 Menentukan urutan kerja…'],
}
const LABEL = { chat: 'Berpikir', html: 'Menulis kode', zip: 'Membaca ZIP', link: 'Membaca web', image: 'Melihat gambar', plugin: 'Memeriksa plugin', feature: 'Memeriksa plugin' }
const ICONS = {
    agent: ['🤖', '🧠', '🦾', '👾', '🛰️', '🪄', '🐙', '🦊'], hub: ['🌐', '🕸️', '📡', '🛰️'],
    tool: ['🔧', '🛠️', '🧰', '🔩', '⚡', '🧲'], model: ['🧠', '💡', '🔮', '🧬'], mem: ['💾', '🗃️', '📚', '🧷'],
    msg: ['⚡', '📨', '💌', '🔔'], reply: ['💬', '📤', '✉️', '🎯'], d: ['🎨', '📐', '🖌️'], k: ['⌨️', '🧑‍💻', '📝'], v: ['🌐', '🖥️', '📱'],
}
const TERM = {
    chat: ['> baca pesan …ok', '> muat memori [%n item]', '> pilih model → %m', '> cek web_search …lewati', '> susun jawaban (%n token)', '> saring keluaran …ok', '> kirim ✔'],
    html: ['> rancang grid %nx%n', '> palet #%h #%h', '> tulis <style> …%nkb', '> tulis <script> …%nkb', '> cek viewport …ok', '> responsif 320→1024 …ok', '> bungkus satu file …ok', '> preview siap'],
    zip: ['> unzip -t …ok', '> pindai %n entri', '> lewati aset biner', '> baca package.json', '> indeks %n file', '> rangkum struktur …'],
    link: ['> GET halaman …200', '> ekstrak teks (%n kb)', '> buang skrip dan iklan', '> baca judul + meta', '> telusuri %n tautan', '> rangkum …'],
    image: ['> muat gambar …ok', '> deteksi objek [%n]', '> OCR teks …ok', '> baca warna dominan #%h', '> susun deskripsi …'],
    plugin: ['> baca plugins/…', '> cocokkan command …ok', '> petakan %n handler', '> cek akses owner …ok', '> ringkas fungsi …'],
}
const RAIN = '01<>{}/=;+*#$%'.split('')

// ------------------------------------------------------------
//  Scene baru
// ------------------------------------------------------------
const AGENT_POP = (x, y, r, emoji, name) => `<g class="ag" style="opacity:0;animation-delay:0.3s,1.2s">
  <circle cx="${x}" cy="${y}" r="${r}" fill="#38383d" stroke="var(--ac)" stroke-width="2.5"/>
  <text x="${x}" y="${y + (name ? -2 : 7)}" text-anchor="middle" font-size="${name ? 22 : 24}">${emoji}</text>
  ${name ? `<text x="${x}" y="${y + 17}" text-anchor="middle" font-size="10" font-weight="800" fill="#fff">${name}</text>` : ''}
</g>`

function radarScene(r, ctx, kind) {
    const blips = Array.from({ length: 8 }, () => {
        const a = r() * Math.PI * 2
        const d = range(r, 34, 86)
        return `<circle class="bp" cx="${f1(180 + Math.cos(a) * d)}" cy="${f1(115 + Math.sin(a) * d * 0.9)}" r="${f1(range(r, 2.5, 4.5))}" style="animation-delay:${f1(range(r, 0, 3))}s"/>`
    }).join('')
    const svg = `<g class="fade" style="animation-delay:.2s">
  <circle cx="180" cy="115" r="30" class="base"/><circle cx="180" cy="115" r="60" class="base"/><circle cx="180" cy="115" r="90" class="base"/>
  <line x1="90" y1="115" x2="270" y2="115" class="base" stroke-dasharray="3 5"/><line x1="180" y1="25" x2="180" y2="205" class="base" stroke-dasharray="3 5"/>
</g>
<g class="sw"><path d="M180 115 L270 115 A90 90 0 0 0 248.9 57.1 Z" fill="var(--ac)" opacity=".22"/><line x1="180" y1="115" x2="270" y2="115" stroke="var(--ac)" stroke-width="2" stroke-linecap="round"/></g>
${blips}
${AGENT_POP(180, 115, 22, pick(r, ['🔎', '📡', '🛰️']))}`
    return {
        svg, loop: 7,
        css: `.sw{transform-origin:180px 115px;animation:sweep 3.2s linear infinite}@keyframes sweep{to{transform:rotate(360deg)}}
.bp{fill:var(--ac);opacity:0;filter:drop-shadow(0 0 3px var(--gl));animation:blip 3.2s ease-out infinite}
@keyframes blip{0%{opacity:1;transform:scale(1.8)}60%{opacity:.25}100%{opacity:0}}`,
    }
}

function rainScene(r, ctx, kind) {
    const cols = Array.from({ length: 13 }, (_, i) => {
        const x = 16 + i * 27
        const chars = Array.from({ length: 6 }, (__, j) => `<text x="${x}" y="${j * 14}" opacity="${f1(0.15 + j * 0.16)}">${esc(pick(r, RAIN))}</text>`).join('')
        return `<g class="rn" style="animation-duration:${f1(range(r, 2, 4.2))}s;animation-delay:-${f1(range(r, 0, 4))}s">${chars}</g>`
    }).join('')
    const svg = `<g font-family="monospace" font-size="13" fill="var(--ac)">${cols}</g>
<g class="nd" style="animation-delay:.3s"><rect class="gw" x="100" y="80" width="160" height="70" rx="16" fill="#2b2b30" fill-opacity=".94" stroke="var(--ac)" stroke-width="2"/>
<text x="180" y="108" text-anchor="middle" font-size="24">${pick(r, ICONS.agent)}</text>
<text x="180" y="132" text-anchor="middle" font-size="12" font-weight="800" fill="#fff">${esc(LABEL[kind] || 'Bekerja')}…</text></g>`
    return {
        svg, loop: 7,
        css: `.rn{animation:rain 3s linear infinite}@keyframes rain{0%{transform:translateY(-90px)}100%{transform:translateY(250px)}}
.gw{animation:glow 2.4s ease-in-out infinite}`,
    }
}

function equalizerScene(r, ctx, kind) {
    const bars = Array.from({ length: 19 }, (_, i) => `<rect class="eq" x="${28 + i * 17}" y="100" width="10" height="92" rx="5" fill="${i % 3 === 0 ? 'var(--ac)' : i % 3 === 1 ? 'var(--c3)' : 'var(--gl)'}" style="animation-duration:${f1(range(r, 0.7, 1.7))}s;animation-delay:-${f1(range(r, 0, 1.6))}s"/>`).join('')
    const svg = `${bars}
<g class="ag" style="opacity:0;animation-delay:0.3s,1.2s"><text x="180" y="66" text-anchor="middle" font-size="34">${pick(r, ICONS.agent)}</text></g>
<text x="180" y="96" text-anchor="middle" class="lb" font-size="11">${esc(LABEL[kind] || 'Bekerja')}…</text>`
    return {
        svg, loop: 7,
        css: `.eq{transform-box:fill-box;transform-origin:center bottom;animation:eq 1.1s ease-in-out infinite}
@keyframes eq{0%,100%{transform:scaleY(.12)}50%{transform:scaleY(1)}}`,
    }
}

function constellationScene(r, ctx, kind) {
    const pts = []
    while (pts.length < 9) {
        const x = range(r, 26, 334)
        const y = range(r, 22, 208)
        if (Math.hypot(x - 180, y - 115) < 52) continue
        if (pts.some(p => Math.hypot(p.x - x, p.y - y) < 36)) continue
        pts.push({ x, y })
    }
    const edges = new Set()
    pts.forEach((p, i) => {
        pts.map((q, j) => ({ j, d: Math.hypot(p.x - q.x, p.y - q.y) })).filter(o => o.j !== i).sort((a, b) => a.d - b.d).slice(0, 2).forEach(o => edges.add(i < o.j ? `${i}-${o.j}` : `${o.j}-${i}`))
    })
    const paths = [...edges].map(key => {
        const [a, b] = key.split('-').map(Number)
        return `M${f1(pts[a].x)} ${f1(pts[a].y)} L${f1(pts[b].x)} ${f1(pts[b].y)}`
    })
    pickN(r, pts, 4).forEach(p => paths.push(`M180 115 L${f1(p.x)} ${f1(p.y)}`))
    const lines = paths.map(d => `<path d="${d}" class="base fade" stroke-dasharray="3 5" style="animation-delay:${f1(range(r, 0.2, 1.4))}s"/>`).join('')
    const flows = pickN(r, paths, 5).map(d => `<path class="pl" d="${d}" pathLength="100" style="animation-delay:${f1(range(r, 0, 6))}s"/>`).join('')
    const stars = pts.map(p => `<circle class="tw" cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(range(r, 3, 5.5))}" style="animation-delay:${f1(range(r, 0, 2.4))}s"/>`).join('')
    return {
        svg: `${lines}${flows}${stars}${AGENT_POP(180, 115, 28, pick(r, ICONS.agent), 'OMP')}`, loop: 7,
        css: `.tw{fill:var(--ac);opacity:.3;animation:tw 2.4s ease-in-out infinite}@keyframes tw{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1.25)}}`,
    }
}

function fill(template, r) {
    return template.replace(/%h/g, () => Math.floor(r() * 0xffffff).toString(16).padStart(6, '0')).replace(/%n/g, () => String(2 + Math.floor(r() * 98))).replace(/%m/g, () => pick(r, ['gemini', 'claude', 'gpt', 'kimi', 'qwen']))
}

function terminalScene(r, ctx, kind) {
    const lines = (TERM[kind === 'feature' ? 'plugin' : kind] || TERM.chat)
    const chosen = pickN(r, lines, Math.min(7, lines.length)).map(line => fill(line, r))
    const colors = ['#4ade80', 'var(--ac)', '#9ca3af', '#e5e7eb']
    const text = chosen.map((line, i) => `<text class="tl" x="34" y="${70 + i * 17}" fill="${pick(r, colors)}" style="animation-delay:${f1(i * 0.8)}s">${esc(line)}</text>`).join('')
    const svg = `<g class="nd" style="animation-delay:.2s"><rect x="20" y="24" width="320" height="182" rx="12" fill="#232327" stroke="#55555b" stroke-width="1.5"/>
<circle cx="36" cy="38" r="3.5" fill="#ff5f57"/><circle cx="48" cy="38" r="3.5" fill="#febc2e"/><circle cx="60" cy="38" r="3.5" fill="#28c840"/>
<text x="180" y="42" text-anchor="middle" font-size="10" fill="#9ca3af" font-family="monospace">omp@${esc(kind)} ~ ${esc(LABEL[kind] || 'agent').toLowerCase()}</text>
<line x1="20" y1="52" x2="340" y2="52" stroke="#3a3a40"/></g>
<g font-family="monospace" font-size="10.5">${text}<rect class="cur" x="34" y="${70 + chosen.length * 17 - 9}" width="7" height="12" fill="var(--ac)"/></g>`
    return {
        svg, loop: 8,
        css: `.tl{opacity:0;animation:tline 8s ease-in-out infinite}@keyframes tline{0%{opacity:0;transform:translateX(-6px)}6%,86%{opacity:1;transform:none}96%,100%{opacity:0}}
.cur{animation:cur 1s steps(1) infinite}@keyframes cur{50%{opacity:0}}`,
    }
}

// ------------------------------------------------------------
//  Pipeline: node = langkah rencana asli, update real-time
// ------------------------------------------------------------
const STEP_ICON = { search: '🔎', image: '🎨', build: '🧱', preview: '🌐' }

function stepShort(step) {
    if (step.type === 'search') return 'Cari web'
    if (step.type === 'image') return clipText(step.id || 'Gambar', 8)
    if (step.type === 'preview') return 'Preview'
    return 'Tulis'
}

function stripFor(type, r) {
    if (type === 'search') {
        const rings = [0, 0.8, 1.6].map(d => `<circle class="rg" cx="180" cy="188" r="26" style="animation-delay:${d}s"/>`).join('')
        return `${rings}<text x="180" y="197" text-anchor="middle" font-size="24">🔎</text>`
    }
    if (type === 'image') {
        const cells = []
        for (let row = 0; row < 3; row++) for (let col = 0; col < 12; col++) {
            cells.push(`<rect class="px" x="${60 + col * 20}" y="${160 + row * 20}" width="16" height="16" rx="3" fill="${pick(r, ['var(--ac)', 'var(--c3)', 'var(--gl)', '#fff'])}" style="animation-duration:${f1(range(r, 1.1, 2.6))}s;animation-delay:-${f1(range(r, 0, 2.6))}s"/>`)
        }
        return cells.join('')
    }
    if (type === 'build') {
        const colors = ['#38bdf8', '#c084fc', '#4ade80', '#fbbf24', '#f472b6']
        return Array.from({ length: 5 }, (_, i) => `<rect class="tb" x="${70 + (i % 2) * 18}" y="${160 + i * 11}" width="${60 + Math.floor(r() * 150)}" height="6" rx="3" fill="${colors[i]}" style="animation-delay:${f1(i * 0.35)}s"/>`).join('')
    }
    if (type === 'preview') {
        return `<rect x="90" y="156" width="180" height="56" rx="10" fill="#2a2a2f" stroke="#55555b" stroke-width="1.5"/>
<circle cx="104" cy="168" r="3" fill="#ff5f57"/><circle cx="115" cy="168" r="3" fill="#febc2e"/><circle cx="126" cy="168" r="3" fill="#28c840"/>
<rect x="104" y="184" width="152" height="8" rx="4" fill="#3a3a40"/><rect class="ld" x="104" y="184" width="152" height="8" rx="4" fill="var(--ac)"/>`
    }
    return `<text x="180" y="196" text-anchor="middle" font-size="26" class="tw">🧭</text>`
}

function stepperScene(r, ctx) {
    const raw = Array.isArray(ctx.plan?.steps) ? ctx.plan.steps : []
    const steps = [...raw.map(s => ({ ...s })), { type: 'preview' }]
    const N = steps.length
    const states = ctx.states || {}
    const stateOf = (i) => {
        if (steps[i].type !== 'preview') return states[i] || 'wait'
        if (ctx.finished) return 'done'
        return states[N - 2] === 'done' ? 'start' : 'wait'
    }
    const stList = steps.map((_, i) => stateOf(i))
    const act = stList.findIndex(s => s === 'start')
    const doneCount = stList.filter(s => s === 'done').length
    const R = N > 4 ? 19 : 23
    const xs = steps.map((_, i) => (N === 1 ? 180 : 38 + i * (284 / (N - 1))))
    const y = 66

    let edges = ''
    for (let i = 0; i < N - 1; i++) {
        const d = `M${f1(xs[i] + R)} ${y} H${f1(xs[i + 1] - R)}`
        const solid = stList[i] === 'done'
        edges += `<path d="${d}" fill="none" stroke="${solid ? '#4ade80' : '#8b8b92'}" stroke-width="2"${solid ? '' : ' stroke-dasharray="4 4"'}/>`
        if (solid && stList[i + 1] === 'start') edges += `<path class="pl" d="${d}" pathLength="100" style="animation-delay:0s"/>`
    }
    const nodes = steps.map((step, i) => {
        const st = stList[i]
        const stroke = st === 'done' ? '#4ade80' : st === 'fail' ? '#f87171' : st === 'start' ? 'var(--ac)' : '#55555b'
        const ring = st === 'start' ? `<circle class="spin" cx="${f1(xs[i])}" cy="${y}" r="${R + 6}" fill="none" stroke="var(--ac)" stroke-width="2" stroke-dasharray="6 8" style="transform-origin:${f1(xs[i])}px ${y}px"/>` : ''
        const badge = st === 'done' ? `<circle cx="${f1(xs[i] + R * 0.75)}" cy="${f1(y - R * 0.75)}" r="7" fill="#22c55e"/><text x="${f1(xs[i] + R * 0.75)}" y="${f1(y - R * 0.75 + 3.5)}" text-anchor="middle" font-size="9" font-weight="900" fill="#fff">✓</text>`
            : st === 'fail' ? `<circle cx="${f1(xs[i] + R * 0.75)}" cy="${f1(y - R * 0.75)}" r="7" fill="#ef4444"/><text x="${f1(xs[i] + R * 0.75)}" y="${f1(y - R * 0.75 + 3.5)}" text-anchor="middle" font-size="9" font-weight="900" fill="#fff">!</text>` : ''
        return `<g class="nd" style="animation-delay:${f1(i * 0.07)}s;opacity:${st === 'wait' ? 0.55 : 1}">${ring}
<circle cx="${f1(xs[i])}" cy="${y}" r="${R}" fill="#38383d" stroke="${stroke}" stroke-width="2.5"${st === 'start' ? ' class="gw"' : ''}/>
<text x="${f1(xs[i])}" y="${y + 7}" text-anchor="middle" font-size="${R > 20 ? 19 : 17}">${STEP_ICON[step.type] || '▫️'}</text>${badge}
<text x="${f1(xs[i])}" y="${y + R + 15}" text-anchor="middle" class="lb" font-size="9.5">${stepShort(step)}</text></g>`
    }).join('')

    const actStep = act >= 0 ? steps[act] : null
    let caption = ctx.finished ? '✅ Semua langkah selesai' : '🧭 Menyusun rencana…'
    if (actStep?.type === 'search') caption = `🔎 Mencari: ${clipText(actStep.query, 34)}`
    else if (actStep?.type === 'image') caption = `🎨 Membuat gambar “${clipText(actStep.id, 14)}”`
    else if (actStep?.type === 'build') caption = '🧱 Menulis project…'
    else if (actStep?.type === 'preview') caption = '🌐 Menyiapkan preview…'
    else if (stList.includes('fail') && act < 0 && !ctx.finished) caption = '⚠️ Ada langkah yang dilewati'

    const pool = STATUS[actStep ? `${actStep.type}_step`.replace('search_step', 'search') : 'plan'] || STATUS.plan
    const barW = Math.round(288 * (doneCount / N))
    const stripType = actStep?.type || (ctx.finished ? 'none' : 'plan')
    const svg = `${edges}${nodes}
<rect x="36" y="118" width="288" height="6" rx="3" fill="#3a3a40"/><rect x="36" y="118" width="${barW}" height="6" rx="3" fill="var(--ac)"/>
<text x="180" y="144" text-anchor="middle" font-size="12" font-weight="800" fill="currentColor">${caption}</text>
<g>${stripFor(stripType, r)}</g>`
    return {
        svg, loop: 7, s0: caption.replace(/[“”]/g, '"'), status: pickN(r, pool, 3),
        css: `.spin{animation:spin 4s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.gw{animation:glow 2.2s ease-in-out infinite}
.rg{fill:none;stroke:var(--ac);stroke-width:2;transform-box:fill-box;transform-origin:center;opacity:0;animation:rg 2.4s ease-out infinite}@keyframes rg{0%{transform:scale(.3);opacity:.9}100%{transform:scale(1.7);opacity:0}}
.px{opacity:.08;animation:px 1.8s ease-in-out infinite}@keyframes px{0%,100%{opacity:.08}50%{opacity:.9}}
.tb{transform-box:fill-box;transform-origin:left center;transform:scaleX(0);animation:tb 3.2s ease-in-out infinite}@keyframes tb{0%{transform:scaleX(0)}35%,80%{transform:scaleX(1)}95%,100%{transform:scaleX(0)}}
.ld{transform-box:fill-box;transform-origin:left center;animation:ld 2.2s ease-in-out infinite}@keyframes ld{0%{transform:scaleX(.05)}90%,100%{transform:scaleX(1)}}
.tw{animation:twk 2s ease-in-out infinite}@keyframes twk{0%,100%{opacity:.5}50%{opacity:1}}`,
    }
}

function endScene(kind, r) {
    const ok = kind === 'done'
    const dots = ok ? Array.from({ length: 14 }, () => {
        const a = r() * Math.PI * 2
        const d = range(r, 50, 100)
        return `<circle class="cf" cx="180" cy="100" r="${f1(range(r, 2, 4))}" fill="${pick(r, ['var(--ac)', 'var(--c3)', '#fff', 'var(--gl)'])}" style="--dx:${f1(Math.cos(a) * d)}px;--dy:${f1(Math.sin(a) * d)}px;animation-delay:${f1(range(r, 0.3, 0.6))}s"/>`
    }).join('') : ''
    const svg = `${dots}<g class="nd"><circle cx="180" cy="100" r="40" fill="#38383d" stroke="${ok ? '#4ade80' : '#f87171'}" stroke-width="3"/>
<text x="180" y="113" text-anchor="middle" font-size="36">${ok ? '✅' : '⚠️'}</text></g>
<text x="180" y="170" text-anchor="middle" font-size="12" class="lb">${ok ? esc(pick(r, ['Hasil ada di bawah 👇', 'Siap dipakai 🚀', 'Tinggal dicoba ✨'])) : 'Lihat pesan error di bawah'}</text>`
    const text = ok ? '✅ Selesai' : '⚠️ Gagal'
    return {
        svg, loop: 7, s0: text, status: [text],
        css: `.cf{opacity:0;animation:cf 1.1s ease-out forwards}@keyframes cf{0%{opacity:1;transform:translate(0,0)}100%{opacity:0;transform:translate(var(--dx),var(--dy))}}`,
    }
}

// ------------------------------------------------------------
//  Pemilihan scene
// ------------------------------------------------------------
const SCENE_MAKERS = { radar: radarScene, rain: rainScene, equalizer: equalizerScene, constellation: constellationScene, terminal: terminalScene }
const SCENES_BY_KIND = {
    chat: ['base', 'constellation', 'equalizer', 'terminal'],
    html: ['base', 'rain', 'terminal', 'constellation', 'equalizer'],
    zip: ['base', 'terminal', 'rain', 'constellation'],
    link: ['base', 'radar', 'constellation', 'terminal'],
    image: ['base', 'equalizer', 'constellation', 'radar'],
    plugin: ['base', 'terminal', 'constellation', 'radar'],
}
SCENES_BY_KIND.feature = SCENES_BY_KIND.plugin
export const SCENE_NAMES = ['base', ...Object.keys(SCENE_MAKERS), 'stepper', 'done', 'fail']

function scenesFor(kind, ctx) {
    const list = [...(SCENES_BY_KIND[kind] || SCENES_BY_KIND.chat)]
    if (ctx.searching) list.push('radar', 'radar') // sedang mencari web: radar lebih sering
    return list
}

function variantOfBase(kind, r) {
    const cfg = (BASE[kind] || BASE.chat)()
    const key = BASE[kind] ? kind : 'chat'
    const swap = (cfg.nodes || [])
    for (const node of swap) {
        if (ICONS[node.id] && node.emoji) node.emoji = pick(r, ICONS[node.id])
        if (node.stroke) node.stroke = 'var(--ac)'
    }
    cfg.status = pickN(r, STATUS[key === 'feature' ? 'plugin' : key] || STATUS.chat, 3)
    cfg.loop = Math.round(range(r, 6, 9) * 10) / 10
    return cfg
}

function sectionOf(html) {
    return { view_model: { __typename: 'GenAISingleLayoutViewModel', primitive: { __typename: 'FOAHtmlPrimitiveDemoDONOTUSE', trusted_sources: [], payload: html } } }
}

/**
 * Render satu frame animasi.
 * kind: chat | html | zip | link | image | plugin | feature | pipeline | done | fail
 * ctx : { seed, avoid, searching, plan, states, finished }
 * Mengembalikan { scene, seed, html, section }.
 */
export function liveScene(kind = 'chat', ctx = {}) {
    const seed = Number.isFinite(ctx.seed) ? ctx.seed : ((Date.now() ^ Math.floor(Math.random() * 2147483647)) >>> 0)
    const r = mulberry32(seed)
    const pal = pick(r, PALETTES)
    let scene
    let cfg
    if (kind === 'done' || kind === 'fail') {
        scene = kind
        cfg = endScene(kind, r)
    } else if (kind === 'pipeline') {
        scene = 'stepper'
        cfg = stepperScene(r, ctx)
    } else {
        const options = scenesFor(kind, ctx).filter(name => name !== ctx.avoid)
        scene = pick(r, options.length ? options : scenesFor(kind, ctx))
        cfg = scene === 'base' ? variantOfBase(kind, r) : SCENE_MAKERS[scene](r, ctx, kind)
    }
    const titleKey = TITLES[kind] ? kind : 'chat'
    cfg.id = `v${scene.slice(0, 2)}`
    cfg.title = pick(r, TITLES[titleKey])
    cfg.ac = pal.ac
    cfg.gl = pal.gl
    cfg.s0 = cfg.s0 || pick(r, S0)
    cfg.status = cfg.status || pickN(r, STATUS[kind === 'feature' ? 'plugin' : (STATUS[kind] ? kind : 'chat')], 3)
    cfg.css = `${cfg.css || ''}`
    let html = build(cfg)
    // warna ketiga untuk scene baru (var(--c3)) disuntik lewat wrapper
    html = html.replace('style="--ac:', `style="--c3:${pal.c3};--ac:`)
    return { scene, seed, html, section: sectionOf(html) }
}

// ------------------------------------------------------------
//  Driver: ganti section animasi di pesan AIRich secara live
// ------------------------------------------------------------
/**
 * rich : instance AIRich (sudah/akan dikirim lewat rich.send)
 * opts : { kind, id = 'anim', intervalMs = 15000, tick = true, ctx }
 *
 *  anim.start()        tambahkan section pertama (panggil SEBELUM rich.send)
 *  anim.run()          mulai ticker (panggil SETELAH rich.send); tiap interval, scene diganti
 *  anim.apply(patch)   sinkron: ubah ctx lalu ganti section di builder (tanpa kirim)
 *  anim.edit(fn)       jalankan fn lalu rich.sendEdit(), diantre agar edit tidak tabrakan
 *  anim.stop(final)    hentikan ticker, tunggu antrean, tampilkan layar 'done'/'fail'
 *                      (tidak mengirim; sendEdit berikutnya dari pemanggil yang mengirimnya)
 *  anim.dispose()      hentikan ticker tanpa mengubah apa pun
 */
export function createLiveAnim(rich, { kind = 'chat', id = 'anim', intervalMs = 15000, tick = true, ctx = {}, enabled = true } = {}) {
    if (!enabled) {
        // Animasi MATI (.anim off): API sama, tapi tidak ada banner/scene; pesan hanya berisi teks.
        let queue = Promise.resolve()
        return {
            start() {},
            run() {},
            apply() {},
            edit(fn) {
                queue = queue.then(async () => { await fn(); await rich.sendEdit() }).catch(error => console.error('[OMP ANIM]', error?.message || error))
                return queue
            },
            async stop() { await queue },
            dispose() {},
        }
    }
    let timer = null
    let closed = false
    let last = null
    let queue = Promise.resolve()
    const state = { ...ctx }

    const render = () => {
        const out = liveScene(kind, { ...state, seed: undefined, avoid: last })
        last = out.scene
        return out.section
    }
    const enqueue = (job) => {
        queue = queue.then(job).catch(error => console.error('[OMP ANIM]', error?.message || error))
        return queue
    }
    const api = {
        start() { rich.addSection(render(), { id }) },
        run() {
            if (!tick || timer || closed) return
            timer = setInterval(() => enqueue(async () => {
                if (closed) return
                rich.addSection(render(), { replace: id })
                await rich.sendEdit()
            }), intervalMs)
            timer.unref?.()
        },
        apply(patch = {}) {
            if (closed) return
            Object.assign(state, patch)
            rich.addSection(render(), { replace: id })
        },
        edit(fn) {
            return enqueue(async () => {
                if (closed) return
                await fn()
                await rich.sendEdit()
            })
        },
        async stop(final = 'done') {
            if (closed) return
            closed = true
            if (timer) clearInterval(timer)
            timer = null
            await queue
            try { rich.addSection(liveScene(final).section, { replace: id }) } catch (error) { console.error('[OMP ANIM]', error?.message || error) }
        },
        dispose() {
            closed = true
            if (timer) clearInterval(timer)
            timer = null
        },
    }
    return api
}
