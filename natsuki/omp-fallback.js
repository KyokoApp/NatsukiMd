/**
 * lib/omp-fallback.js — fallback model antar provider untuk Yuki (fitur bawaan OMP: retry.fallbackChains).
 *
 * Kalau model yang dipakai kena kuota / error / provider mati di TENGAH proses, OMP pindah sendiri ke model
 * berikutnya dan melanjutkan giliran yang sama (tidak mati).
 *
 * Daftar model cadangan:
 *   OMP_FALLBACK_MODELS=google/gemini-3.5-flash,clouvia/agnes-3.0-flash   (urut dari paling diutamakan)
 *   Kosong = otomatis: model Gemini (bila ada kunci) lalu model subagent (task/smol/tiny = agnes-3.0/2.5/2.0-flash, terakhir advisor step-5-preview).
 *   OMP_FALLBACK=0 mematikan fitur ini.
 * Semua model harus ada di OMP (provider-nya sudah login / ada di models.yml).
 */
import { MODEL_SPEC } from './omp-model.js'
import { subagentFallbackModels } from './omp-think.js'
import { geminiEnabled, geminiSpec } from '../gemini-keys.js'

const uniq = list => [...new Set(list)]
const valid = list => uniq(list.map(v => String(v || '').trim()).filter(v => MODEL_SPEC.test(v)))
const baseId = spec => spec.replace(/:(?:off|minimal|low|medium|high|xhigh|thinking)$/i, '')

/** Urutan model cadangan (kosong bila fitur mati / hanya ada satu model). */
export function fallbackModels(env = process.env) {
    if (env.OMP_FALLBACK === '0') return []
    const explicit = String(env.OMP_FALLBACK_MODELS || '').split(',')
    const list = valid(explicit.some(v => v.trim()) ? explicit : [
        geminiEnabled(env) ? geminiSpec(env) : '',
        ...subagentFallbackModels(env), // cadangan = model subagent (agnes-*), sama seperti di models.yml / config
    ])
    return list.length >= 2 ? list : []
}

/**
 * Rantai per model: tiap model utama punya cadangan = daftar di atas tanpa dirinya sendiri.
 * @param {string[]} primaries model yang dipakai sesi (model utama, role subagent, advisor)
 * @returns {Record<string,string[]>} kunci: "default" + tiap model utama
 */
export function buildFallbackChains(primaries = [], env = process.env) {
    const list = fallbackModels(env)
    if (!list.length) return {}
    const chains = { default: list }
    for (const p of valid(primaries)) {
        const chain = list.filter(x => baseId(x) !== baseId(p))
        if (chain.length) chains[p] = chain
    }
    return chains
}

/** Baris YAML untuk config.yml / overlay OMP. */
export function fallbackYamlLines(chains) {
    if (!chains || !Object.keys(chains).length) return []
    const lines = ['retry:', '  modelFallback: true', '  fallbackChains:']
    for (const [key, chain] of Object.entries(chains)) {
        lines.push(`    ${key === 'default' ? 'default' : `"${key}"`}:`)
        for (const m of chain) lines.push(`      - "${m}"`)
    }
    return lines
}
