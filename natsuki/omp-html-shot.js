// Potret file HTML hasil agent jadi gambar (JPEG kecil, siap ditanam base64 di pesan rich).
// Memakai scripts/shot-html.py (Playwright Python). Env: OMP_PYTHON (nama/path python), OMP_AGENT_HTML_SHOT=0 mematikan.
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const MAX_RAW_BYTES = 125 * 1024 // ~170 KB setelah base64

function run(command, args, timeoutMs) {
    return new Promise((resolve, reject) => {
        execFile(command, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                error.stderrText = String(stderr || '').trim()
                return reject(error)
            }
            resolve(stdout)
        })
    })
}

async function shrink(png) {
    let sharp
    try { sharp = (await import('sharp')).default } catch { throw new Error('modul sharp tidak ada') }
    for (const [width, quality] of [[720, 72], [600, 60], [480, 50]]) {
        const { data, info } = await sharp(png).resize({ width, withoutEnlargement: true }).jpeg({ quality }).toBuffer({ resolveWithObject: true })
        if (data.length <= MAX_RAW_BYTES) return { buffer: data, width: info.width, height: info.height }
    }
    throw new Error('gambar tidak bisa diperkecil')
}

/** @returns {Promise<{buffer:Buffer,width:number,height:number}>} */
export async function shotHtmlFile(absPath, { timeoutMs = 45000 } = {}) {
    const script = path.resolve(process.cwd(), 'scripts', 'shot-html.py')
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'omp-shot-'))
    const out = path.join(dir, 'shot.png')
    try {
        const candidates = [process.env.OMP_PYTHON, 'python3', 'python'].filter(Boolean)
        let lastError = null
        for (const python of candidates) {
            try {
                await run(python, [script, absPath, out], timeoutMs)
                lastError = null
                break
            } catch (error) {
                lastError = error
                if (error.code !== 'ENOENT') break // python ada tapi skripnya gagal: jangan coba yang lain
            }
        }
        if (lastError) {
            const detail = lastError.stderrText || lastError.message || 'gagal'
            throw new Error(lastError.code === 'ENOENT' ? 'python tidak ditemukan di server (atur OMP_PYTHON)' : detail.slice(0, 300))
        }
        return await shrink(await fs.readFile(out))
    } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
}
