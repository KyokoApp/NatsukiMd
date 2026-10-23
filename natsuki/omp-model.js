/**
 * Switch model OMP dari WhatsApp (khusus owner): `.omp model ...`
 *
 *  .omp model                 → model aktif + preset + cara pakai
 *  .omp model <preset|prov/model> → ganti model (chat .omp biasa DAN agent)
 *  .omp model list [kata]     → daftar model dari `omp --list-models`
 *  .omp model tes             → kirim ping ke model aktif (cek key/limit)
 *  .omp model reset           → balik ke model dari env (OMP_MODEL / OMP_AGENT_MODEL)
 *
 * Pilihan disimpan di data/omp-model.json (bertahan setelah restart).
 * Preset opsional lewat env:  OMP_MODEL_PRESETS="free=orca/z-ai/glm-5.3-flash-free,auto=orca/orcarouter/free"
 * Model perantara intent (OMP_INTENT_MODEL / OMP_ROUTER_MODEL) tidak ikut berubah.
 */
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { geminiEnabled, geminiSpec } from '../gemini-keys.js'

const FILE = path.resolve(process.cwd(), 'data', 'omp-model.json')
// provider/model — id model boleh berisi "/" (mis. orca/z-ai/glm-5.3-flash-free) dan akhiran ":thinking"
export const MODEL_SPEC = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:@+\/-]{0,160}$/

let cache = null

function load() {
    if (cache !== null) return cache
    try {
        const data = JSON.parse(fsSync.readFileSync(FILE, 'utf8'))
        cache = typeof data?.model === 'string' && MODEL_SPEC.test(data.model) ? data.model : ''
    } catch {
        cache = ''
    }
    return cache
}

/** Model pilihan owner lewat `.omp model`, atau '' bila memakai default env. */
export function getModelOverride() {
    return load()
}

export async function setModelOverride(spec) {
    if (!MODEL_SPEC.test(String(spec || ''))) throw new Error('Format model harus provider/model, mis. orca/z-ai/glm-5.3-flash-free')
    await fs.mkdir(path.dirname(FILE), { recursive: true })
    await fs.writeFile(FILE, JSON.stringify({ model: spec, at: new Date().toISOString() }), 'utf8')
    cache = spec
}

export async function clearModelOverride() {
    cache = ''
    await fs.rm(FILE, { force: true })
}

/** Tampilkan nama model saja tanpa provider: "clouvia/agnes-3.0-flash" -> "agnes-3.0-flash". */
export function shortModel(spec) {
    const text = String(spec ?? '').trim()
    if (!text || text.startsWith('(')) return text
    return text.split('/').pop() || text
}

/** Model yang sedang dipakai agent / chat (override > env). */
export function activeModels(env = process.env) {
    const override = getModelOverride()
    return {
        override,
        chat: override || (geminiEnabled(env) ? geminiSpec(env) : String(env.OMP_MODEL || '').trim()),
        agent: override || (geminiEnabled(env) ? geminiSpec(env) : String(env.OMP_AGENT_MODEL || env.OMP_MODEL || '').trim()),
    }
}

export function parsePresets(env = process.env) {
    const presets = new Map()
    for (const part of String(env.OMP_MODEL_PRESETS || '').split(',')) {
        const eq = part.indexOf('=')
        if (eq <= 0) continue
        const name = part.slice(0, eq).trim().toLowerCase()
        const spec = part.slice(eq + 1).trim()
        if (/^[a-z0-9_-]{1,24}$/.test(name) && MODEL_SPEC.test(spec)) presets.set(name, spec)
    }
    return presets
}

/**
 * Pahami teks setelah `.omp`. null = bukan perintah model (biar jatuh ke chat biasa,
 * mis. "model apa yang bagus buat coding?").
 * @returns {{action:'show'|'list'|'test'|'reset'|'set'|'pick', index?:number, search?:string, spec?:string, preset?:string}|null}
 */
export function parseModelCommand(text, env = process.env) {
    const match = String(text || '').match(/^\s*model(?:s)?(?:\s+([\s\S]*))?$/i)
    if (!match) return null
    const rest = String(match[1] || '').trim()
    if (!rest) return { action: 'show' }
    const lower = rest.toLowerCase()
    if (['reset', 'default', 'bawaan', 'balik'].includes(lower)) return { action: 'reset' }
    if (['tes', 'test', 'cek', 'ping'].includes(lower)) return { action: 'test' }
    const list = rest.match(/^(?:list|daftar)(?:\s+(\S+(?:\s+\S+)?))?$/i)
    if (list) return { action: 'list', search: list[1] || '' }
    const target = rest.replace(/^(?:set|ganti|pakai|use)\s+/i, '').trim()
    if (/\s/.test(target)) return null
    const presets = parsePresets(env)
    if (presets.has(target.toLowerCase())) return { action: 'set', spec: presets.get(target.toLowerCase()), preset: target.toLowerCase() }
    if (/^\d{1,3}$/.test(target)) return { action: 'pick', index: Number(target) }
    if (MODEL_SPEC.test(target)) return { action: 'set', spec: target }
    return null
}
