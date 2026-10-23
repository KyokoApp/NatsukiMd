/**
 * Tampilan status live OMP Agent: fase kerja yang berganti sesuai tool yang dipakai,
 * spinner + bilah denyut yang bergerak tiap pembaruan, dan teks "berpikir" yang berganti-ganti.
 * Fungsi murni (tanpa I/O) supaya mudah dites. Dipakai oleh lib/omp-agent-cmd.js.
 */

import { toolIcon } from './omp-agent.js'

const MAX_STEPS_SHOWN = 8

const SPINNER = ['◐', '◓', '◑', '◒']

// Fase kerja menurut jenis tool. Tiap fase punya judul + beberapa kalimat yang digilir.
const PHASES = {
    investigate: { icon: '🔍', title: 'Menyelidiki', texts: ['membaca & menelusuri kode…', 'mengumpulkan petunjuk…', 'mencari yang relevan…'] },
    build: { icon: '🛠️', title: 'Membangun', texts: ['menulis perubahan…', 'merapikan hasil…', 'menerapkan perbaikan…'] },
    run: { icon: '⚙️', title: 'Menjalankan', texts: ['menjalankan perintah…', 'menunggu hasil proses…', 'memeriksa keluaran…'] },
    plan: { icon: '📋', title: 'Merencanakan', texts: ['menyusun langkah kerja…', 'memecah tugas…', 'mengurutkan prioritas…'] },
    web: { icon: '🌐', title: 'Riset web', texts: ['mencari di internet…', 'membandingkan sumber…', 'membaca hasil pencarian…'] },
    delegate: { icon: '🧩', title: 'Membagi tugas', texts: ['menyiapkan sub-tugas…', 'menunggu sub-agent…', 'menggabungkan hasil…'] },
    think: { icon: '💭', title: 'Berpikir', texts: ['menimbang langkah berikutnya…', 'menyusun rencana…', 'menganalisis tugas…', 'merangkai jawaban…'] },
}

const TOOL_PHASE = {
    read: 'investigate', grep: 'investigate', glob: 'investigate', ast_grep: 'investigate', lsp: 'investigate',
    edit: 'build', write: 'build', ast_edit: 'build',
    bash: 'run', eval: 'run',
    todo: 'plan',
    web_search: 'web',
    task: 'delegate',
}

/** Fase saat ini: dari tool yang sedang berjalan; kalau tidak ada, dari tool terakhir; kalau kosong → berpikir. */
export function phaseOf(steps) {
    const running = [...steps].reverse().find(step => step.state === 'run')
    if (running) return TOOL_PHASE[running.name] || 'investigate'
    return 'think'
}

/** Bilah denyut yang memantul kiri-kanan, mis. ▱▱▰▰▱▱▱▱. */
export function pulseBar(tick, width = 8) {
    const span = width - 1 // posisi kepala 0..width-2 → pantul
    const period = Math.max(1, 2 * (span - 1))
    const p = ((tick % period) + period) % period
    const head = p <= span - 1 ? p : period - p
    return Array.from({ length: width }, (_, i) => (i === head || i === head + 1 ? '▰' : '▱')).join('')
}

/**
 * Teks status live.
 * @param {{id?:any,name:string,line:string,state:'run'|'done'|'error'}[]} steps
 * @param {number} startedAt ms
 * @param {number} tick pembaruan ke-n (menggerakkan spinner, bilah, dan pilihan kalimat)
 */
export function renderStatus(steps, startedAt, tick = 0, now = Date.now()) {
    const seconds = Math.round((now - startedAt) / 1000)
    const phase = PHASES[phaseOf(steps)]
    const running = [...steps].reverse().find(step => step.state === 'run')
    const spin = SPINNER[tick % SPINNER.length]

    const lines = [`🤖 *OMP Agent* ${spin}  ⏱ ${seconds}s · ${steps.length} langkah`]
    const detail = running ? running.line : phase.texts[tick % phase.texts.length]
    lines.push(`${phase.icon} *${phase.title}* — ${detail}`)
    lines.push(pulseBar(tick))

    const shown = steps.slice(-MAX_STEPS_SHOWN)
    const hidden = steps.length - shown.length
    if (hidden > 0) lines.push(`_…${hidden} langkah sebelumnya_`)
    for (const step of shown) {
        const mark = step.state === 'run' ? '⏳' : step.state === 'error' ? '✗' : '✓'
        lines.push(`${mark} ${step.line}`)
    }
    return lines.join('\n')
}

/** Ringkasan tool yang dipakai, mis. "📖×5 🔎×3 ✏️×2". Urutan menurut pemakaian terbanyak. */
export function summarizeTools(names, { max = 6 } = {}) {
    const counts = new Map()
    for (const name of names || []) counts.set(name, (counts.get(name) || 0) + 1)
    return [...counts]
        .sort((a, b) => b[1] - a[1])
        .slice(0, max)
        .map(([name, count]) => `${toolIcon(name)}×${count}`)
        .join(' ')
}
