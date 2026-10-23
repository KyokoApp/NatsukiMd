/**
 * Izin tambahan plugin untuk router/agent, dikelola owner lewat `.ompbridge izinkan <path>`.
 * Disimpan di data/omp-agent/allowed-plugins.json dan dibaca ulang otomatis saat file berubah,
 * jadi tidak perlu edit kode atau restart. Daftar bawaan (ALLOWED_PLUGINS di omp-router.js) tetap berlaku.
 *
 * Yang tidak pernah boleh diizinkan: folder owner/, file berawalan "_" (event handler), plugin yang
 * bertanda owner/rowner/mods, dan path di luar pola `folder/nama.js`.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

export const PLUGIN_PATH_RE = /^[a-z0-9_-]+\/[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:js|cjs|mjs)$/
const BLOCKED_FOLDERS = new Set(['owner'])
const MAX_EXTRA = 100

const file = () => path.resolve(process.env.OMP_AGENT_DIR || path.join(process.cwd(), 'data', 'omp-agent'), 'allowed-plugins.json')

let cache = { mtime: -1, set: new Set(), path: '' }

function load() {
    const target = file()
    try {
        const stat = fs.statSync(target)
        if (cache.path === target && cache.mtime === stat.mtimeMs) return cache.set
        const parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
        const list = Array.isArray(parsed?.plugins) ? parsed.plugins : []
        cache = { mtime: stat.mtimeMs, path: target, set: new Set(list.filter(item => typeof item === 'string' && isAllowedShape(item))) }
    } catch {
        cache = { mtime: -1, path: target, set: new Set() }
    }
    return cache.set
}

/** Pola path yang boleh (dicek lagi saat membaca file, jadi isi file yang diedit manual pun tetap disaring). */
export function isAllowedShape(rel) {
    if (!PLUGIN_PATH_RE.test(rel)) return false
    const [folder, name] = rel.split('/')
    return !BLOCKED_FOLDERS.has(folder) && !name.startsWith('_')
}

export function listExtraPlugins() {
    return [...load()]
}

export function isExtraAllowed(rel) {
    return load().has(rel)
}

async function save(set) {
    const target = file()
    await fsp.mkdir(path.dirname(target), { recursive: true })
    const tmp = `${target}.tmp`
    await fsp.writeFile(tmp, JSON.stringify({ plugins: [...set].sort() }, null, 2) + '\n', { mode: 0o600 })
    await fsp.rename(tmp, target)
    cache.mtime = -1 // paksa baca ulang
}

/** Validasi terhadap plugin yang benar-benar termuat. Lempar Error berpesan jelas bila ditolak. */
export function validateForAllow(rel, plugins = global.plugins || {}) {
    if (!isAllowedShape(rel)) {
        throw new Error('Path harus berbentuk folder/nama.js (mis. downloader/tiktok2.js). Folder owner/ dan file berawalan "_" tidak boleh.')
    }
    const plugin = plugins[rel]
    if (plugin === undefined) throw new Error(`Plugin "${rel}" tidak ditemukan di bot (cek ejaan path; harus sudah termuat).`)
    if (typeof plugin !== 'function') throw new Error('Itu bukan plugin command (bukan fungsi).')
    if (plugin.owner || plugin.rowner || plugin.mods) throw new Error('Plugin khusus owner/mods tidak pernah boleh dipakai agent.')
    const help = [].concat(plugin.help || []).filter(item => typeof item === 'string' && item.trim())
    if (!help.length) throw new Error('Plugin ini tidak punya handler.help, jadi tidak bisa masuk katalog.')
    return { plugin, help }
}

export async function addExtraPlugin(rel, plugins) {
    const { plugin, help } = validateForAllow(rel, plugins)
    const set = new Set(load())
    if (set.has(rel)) return { added: false, plugin, help }
    if (set.size >= MAX_EXTRA) throw new Error(`Maksimal ${MAX_EXTRA} plugin tambahan.`)
    set.add(rel)
    await save(set)
    return { added: true, plugin, help }
}

export async function removeExtraPlugin(rel) {
    const set = new Set(load())
    if (!set.delete(rel)) return false
    await save(set)
    return true
}
