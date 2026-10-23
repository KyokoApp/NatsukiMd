/**
 * lib/gemini-keys.js — kumpulan kunci Gemini (AI Studio) dengan fallback otomatis.
 *
 * Kunci dibaca dari .env (boleh banyak):
 *   GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3, ... (sampai _9)
 *   atau satu baris dipisah koma: GEMINI_API_KEYS=kunci1,kunci2,kunci3
 * Model: GEMINI_MODEL (default gemini-3.5-flash).
 * Matikan Gemini untuk Yuki: YUKI_GEMINI=0
 *
 * Kunci yang kuotanya habis / ditolak "istirahat" dulu (cooldown), lalu dilewati sampai pulih.
 */

export const geminiKeys = (env = process.env) => {
    const raw = [env.GEMINI_API_KEY]
    for (let i = 2; i <= 9; i++) raw.push(env[`GEMINI_API_KEY_${i}`])
    raw.push(env.GEMINI_API_KEYS)
    return [...new Set(raw.flatMap(v => String(v || '').split(',')).map(v => v.trim()).filter(Boolean))]
}

export const geminiModel = (env = process.env) => String(env.GEMINI_MODEL || 'gemini-3.5-flash').trim()

/** Spesifikasi model untuk omp: provider "google". */
export const geminiSpec = (env = process.env) => `google/${geminiModel(env)}`

/** true bila Yuki harus memakai Gemini: ada minimal satu kunci dan tidak dimatikan lewat YUKI_GEMINI=0. */
export const geminiEnabled = (env = process.env) => env.YUKI_GEMINI !== '0' && geminiKeys(env).length > 0

/** true bila spesifikasi model memakai provider google (kunci Gemini perlu disuntik). */
export const isGoogleSpec = spec => /^google\//i.test(String(spec || '').trim())

const COOLDOWN_QUOTA = 10 * 60 * 1000 // kuota habis / rate limit
const COOLDOWN_BAD = 60 * 60 * 1000 // kunci salah / ditolak
const COOLDOWN_SERVER = 30 * 1000 // gangguan server: istirahat singkat supaya percobaan berikut pindah kunci
const cooldown = new Map() // kunci -> waktu boleh dicoba lagi

const QUOTA_RE = /\b429\b|quota|resource[_\s-]?exhausted|rate[\s_-]?limit|too many requests|exceeded your current/i
const BAD_RE = /\b40[13]\b|api[_\s-]?key|permission[_\s-]?denied|unauthori[sz]ed|invalid[_\s-]?(?:api|key|credential)|credential/i
const SERVER_RE = /\b5\d\d\b|overloaded|unavailable|econnreset|etimedout|enotfound|socket hang up/i

/** Teks error apa pun jadi string pendek (tanpa objek axios utuh yang bisa memuat kunci). */
export const errorText = e => String(e?.response?.data?.error?.message || e?.message || e || '').slice(0, 300)

/**
 * Klasifikasi error Gemini: 'quota' | 'bad' | 'server' | null (bukan masalah kunci, jangan pindah kunci).
 * Dipakai untuk error axios maupun pesan error proses omp.
 */
export function classifyGeminiError(e) {
    const st = e?.response?.status
    const text = `${errorText(e)} ${e?.stderr || ''}`
    if (st === 429) return 'quota'
    if (st === 401 || st === 403) return 'bad'
    if (st >= 500) return 'server'
    if (QUOTA_RE.test(text)) return 'quota'
    if (BAD_RE.test(text)) return 'bad'
    if (SERVER_RE.test(text)) return 'server'
    return null
}

export function markKeyFailed(key, kind) {
    if (!key) return
    if (kind === 'quota') cooldown.set(key, Date.now() + COOLDOWN_QUOTA)
    else if (kind === 'bad') cooldown.set(key, Date.now() + COOLDOWN_BAD)
    else if (kind === 'server') cooldown.set(key, Date.now() + COOLDOWN_SERVER)
}

/**
 * Urutan kunci yang layak dicoba: yang tidak sedang istirahat dulu. Kalau semuanya istirahat,
 * kembalikan semua (urut paling cepat pulih) supaya tetap ada yang dicoba.
 */
export function keyOrder(env = process.env) {
    const keys = geminiKeys(env)
    const now = Date.now()
    const all = keys.map((key, i) => ({ key, n: i + 1 }))
    const ready = all.filter(x => (cooldown.get(x.key) || 0) <= now)
    return ready.length ? ready : all.sort((a, b) => (cooldown.get(a.key) || 0) - (cooldown.get(b.key) || 0))
}

/** Kunci terbaik saat ini (atau '' bila tidak ada kunci). */
export const pickKey = (env = process.env) => keyOrder(env)[0]?.key || ''

/** Nomor urut kunci (1-based) untuk log; kunci asli tidak pernah dicetak. */
export const keyNumber = (key, env = process.env) => geminiKeys(env).indexOf(key) + 1
