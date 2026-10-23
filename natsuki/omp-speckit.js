// Pasang spec-kit (github/spec-kit) ke workspace agent: `specify init` jalan di HOST (bukan di sandbox),
// menghasilkan .specify/ dan panduan tahap di .speckit/commands/speckit.*.md yang dibaca agent.
//   SPECKIT_BIN  path perintah specify (default: specify, lalu ~/.local/bin/specify)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const inflight = new Map()

function resolveBin() {
    const override = String(process.env.SPECKIT_BIN || '').trim()
    if (override) return override
    const local = path.join(os.homedir(), '.local', 'bin', 'specify')
    return fs.existsSync(local) ? local : 'specify'
}

function run(bin, args, cwd, timeoutMs) {
    return new Promise(resolve => {
        let out = ''
        let child
        try {
            child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } })
        } catch (error) {
            return resolve({ ok: false, error: error.message })
        }
        const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, timeoutMs)
        child.stdout.on('data', c => { out = (out + c).slice(-500) })
        child.stderr.on('data', c => { out = (out + c).slice(-500) })
        child.on('error', error => { clearTimeout(timer); resolve({ ok: false, error: error.code === 'ENOENT' ? 'specify tidak ditemukan' : error.message }) })
        child.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0, error: code === 0 ? '' : out.trim().split('\n').pop() || `kode ${code}` }) })
    })
}

/** @returns {Promise<{ok:boolean, error?:string}>} sekali per workspace; berikutnya langsung ok. */
export function ensureSpecKit(workDir) {
    if (fs.existsSync(path.join(workDir, '.specify')) && fs.existsSync(path.join(workDir, '.speckit', 'commands'))) {
        return Promise.resolve({ ok: true })
    }
    if (inflight.has(workDir)) return inflight.get(workDir)
    const job = run(resolveBin(), ['init', '--here', '--force', '--ai', 'generic', '--ai-commands-dir', '.speckit/commands', '--no-git'], workDir, 180_000)
        .finally(() => inflight.delete(workDir))
    inflight.set(workDir, job)
    return job
}
