// ============================================================
//  lib/omp-agent-anim.js — animasi "BUILD AI AGENTS" untuk OMP AI
//  Gaya workflow n8n: node muncul satu-satu, jalur tergambar mulus,
//  lalu pulsa cahaya mengalir berurutan sambil status teks berganti.
//  Murni HTML + CSS + SVG (tanpa gambar/base64), TANPA latar belakang
//  (transparan; teks otomatis putih/hitam mengikuti tema).
//
//  Tiap mode punya GAYA sendiri (layout, jalur, warna pulsa, status):
//    chat    -> pesan > agent > model/memory/tools > balasan   (kuning)
//    html    -> prompt > desain > kode > preview + loop revisi  (biru)
//    zip     -> ZIP terbuka, 3 file diproses paralel, diringkas (oranye)
//    link    -> URL > web reader, 4 satelit ambil data & kembali (hijau)
//    image   -> gambar discan, vision, objek + teks > deskripsi (pink)
//    plugin  -> agent di tengah, plugin mengorbit               (ungu)
//    feature -> sama dengan plugin
//
//  Pemakaian (tetap sama): rich.addSection(agentSection('chat'))
// ============================================================

const B = 4.4 // detik: loop "bekerja" mulai setelah semua node & jalur selesai tergambar
const f1 = (n) => Number(n).toFixed(1)
const dl = (n) => 'animation-delay:' + f1(n) + 's'
const pulseEl = (d, at) => `<path class="pl" d="${d}" pathLength="100" style="${dl(B + at)}"/>`

// ------------------------------------------------------------
//  Mesin gambar generik (node + jalur + pulsa)
// ------------------------------------------------------------
function shapeEl(n, hs) {
    if (n.agent) {
        return `<rect x="${n.x - n.w / 2}" y="${n.y - n.h / 2}" width="${n.w}" height="${n.h}" rx="14" fill="#38383d" stroke="${n.stroke || '#f5b81c'}" stroke-width="2.5"/>`
    }
    const cls = hs ? 'sh hit' : 'sh'
    const style = [hs, n.stroke ? 'stroke:' + n.stroke : ''].filter(Boolean).join(';')
    if (n.shape === 'circle') {
        return `<circle class="${cls}" cx="${n.x}" cy="${n.y}" r="${n.r}" fill="#38383d" style="${style}"/>`
    }
    return `<rect class="${cls}" x="${n.x - n.w / 2}" y="${n.y - n.h / 2}" width="${n.w}" height="${n.h}" rx="${n.rx || 14}" fill="#38383d" style="${style}"/>`
}

function contentEl(n) {
    const x = n.x
    const y = n.y
    if (n.inline) {
        return `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">${n.emoji} ${n.label}</text>`
    }
    if (n.big) {
        const top = y - n.h / 2
        return `<text x="${x}" y="${top + 26}" text-anchor="middle" font-size="20">${n.emoji}</text>` +
            `<text x="${x}" y="${top + 45}" text-anchor="middle" font-size="13" font-weight="800" fill="#fff">${n.name}</text>` +
            (n.sub ? `<text x="${x}" y="${top + 59}" text-anchor="middle" font-size="9" fill="#bdbdc4">${n.sub}</text>` : '')
    }
    const circle = n.shape === 'circle'
    const half = circle ? n.r : n.h / 2
    return `<text x="${x}" y="${y + (circle ? 7 : 8)}" text-anchor="middle" font-size="${circle ? 18 : 22}">${n.emoji}</text>` +
        (n.label ? `<text x="${x}" y="${y + half + 17}" text-anchor="middle" class="lb">${n.label}</text>` : '')
}

function drawNode(n, hitAt) {
    const hs = hitAt != null && !n.agent ? dl(B + hitAt) : ''
    const open = n.agent
        ? `<g class="ag" style="opacity:0;animation-delay:${f1(n.at)}s,${f1(n.at + 0.9)}s">`
        : `<g class="nd" style="${dl(n.at)}">`
    return open + shapeEl(n, hs) + contentEl(n) + '</g>'
}

function css(cfg, L) {
    const pf = 100 / L // pulsa mengalir ~1 detik
    const h1 = (pf * 0.85).toFixed(1)
    const h2 = (pf * 2.4).toFixed(1)
    const n = cfg.status.length
    const stCss = cfg.status.map((_, i) => {
        const a = (i * 100) / n
        const b = ((i + 1) * 100) / n
        let kf
        if (i === 0) kf = `0%,${(b - 3).toFixed(1)}%{opacity:1}${b.toFixed(1)}%,100%{opacity:0}`
        else if (i === n - 1) kf = `0%,${a.toFixed(1)}%{opacity:0}${(a + 3).toFixed(1)}%,97%{opacity:1}100%{opacity:0}`
        else kf = `0%,${a.toFixed(1)}%{opacity:0}${(a + 3).toFixed(1)}%,${(b - 3).toFixed(1)}%{opacity:1}${b.toFixed(1)}%,100%{opacity:0}`
        return `@keyframes st${i + 1}{${kf}}.st .s${i + 1}{animation:st${i + 1} ${L}s linear ${B}s infinite}`
    }).join('\n')

    return `*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{background:transparent!important}
body{color:#fff;font-family:Roboto,"Segoe UI",system-ui,-apple-system,Arial,sans-serif;padding:4px 6px 8px;overflow-x:hidden;-webkit-text-size-adjust:100%}
@media (prefers-color-scheme:light){body{color:#111}}
.wrap{width:100%;max-width:420px;margin:0 auto}
.card{padding:6px 2px 4px}
.ttl{text-align:center;font-weight:800;font-size:21px;letter-spacing:.5px;margin-bottom:4px}
svg{display:block;width:100%;height:auto}
.lb{fill:currentColor;opacity:.85;font-size:11px}
.sh{stroke:#77777d;stroke-width:2}
.base{fill:none;stroke:#8b8b92;stroke-width:2}
.dr{stroke-dasharray:100;stroke-dashoffset:100;animation:draw .7s ease-out forwards}
@keyframes draw{to{stroke-dashoffset:0}}
.nd{opacity:0;transform-box:fill-box;transform-origin:center;animation:pop .55s cubic-bezier(.2,.9,.3,1.25) forwards}
@keyframes pop{0%{opacity:0;transform:scale(.4)}100%{opacity:1;transform:scale(1)}}
.fade{opacity:0;animation:fade .8s ease-out forwards}
@keyframes fade{to{opacity:1}}
.pl{fill:none;stroke:var(--ac);stroke-width:3.5;stroke-dasharray:7 300;stroke-dashoffset:7;filter:drop-shadow(0 0 3px var(--gl));animation:flow ${L}s linear infinite}
@keyframes flow{0%{stroke-dashoffset:7}${pf.toFixed(1)}%,100%{stroke-dashoffset:-101}}
.hit{animation:hit ${L}s ease-out infinite}
@keyframes hit{0%,${h1}%{stroke:var(--ac);stroke-width:3.5}${h2}%,100%{stroke:#77777d;stroke-width:2}}
.ag{animation:pop .55s cubic-bezier(.2,.9,.3,1.25) 1.3s forwards,glow 2.2s ease-in-out 2.2s infinite}
@keyframes glow{0%,100%{filter:drop-shadow(0 0 0 transparent)}50%{filter:drop-shadow(0 0 8px var(--gl))}}
.st{position:relative;height:20px;margin-top:2px;font-size:13px;font-weight:700}
.st span{position:absolute;left:0;right:0;text-align:center;opacity:0}
.st .s0{opacity:1;animation:out .3s ease ${B - 0.4}s forwards}
@keyframes out{to{opacity:0}}
${stCss}
${cfg.css || ''}`
}

export function build(cfg) {
    const L = cfg.loop || 7

    // node mana yang menyala saat pulsa tiba
    const hitMap = {}
    ;(cfg.pulses || []).forEach((p) => { if (p.to) hitMap[p.to] = p.at + 0.9 })

    let masks = ''
    let edges = ''
    ;(cfg.edges || []).forEach((e, i) => {
        const id = cfg.id + '-m' + i
        masks += `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="360" height="230"><path class="dr" d="${e.d}" pathLength="100" stroke="#fff" stroke-width="8" fill="none" style="${dl(e.at)}"/></mask>`
        edges += `<path d="${e.d}" fill="none" stroke="#8b8b92" stroke-width="2"${e.solid ? '' : ' stroke-dasharray="4 4"'} mask="url(#${id})"/>`
    })

    const nodes = (cfg.nodes || []).map((n) => drawNode(n, hitMap[n.id])).join('\n')
    const pulses = (cfg.pulses || []).map((p) => pulseEl(p.d, p.at)).join('')
    const svg = cfg.svg || `<defs>${masks}</defs>\n${edges}\n${nodes}\n${cfg.extra || ''}\n${pulses}`

    const spans = `<span class="s0">${cfg.s0}</span>` +
        cfg.status.map((s, i) => `<span class="s${i + 1}">${s}</span>`).join('')

    return `<style>
${css(cfg, L)}
</style>

<div class="wrap" style="--ac:${cfg.ac};--gl:${cfg.gl}"><div class="card">
<div class="ttl">${cfg.title}</div>
<svg viewBox="0 0 360 230" xmlns="http://www.w3.org/2000/svg">
${svg}
</svg>
<div class="st">${spans}</div>
</div></div>

<script>
(function(){try{var m=document.createElement("meta");m.name="viewport";m.content="width=device-width, initial-scale=1, viewport-fit=cover";document.head.appendChild(m)}catch(e){}})();
</script>`
}

// ------------------------------------------------------------
//  1) CHAT — gaya asli: pesan > agent > model/memory/tools > balasan
// ------------------------------------------------------------
function chatCfg() {
    const E1 = 'M84 62 H132' // pesan -> agent
    const E2 = 'M150 98 C150 128 110 118 110 150' // agent -> model
    const E3 = 'M182 98 V150' // agent -> memory
    const E4 = 'M214 98 C214 128 254 118 254 150' // agent -> tools
    const E5 = 'M232 62 H276' // agent -> balasan
    return {
        id: 'c', title: 'BUILD AI AGENTS', ac: '#ffd23f', gl: '#ffb300',
        s0: '⚙️ Menyiapkan agent…',
        status: ['📥 Membaca pesan…', '🧠 Memanggil model &amp; tools…', '✍️ Menyusun jawaban…'],
        nodes: [
            { id: 'msg', x: 49, y: 62, w: 70, h: 50, emoji: '⚡', label: 'Pesan', stroke: '#ff6d5a', at: 0.2 },
            { id: 'agent', x: 182, y: 64, w: 100, h: 68, agent: true, big: true, emoji: '🤖', name: 'AI Agent', sub: 'OMP', at: 1.3 },
            { id: 'reply', x: 311, y: 62, w: 70, h: 50, emoji: '💬', label: 'Balasan', at: 3.8 },
            { id: 'model', shape: 'circle', x: 110, y: 172, r: 22, emoji: '🧠', label: 'Model', at: 2.4 },
            { id: 'mem', shape: 'circle', x: 182, y: 172, r: 22, emoji: '💾', label: 'Memory', at: 2.6 },
            { id: 'tool', shape: 'circle', x: 254, y: 172, r: 22, emoji: '🔧', label: 'Tools', at: 2.8 },
        ],
        edges: [
            { d: E1, at: 0.7, solid: true }, { d: E2, at: 1.9 }, { d: E3, at: 2.1 },
            { d: E4, at: 2.3 }, { d: E5, at: 3.3, solid: true },
        ],
        pulses: [
            { d: E1, at: 0 }, { d: E2, at: 1.0, to: 'model' }, { d: E3, at: 1.8, to: 'mem' },
            { d: E4, at: 2.6, to: 'tool' }, { d: E5, at: 3.6, to: 'reply' },
        ],
    }
}

// ------------------------------------------------------------
//  2) HTML — rantai prompt > desain > kode > preview, ada loop revisi
//     + panel kode yang "mengetik" di bawah
// ------------------------------------------------------------
function htmlCfg() {
    const E1 = 'M66 80 H104'
    const E2 = 'M156 80 H194'
    const E3 = 'M246 80 H284'
    const LOOP = 'M310 54 C310 14 220 14 220 54' // preview -> kode (revisi)
    const bar = (x, y, w, c, i) =>
        `<rect class="cl" x="${x}" y="${y}" width="${w}" height="6" rx="3" fill="${c}" style="${dl(2.6 + i * 0.4)}"/>`
    const extra = `<g class="nd" style="${dl(2.0)}"><text x="265" y="42" text-anchor="middle" class="lb" font-size="10">Revisi</text></g>
<g class="nd" style="${dl(2.2)}">
  <rect x="36" y="142" width="288" height="76" rx="12" fill="#2a2a2f" stroke="#55555b" stroke-width="1.5"/>
  <circle cx="52" cy="155" r="3" fill="#ff5f57"/><circle cx="64" cy="155" r="3" fill="#febc2e"/><circle cx="76" cy="155" r="3" fill="#28c840"/>
  ${bar(52, 170, 90, '#38bdf8', 0)}${bar(148, 170, 60, '#c084fc', 1)}
  ${bar(68, 184, 120, '#4ade80', 2)}${bar(194, 184, 50, '#fbbf24', 3)}
  ${bar(68, 198, 70, '#f472b6', 4)}${bar(144, 198, 100, '#8b8b92', 5)}
</g>`
    return {
        id: 'h', title: 'BUILD HTML APP', ac: '#38bdf8', gl: '#0ea5e9',
        s0: '🧱 Menyiapkan kanvas…',
        status: ['🎨 Merancang layout…', '⌨️ Menulis kode…', '🔍 Mengecek dan merevisi…'],
        css: `.cl{transform-box:fill-box;transform-origin:left center;transform:scaleX(0);animation:typ 5s ease-in-out infinite}
@keyframes typ{0%{transform:scaleX(0)}28%,78%{transform:scaleX(1)}92%,100%{transform:scaleX(0)}}`,
        nodes: [
            { id: 'p', shape: 'circle', x: 40, y: 80, r: 26, emoji: '💬', label: 'Prompt', at: 0.2 },
            { id: 'd', shape: 'circle', x: 130, y: 80, r: 26, emoji: '🎨', label: 'Desain', at: 0.7 },
            { id: 'k', shape: 'circle', x: 220, y: 80, r: 26, emoji: '⌨️', label: 'Kode', at: 1.2 },
            { id: 'v', shape: 'circle', x: 310, y: 80, r: 26, emoji: '🌐', label: 'Preview', at: 1.7 },
        ],
        edges: [
            { d: E1, at: 0.5, solid: true }, { d: E2, at: 1.0, solid: true },
            { d: E3, at: 1.5, solid: true }, { d: LOOP, at: 2.0 },
        ],
        pulses: [
            { d: E1, at: 0, to: 'd' }, { d: E2, at: 1.1, to: 'k' }, { d: E3, at: 2.2, to: 'v' },
            { d: LOOP, at: 3.4 }, { d: E3, at: 4.6 },
        ],
        extra,
    }
}

// ------------------------------------------------------------
//  3) ZIP — ZIP terbuka, 3 file diproses paralel, digabung jadi ringkasan
// ------------------------------------------------------------
function zipCfg() {
    const O1 = 'M84 106 C122 106 118 42 155 42'
    const O2 = 'M84 115 H155'
    const O3 = 'M84 124 C122 124 118 188 155 188'
    const I1 = 'M195 42 C232 42 238 106 276 106'
    const I2 = 'M195 115 H276'
    const I3 = 'M195 188 C232 188 238 124 276 124'
    return {
        id: 'z', title: 'ANALISIS ZIP', ac: '#fb923c', gl: '#f97316',
        s0: '📦 Membuka ZIP…',
        status: ['🗂️ Memindai struktur…', '🔎 Membaca isi file…', '🧾 Merangkum…'],
        nodes: [
            { id: 'zip', x: 49, y: 115, w: 70, h: 50, emoji: '📦', label: 'ZIP', stroke: '#fb923c', at: 0.2 },
            { id: 'f1', shape: 'circle', x: 175, y: 42, r: 20, emoji: '📄', label: 'Struktur', at: 1.4 },
            { id: 'f2', shape: 'circle', x: 175, y: 115, r: 20, emoji: '🧩', label: 'Kode', at: 1.6 },
            { id: 'f3', shape: 'circle', x: 175, y: 188, r: 20, emoji: '🗂️', label: 'Aset', at: 1.8 },
            { id: 'res', x: 311, y: 115, w: 70, h: 50, emoji: '📋', label: 'Ringkasan', at: 2.6 },
        ],
        edges: [
            { d: O1, at: 0.8 }, { d: O2, at: 1.0 }, { d: O3, at: 1.2 },
            { d: I1, at: 2.0 }, { d: I2, at: 2.2 }, { d: I3, at: 2.4 },
        ],
        pulses: [
            { d: O1, at: 0, to: 'f1' }, { d: O2, at: 0.25, to: 'f2' }, { d: O3, at: 0.5, to: 'f3' },
            { d: I1, at: 1.8 }, { d: I2, at: 2.05 }, { d: I3, at: 2.3, to: 'res' },
        ],
    }
}

// ------------------------------------------------------------
//  4) LINK — URL > web reader, 4 satelit: pulsa pergi lalu kembali
// ------------------------------------------------------------
function linkCfg() {
    const U = 'M180 45 V84'
    const S = [
        { out: 'M128 98 L78 61', back: 'M78 61 L128 98' },
        { out: 'M232 98 L282 61', back: 'M282 61 L232 98' },
        { out: 'M128 132 L78 169', back: 'M78 169 L128 132' },
        { out: 'M232 132 L282 169', back: 'M282 169 L232 132' },
    ]
    return {
        id: 'l', title: 'BACA LINK', ac: '#4ade80', gl: '#22c55e',
        s0: '🔗 Membuka link…',
        status: ['🌐 Mengambil halaman…', '🔎 Mengekstrak isi…', '✍️ Merangkum…'],
        nodes: [
            { id: 'url', x: 180, y: 30, w: 96, h: 30, rx: 15, inline: true, emoji: '🌍', label: 'URL', stroke: '#4ade80', at: 0.2 },
            { id: 'hub', x: 180, y: 115, w: 104, h: 62, agent: true, big: true, emoji: '🌐', name: 'Web Reader', sub: 'OMP', stroke: '#4ade80', at: 1.0 },
            { id: 's1', shape: 'circle', x: 60, y: 48, r: 22, emoji: '📄', label: 'Halaman', at: 1.8 },
            { id: 's2', shape: 'circle', x: 300, y: 48, r: 22, emoji: '📝', label: 'Teks', at: 2.0 },
            { id: 's3', shape: 'circle', x: 60, y: 182, r: 22, emoji: '🔗', label: 'Tautan', at: 2.2 },
            { id: 's4', shape: 'circle', x: 300, y: 182, r: 22, emoji: '🏷️', label: 'Meta', at: 2.4 },
        ],
        edges: [
            { d: U, at: 0.7, solid: true },
            { d: S[0].out, at: 1.5 }, { d: S[1].out, at: 1.7 }, { d: S[2].out, at: 1.9 }, { d: S[3].out, at: 2.1 },
        ],
        pulses: [
            { d: U, at: 0, to: 'hub' },
            { d: S[0].out, at: 1.0, to: 's1' }, { d: S[1].out, at: 1.4, to: 's2' },
            { d: S[2].out, at: 1.8, to: 's3' }, { d: S[3].out, at: 2.2, to: 's4' },
            { d: S[0].back, at: 3.2 }, { d: S[1].back, at: 3.6 },
            { d: S[2].back, at: 4.0 }, { d: S[3].back, at: 4.4 },
        ],
    }
}

// ------------------------------------------------------------
//  5) IMAGE — gambar discan (garis + kotak deteksi) > vision >
//     objek + teks > deskripsi
// ------------------------------------------------------------
function imageCfg() {
    const E1 = 'M84 90 H116'
    const E2 = 'M158 74 C178 62 182 48 200 45'
    const E3 = 'M158 106 C178 118 182 132 200 135'
    const E4 = 'M244 45 C268 48 270 76 289 84'
    const E5 = 'M244 135 C268 132 270 104 289 96'
    const extra = `<line class="scan" x1="20" x2="78" y1="62" y2="62" stroke="var(--ac)" stroke-width="2" stroke-linecap="round"/>
<rect class="bx" x="24" y="68" width="24" height="20" rx="3" style="${dl(1.4)}"/>
<rect class="bx" x="48" y="98" width="26" height="16" rx="3" style="${dl(2.2)}"/>`
    return {
        id: 'i', title: 'ANALISIS GAMBAR', ac: '#f472b6', gl: '#ec4899',
        s0: '🖼️ Membuka gambar…',
        status: ['👁️ Memindai gambar…', '🔎 Mengenali objek dan teks…', '✍️ Menyusun deskripsi…'],
        css: `.scan{opacity:0;filter:drop-shadow(0 0 3px var(--gl));animation:scan 2.2s ease-in-out .9s infinite alternate}
@keyframes scan{0%{opacity:1;transform:translateY(0)}100%{opacity:1;transform:translateY(56px)}}
.bx{fill:none;stroke:var(--ac);stroke-width:1.5;stroke-dasharray:3 2;opacity:0;animation:bx 3.6s ease-in-out infinite}
@keyframes bx{0%,100%{opacity:0}15%,70%{opacity:1}}`,
        nodes: [
            { id: 'img', x: 49, y: 90, w: 70, h: 70, rx: 12, emoji: '🖼️', label: 'Gambar', stroke: '#f472b6', at: 0.2 },
            { id: 'vis', shape: 'circle', x: 140, y: 90, r: 24, emoji: '👁️', label: 'Vision', at: 1.0 },
            { id: 'obj', shape: 'circle', x: 222, y: 45, r: 22, emoji: '🔍', label: 'Objek', at: 1.6 },
            { id: 'txt', shape: 'circle', x: 222, y: 135, r: 22, emoji: '🔤', label: 'Teks', at: 1.8 },
            { id: 'des', shape: 'circle', x: 312, y: 90, r: 24, emoji: '💬', label: 'Deskripsi', at: 2.6 },
        ],
        edges: [
            { d: E1, at: 0.7, solid: true }, { d: E2, at: 1.2 }, { d: E3, at: 1.3 },
            { d: E4, at: 2.0 }, { d: E5, at: 2.1 },
        ],
        pulses: [
            { d: E1, at: 0, to: 'vis' }, { d: E2, at: 1.0, to: 'obj' }, { d: E3, at: 1.3, to: 'txt' },
            { d: E4, at: 2.2 }, { d: E5, at: 2.5, to: 'des' },
        ],
        extra,
    }
}

// ------------------------------------------------------------
//  6) PLUGIN / FEATURE — agent di tengah, 4 plugin mengorbit
//     (ikon tetap tegak, pulsa mengalir dari agent ke tiap plugin)
// ------------------------------------------------------------
function pluginCfg() {
    const spokes = [
        { d: 'M214 112 H238', cx: 258, cy: 112, e: '🧩' },
        { d: 'M180 146 V170', cx: 180, cy: 190, e: '🔌' },
        { d: 'M146 112 H122', cx: 102, cy: 112, e: '⚙️' },
        { d: 'M180 78 V54', cx: 180, cy: 34, e: '✨' },
    ]
    const orbit = spokes.map((s, i) =>
        `<path class="base fade" d="${s.d}" stroke-dasharray="4 4" style="${dl(1.2)}"/>` +
        `<g class="nd" style="${dl(1.2 + i * 0.3)}"><g class="cr" style="transform-origin:${s.cx}px ${s.cy}px">` +
        `<circle class="sh" cx="${s.cx}" cy="${s.cy}" r="20" fill="#38383d"/>` +
        `<text x="${s.cx}" y="${s.cy + 7}" text-anchor="middle" font-size="18">${s.e}</text></g></g>`
    ).join('') + spokes.map((s, i) => pulseEl(s.d, i * 0.9)).join('')

    const svg = `<circle class="fade" cx="180" cy="112" r="78" fill="none" stroke="#8b8b92" stroke-width="1.5" stroke-dasharray="3 6" style="${dl(0.9)}"/>
<g class="orb">${orbit}</g>
<g class="ag" style="opacity:0;animation-delay:0.3s,1.2s">
  <circle cx="180" cy="112" r="34" fill="#38383d" stroke="#f5b81c" stroke-width="2.5"/>
  <text x="180" y="110" text-anchor="middle" font-size="22">🤖</text>
  <text x="180" y="130" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">Plugins</text>
</g>`
    return {
        id: 'p', title: 'PLUGIN AGENT', ac: '#c084fc', gl: '#a855f7',
        s0: '🧩 Menyiapkan plugin…',
        status: ['🔌 Menghubungkan plugin…', '⚙️ Menjalankan tools…', '✍️ Menyusun hasil…'],
        css: `.orb{transform-origin:180px 112px;animation:orb 16s linear infinite}
@keyframes orb{to{transform:rotate(360deg)}}
.cr{animation:orbr 16s linear infinite}
@keyframes orbr{to{transform:rotate(-360deg)}}`,
        svg,
    }
}

// ------------------------------------------------------------
//  Router mode -> gaya animasi
// ------------------------------------------------------------
export const STYLES = {
    chat: chatCfg,
    html: htmlCfg,
    zip: zipCfg,
    link: linkCfg,
    image: imageCfg,
    plugin: pluginCfg,
    feature: pluginCfg,
}

export function agentHtml(kind = 'chat') {
    return build((STYLES[kind] || chatCfg)())
}

// section siap pakai untuk rich.addSection(...)
export function agentSection(kind = 'chat') {
    return {
        view_model: {
            __typename: 'GenAISingleLayoutViewModel',
            primitive: {
                __typename: 'FOAHtmlPrimitiveDemoDONOTUSE',
                trusted_sources: [],
                payload: agentHtml(kind),
            },
        },
    }
}
