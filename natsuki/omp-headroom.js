// Headroom (kompres konteks) sebagai proxy lokal di depan router model. Aktif bila OMP_HEADROOM=1.
// Bot menjalankan & menjaga prosesnya sendiri. Arahkan baseUrl provider di models.yml ke http://127.0.0.1:8787/v1.
//   OMP_HEADROOM_PORT      (default 8787)
//   OMP_HEADROOM_UPSTREAM  URL router asli (default https://router.clouvia.id)  → diteruskan sebagai OPENAI_TARGET_API_URL
//   HEADROOM_BIN           path perintah headroom (default: headroom, lalu ~/.local/bin/headroom)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PORT = () => Number(process.env.OMP_HEADROOM_PORT) || 8787
let child = null
let starting = null
let lastError = ''
let failures = 0

export function headroomEnabled() {
    return process.env.OMP_HEADROOM === '1'
}

async function healthy(timeoutMs = 1500) {
    try {
        const res = await fetch(`http://127.0.0.1:${PORT()}/health`, { signal: AbortSignal.timeout(timeoutMs) })
        return res.ok
    } catch {
        return false
    }
}

function resolveBin() {
    const override = String(process.env.HEADROOM_BIN || '').trim()
    if (override) return override
    const local = path.join(os.homedir(), '.local', 'bin', 'headroom')
    return fs.existsSync(local) ? local : 'headroom'
}

async function spawnProxy() {
    const bin = resolveBin()
    const env = {
        ...process.env,
        OPENAI_TARGET_API_URL: process.env.OMP_HEADROOM_UPSTREAM || 'https://router.clouvia.id',
    }
    child = spawn(bin, ['proxy', '--port', String(PORT())], { env, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-600) })
    child.on('error', error => { lastError = error.code === 'ENOENT' ? 'perintah headroom tidak ditemukan (pip install --user "headroom-ai[proxy]")' : error.message })
    child.on('exit', code => {
        child = null
        if (code) lastError = `headroom berhenti (kode ${code}) ${stderr.trim().split('\n').pop() || ''}`.trim()
    })
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
        if (await healthy(1000)) { lastError = ''; failures = 0; return true }
        if (!child) break
        await new Promise(r => setTimeout(r, 1000))
    }
    try { child?.kill() } catch {}
    child = null
    failures++
    return false
}

/** Pastikan proxy hidup. Aman dipanggil berulang. Mengembalikan true bila siap. */
export async function ensureHeadroom() {
    if (!headroomEnabled()) return false
    if (await healthy()) return true
    if (failures >= 3) return false // berhenti mencoba tiap giliran; .agent think / restart bot untuk reset
    if (!starting) starting = spawnProxy().finally(() => { starting = null })
    const ok = await starting
    if (!ok) console.error('[HEADROOM] gagal start:', lastError || 'timeout 60 detik')
    return ok
}

export async function headroomStatus() {
    if (!headroomEnabled()) return { enabled: false, up: false, error: '' }
    const up = await healthy()
    if (up) failures = 0
    return { enabled: true, up, error: lastError }
}

process.on('exit', () => { try { child?.kill() } catch {} })
