/**
 * Jembatan agent → fitur bot.
 *
 * Agent (proses `omp`) tidak bisa memanggil kode bot secara langsung. Jembatannya:
 *   agent ──MCP stdio──> lib/omp-bot-mcp.mjs ──HTTP loopback──> bridge ini (di proses bot)
 * Bridge menjalankan fitur bot atas nama pengirim yang sedang dilayani agent, dengan aturan
 * akses yang sama seperti router (runBotCommandForAgent), lalu mengembalikan hasilnya ke agent
 * sebagai teks supaya agent tahu berhasil/gagalnya.
 *
 * Keamanan:
 *  - Hanya mendengar di 127.0.0.1. Wajib token (OMP_BRIDGE_TOKEN).
 *  - Hanya melayani selama ada turn agent yang aktif. Kalau ada >1 turn aktif sekaligus,
 *    panggilan ditolak (tidak boleh salah menjalankan fitur atas nama orang lain).
 *  - Maks MAX_RUNS_PER_TURN fitur per tugas, dijalankan berurutan (satu per satu).
 *  - Tool "agent_notes" hanya menulis ke file catatan milik bot (lib/omp-agent-notes.js).
 */
import crypto from 'node:crypto'
import http from 'node:http'
import { describeBotCatalog, runBotCommandForAgent } from './omp-router.js'
import { addNote, readNotes } from './omp-agent-notes.js'

export const MAX_RUNS_PER_TURN = 3
const MAX_BODY_BYTES = 16 * 1024
const DEFAULT_PORT = 39517

const activeTurns = new Map() // sessionKey -> ctx
let server = null
let listening = null

export function bridgeEnabled(env = process.env) {
    return env.OMP_BOT_BRIDGE === '1'
}

export function bridgeConfig(env = process.env) {
    const port = Number(env.OMP_BRIDGE_PORT) || DEFAULT_PORT
    return { port, url: `http://127.0.0.1:${port}`, token: String(env.OMP_BRIDGE_TOKEN || '').trim() }
}

/** Daftarkan turn agent yang sedang jalan. Kembalikan ctx (berisi `runs` = riwayat fitur yang dipanggil agent). */
export function beginBotTurn(key, { m, extra, sourceText = '' }) {
    const ctx = { key, m, extra, sourceText: String(sourceText), runs: [], queue: Promise.resolve() }
    activeTurns.set(key, ctx)
    return ctx
}

export function endBotTurn(key, ctx) {
    if (activeTurns.get(key) === ctx) activeTurns.delete(key)
}

function soleTurn() {
    if (activeTurns.size === 1) return [...activeTurns.values()][0]
    return null
}

function describeResult(command, res) {
    switch (res.status) {
        case 'ok': return `OK: perintah .${command} sudah dijalankan dan hasilnya (gambar/stiker/file) dikirim langsung ke chat pengguna. Kamu tidak perlu mengirim ulang; cukup konfirmasi singkat.`
        case 'error': return `GAGAL: .${command} error: ${res.error}. Beri tahu pengguna jujur bahwa fitur gagal; jangan bilang berhasil.`
        case 'denied': return `DITOLAK: .${command} tidak boleh dipakai pengguna ini (${res.reason}). Sampaikan alasannya.`
        case 'banned': return `DITOLAK: ${res.reason}.`
        case 'rejected': return `DITOLAK: ${res.reason}.`
        default: return `TIDAK DIJALANKAN: ${res.reason || 'perintah tidak dikenal'}.`
    }
}

async function handleCall(body) {
    const ctx = soleTurn()
    if (!ctx) return { ok: false, text: 'Tidak ada tugas agent aktif (atau lebih dari satu), jembatan fitur bot menolak.' }
    const tool = String(body.tool || '')

    if (tool === 'bot_commands') {
        const text = describeBotCatalog(ctx.extra)
        console.log(`[OMP BRIDGE] bot_commands -> ${text ? text.split('\n').length : 0} fitur, ${text.length} karakter`)
        return { ok: true, text: text || '(katalog fitur bot kosong)' }
    }

    if (tool === 'agent_notes') {
        const action = String(body.action || 'read')
        if (action === 'read') return { ok: true, text: (await readNotes(ctx.key)) || '(belum ada catatan)' }
        if (action === 'add') {
            try {
                const total = await addNote(ctx.key, body.text)
                return { ok: true, text: `Catatan tersimpan (${total} catatan). Catatan ikut dibawa di tugas berikutnya.` }
            } catch (error) {
                return { ok: false, text: `Catatan gagal disimpan: ${error.message}` }
            }
        }
        return { ok: false, text: 'action harus "read" atau "add"' }
    }

    if (tool === 'run_bot_command') {
        const command = String(body.command || '')
        const run = ctx.queue.then(async () => {
            if (ctx.runs.length >= MAX_RUNS_PER_TURN) {
                return { ok: false, text: `Batas ${MAX_RUNS_PER_TURN} fitur bot per tugas sudah tercapai. Minta pengguna mengirim permintaan baru.` }
            }
            let res
            try {
                res = await runBotCommandForAgent(ctx.m, ctx.extra, command, body.args, ctx.sourceText)
            } catch (error) {
                res = { status: 'error', error: String(error?.message || error).slice(0, 300) }
            }
            ctx.runs.push({ command, args: String(body.args || '').slice(0, 120), status: res.status, detail: res.error || res.reason || '' })
            return { ok: res.status === 'ok', text: describeResult(command.toLowerCase(), res) }
        })
        ctx.queue = run.catch(() => {})
        return await run
    }

    return { ok: false, text: `tool tidak dikenal: ${tool}` }
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let size = 0
        const chunks = []
        req.on('data', chunk => {
            size += chunk.length
            if (size > MAX_BODY_BYTES) { reject(new Error('body terlalu besar')); req.destroy(); return }
            chunks.push(chunk)
        })
        req.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (error) { reject(error) }
        })
        req.on('error', reject)
    })
}

function tokenOk(header, token) {
    const given = Buffer.from(String(header || '').replace(/^Bearer\s+/i, ''))
    const want = Buffer.from(token)
    return given.length === want.length && crypto.timingSafeEqual(given, want)
}

/** Nyalakan bridge (idempotent). Resolve { port, url } atau lempar error bila token kosong. */
export function startBotBridge(env = process.env) {
    if (listening) return listening
    const { port, url, token } = bridgeConfig(env)
    if (token.length < 16) {
        return Promise.reject(new Error('OMP_BRIDGE_TOKEN wajib diisi (minimal 16 karakter acak) bila OMP_BOT_BRIDGE=1.'))
    }
    listening = new Promise((resolve, reject) => {
        server = http.createServer(async (req, res) => {
            const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
            if (req.method !== 'POST' || req.url !== '/v1/call') return send(404, { ok: false, text: 'not found' })
            if (!tokenOk(req.headers.authorization, token)) return send(401, { ok: false, text: 'token salah' })
            try {
                send(200, await handleCall(await readJson(req)))
            } catch (error) {
                send(400, { ok: false, text: `request tidak valid: ${error.message}` })
            }
        })
        server.once('error', error => { listening = null; server = null; reject(error) })
        server.listen(port, '127.0.0.1', () => { server.unref(); resolve({ port: server.address().port, url }) })
    })
    return listening
}

export async function stopBotBridge() {
    const current = server
    server = null
    listening = null
    activeTurns.clear()
    if (current) await new Promise(resolve => current.close(() => resolve()))
}
