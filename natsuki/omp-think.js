// Mode berpikir agent: .agent think 1-4. Tiap level = paket model + thinking + subagent + alur kerja.
//   1 Low     → model gratis tercepat, tanpa mikir, tanpa subagent
//   2 Normal  → model gratis, mikir ringan, tanpa subagent
//   3 High    → model utama (.agent model), mikir dalam, langsung jawab — tanpa subagent
//   4 Project → model utama jadi orkestrator, SEMUA kerja dilempar ke subagent, spec-kit penuh
// Semua level lewat headroom (proxy kompres konteks) bila OMP_HEADROOM=1.
import fs from 'node:fs'
import path from 'node:path'
import { MODEL_SPEC } from './omp-model.js'
import { geminiEnabled, geminiSpec } from '../gemini-keys.js'

const FILE = path.resolve(process.env.OMP_THINK_FILE || path.join(process.cwd(), 'data', 'omp-think.json'))
const keyOf = sender => String(sender || '').split('@')[0].split(':')[0]

let cache = null
function load() {
    if (cache) return cache
    try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { cache = {} }
    if (!cache || typeof cache !== 'object') cache = {}
    return cache
}

export const THINK_NAMES = { 1: 'Low', 2: 'Normal', 3: 'High', 4: 'Project' }
const WORDS = { low: 1, rendah: 1, normal: 2, biasa: 2, high: 3, tinggi: 3, project: 4, proyek: 4 }

/** "3" / "high" → 3, selain itu null. */
export function parseThinkLevel(input) {
    const t = String(input ?? '').trim().toLowerCase()
    if (/^[1-4]$/.test(t)) return Number(t)
    return WORDS[t] || null
}

export function getThink(sender) {
    const saved = Number(load().level?.[keyOf(sender)])
    if (saved >= 1 && saved <= 4) return saved
    return parseThinkLevel(process.env.OMP_THINK_DEFAULT) || 2
}

export function setThink(sender, level) {
    const data = load()
    data.level = data.level || {}
    data.level[keyOf(sender)] = level
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(data), 'utf8')
}

function validModel(value, fallback) {
    const v = String(value || '').trim()
    return MODEL_SPEC.test(v) ? v : fallback
}

const DEFAULT_SUB = {
    task: 'clouvia/agnes-3.0-flash',
    smol: 'clouvia/agnes-2.5-flash',
    tiny: 'clouvia/agnes-2.0-flash',
}
const DEFAULT_ADVISOR = 'clouvia/step-5-preview'
// Bila kunci Gemini tersedia (GEMINI_API_KEY...), semua default Yuki (level, subagent, advisor) pakai Gemini.
// Env OMP_THINK_*_MODEL yang diisi eksplisit tetap menang.
const dflt = (env, normal) => (geminiEnabled(env) ? geminiSpec(env) : normal)

const THINKING_VALUES = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
const THINKING_DEFAULT = ['off', 'low', 'high', 'high']
function thinkingFor(env, lv) {
    const v = String(env[`OMP_THINK_${THINK_NAMES[lv].toUpperCase()}_THINKING`] || '').trim().toLowerCase()
    return THINKING_VALUES.has(v) ? v : THINKING_DEFAULT[lv - 1]
}

/**
 * Profil per level. Env opsional (semua model harus ada di models.yml):
 *  OMP_THINK_FAST_MODEL (level 1), OMP_THINK_NORMAL_MODEL (level 2),
 *  OMP_THINK_TASK_MODEL / OMP_THINK_SMOL_MODEL / OMP_THINK_TINY_MODEL (subagent), OMP_THINK_ADVISOR_MODEL.
 */
export function thinkProfile(level, env = process.env) {
    const lv = [1, 2, 3, 4].includes(level) ? level : 2
    const sub = {
        task: validModel(env.OMP_THINK_TASK_MODEL, dflt(env, DEFAULT_SUB.task)),
        smol: validModel(env.OMP_THINK_SMOL_MODEL, dflt(env, DEFAULT_SUB.smol)),
        tiny: validModel(env.OMP_THINK_TINY_MODEL, dflt(env, DEFAULT_SUB.tiny)),
    }
    const advisor = validModel(env.OMP_THINK_ADVISOR_MODEL || env.OMP_AGENT_ADVISOR_MODEL, dflt(env, DEFAULT_ADVISOR))
    const heavy = lv === 4                 // subagent cuma di level 4; level 3 = model utama langsung jawab, tanpa subagent
    return {
        level: lv,
        name: THINK_NAMES[lv],
        // level 1-2 pakai model gratis; level 3-4 kosong = ikut model utama (.agent model)
        model: lv === 1 ? validModel(env.OMP_THINK_FAST_MODEL, dflt(env, 'clouvia/agnes-2.5-flash'))
            : lv === 2 ? validModel(env.OMP_THINK_NORMAL_MODEL, dflt(env, 'clouvia/agnes-3.0-flash')) : '',
        // bawaan: off / low / high / high. Timpa lewat env: OMP_THINK_LOW_THINKING, OMP_THINK_NORMAL_THINKING, OMP_THINK_HIGH_THINKING, OMP_THINK_PROJECT_THINKING
        // (nilai: off, minimal, low, medium, high, xhigh)
        thinking: thinkingFor(env, lv),
        task: heavy,                       // tool subagent hanya di level 4
        advisor: heavy ? advisor : '',
        // Semua role subagent dikunci ke model gratis supaya model utama (qwen/claude/deepseek) tidak pernah kepakai subagent.
        // `default` sengaja tidak diisi: itu model utama.
        roles: {
            ...sub,
            slow: sub.task,
            plan: sub.task,
            commit: sub.smol,
            vision: validModel(env.OMP_THINK_VISION_MODEL, sub.task),
        },
        specKit: heavy ? 'full' : '',       // level 3 gak lagi pakai spec-kit 'lite' (dulu itu yang micu subagent)
        timeoutMs: [90_000, 180_000, 600_000, 900_000][lv - 1],
        stallMs: [60_000, 90_000, 420_000, 600_000][lv - 1], // menunggu subagent = tidak ada frame lama, jangan dianggap macet
    }
}

// Aturan menunggu subagent. Sengaja tidak menyebut nama tool tunggu tertentu: di omp lama bernama `job`, di omp baru digabung
// ke `hub`, dan tool itu tidak masuk daftar --tools bot. Yang penting perilakunya: jangan selesai sebelum hasil subagent terbaca.
const WAIT_RULE = 'ATURAN subagent: setelah memanggil `task`, JANGAN mengakhiri giliran sebelum hasil semua subagent kembali dan sudah kamu baca (kalau hasilnya belum ada, lanjutkan menunggu; pakai tool tunggu seperti `hub`/`job` hanya bila memang ada di daftar tool-mu). Dilarang menjawab \"tunggu ya\" atau \"hasil menyusul\": hasil yang datang setelah giliran selesai tidak terkirim ke pengguna.'

/** Awalan prompt per giliran (hanya level 3-4). specReady=false → spec-kit gagal terpasang, pakai alur manual. */
export function thinkPrompt(profile, { specReady = true, checkpoint = false } = {}) {
    if (!profile.specKit) return ''
    // Tugas panjang (level 3-4) boros konteks karena eksplorasi; checkpoint/rewind membuang jejaknya setelah dipahami.
    const ckpt = checkpoint
        ? 'Konteks: untuk tugas yang butuh banyak membaca/menjelajah file, panggil `checkpoint` sebelum mulai menjelajah. Setelah paham, panggil `rewind` dengan laporan ringkas temuanmu (file penting, keputusan, hal yang sudah dicoba) supaya jejak eksplorasi dibuang; rewind baru berlaku di akhir giliran. Hanya ada satu checkpoint aktif, jadi jangan dipakai untuk tugas kecil atau berulang-ulang.'
        : ''
    const cmds = specReady
        ? 'Panduan tiap tahap ada di `.speckit/commands/speckit.<tahap>.md` (baca file-nya, ikuti isinya; hasil disimpan di folder `specs/` dan `.specify/`).'
        : 'Spec-kit belum terpasang di server, jadi jalankan tahapnya secara manual dan simpan sebagai `specs/<fitur>/spec.md`, `plan.md`, `tasks.md`.'
    if (profile.specKit === 'lite') {
        return [
            '[MODE THINK 3 — HIGH]',
            'Kalau tugasnya kecil (satu file kecil, perbaikan singkat, pertanyaan), kerjakan langsung tanpa spec-kit dan tanpa subagent.',
            'Kalau tugasnya fitur/perubahan besar, pakai alur spec-kit ringkas: specify → plan → tasks → implement. ' + cmds,
            'WAJIB pakai subagent lewat tool `task` (boleh beberapa sekaligus) bila SALAH SATU benar: (a) ada 2 bagian atau lebih yang bisa dikerjakan terpisah, (b) perlu menulis lebih dari satu file, (c) perlu membaca/menjelajah banyak file. Beri tiap subagent instruksi lengkap (file yang disentuh, kriteria selesai), lalu tinjau hasilnya sebelum menjawab.',
            WAIT_RULE,
            ...(ckpt ? [ckpt] : []),
            'Jawaban akhir singkat dan cocok dibaca di WhatsApp.',
            '',
            '',
        ].join('\n')
    }
    return [
        '[MODE THINK 4 — PROJECT]',
        'Kamu ORKESTRATOR. Kamu hanya boleh membaca, merencanakan, dan meninjau. Menulis kode atau mengedit file sendiri melanggar mode ini: semua pekerjaan dilempar ke subagent lewat tool `task` (paralel kalau saling bebas). Setelah paham tugasnya dan rencananya jadi, langkah berikutnya WAJIB memanggil `task`.',
        'Ikuti alur spec-kit penuh: constitution → specify → clarify → plan → tasks → analyze → implement. ' + cmds,
        WAIT_RULE,
        'Satu task di tasks.md = satu panggilan `task` dengan instruksi lengkap (file yang disentuh, kriteria selesai). Setelah subagent selesai, verifikasi hasilnya (baca file / jalankan tes) lalu tandai task selesai; kalau gagal, kirim ulang dengan perbaikan.',
        'Kalau ada keputusan besar yang belum jelas, ambil asumsi paling masuk akal dan catat di spec.md, jangan berhenti bertanya.',
        ...(ckpt ? [ckpt] : []),
        // kata kunci omp (huruf kecil, berdiri sendiri, di prosa): mode kerja subagent paralel + verifikasi tiap fase
        'Mode kerja: orchestrate.',
        'Jawaban akhir: ringkasan singkat (apa yang jadi, file utama, cara menjalankan), cocok dibaca di WhatsApp.',
        '',
        '',
    ].join('\n')
}

export function thinkMenu(current) {
    const p = n => thinkProfile(n)
    return [
        `🧠 *Mode Berpikir* — aktif: *${current} (${THINK_NAMES[current]})*`,
        '',
        `*1.* Low — secepat mungkin, ${p(1).model.split('/').pop()}, tanpa subagent`,
        `*2.* Normal — gratis, mikir ringan, ${p(2).model.split('/').pop()}`,
        '*3.* High — model utama, mikir dalam, langsung jawab (tanpa subagent)',
        '*4.* Project — model utama jadi orkestrator, spec-kit penuh, semua dikerjakan subagent',
        '',
        'Pilih: `.agent think <1-4>` (boleh juga low/normal/high/project)',
        'Semua level lewat headroom (hemat token).',
    ].join('\n')
}

/**
 * Model subagent non-Gemini (task, smol, tiny, lalu advisor di urutan terakhir; env OMP_THINK_*_MODEL menang) — dipakai sebagai cadangan fallback.
 * Selalu nilai bawaan/env, bukan Gemini, walau kunci Gemini ada.
 */
export function subagentFallbackModels(env = process.env) {
    return [...new Set([
        validModel(env.OMP_THINK_TASK_MODEL, DEFAULT_SUB.task),
        validModel(env.OMP_THINK_SMOL_MODEL, DEFAULT_SUB.smol),
        validModel(env.OMP_THINK_TINY_MODEL, DEFAULT_SUB.tiny),
        validModel(env.OMP_THINK_ADVISOR_MODEL || env.OMP_AGENT_ADVISOR_MODEL, DEFAULT_ADVISOR), // step-5-preview: paling akhir
    ])]
}

/** Model yang dipakai subagent/advisor (ditandai di daftar .agent model). */
export function subagentSpecs(env = process.env) {
    const p = thinkProfile(3, env)
    return new Set([...Object.values(p.roles), p.advisor].filter(Boolean))
}
