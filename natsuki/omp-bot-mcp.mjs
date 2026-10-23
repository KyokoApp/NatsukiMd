#!/usr/bin/env node
/**
 * Server MCP (stdio) tanpa dependensi untuk agent OMP. Meneruskan tiga tool ke bridge di proses bot:
 *   bot_commands     → daftar fitur bot yang boleh dipakai
 *   run_bot_command  → jalankan satu fitur bot (hasil sukses/gagal dikembalikan ke agent)
 *   agent_notes      → baca / tambah catatan permanen agent
 * Env: OMP_BRIDGE_URL (mis. http://127.0.0.1:39517), OMP_BRIDGE_TOKEN.
 * Transport MCP stdio = satu pesan JSON-RPC per baris.
 */
import readline from 'node:readline'

const URL_BASE = String(process.env.OMP_BRIDGE_URL || 'http://127.0.0.1:39517').replace(/\/+$/, '')
const TOKEN = String(process.env.OMP_BRIDGE_TOKEN || '')
const CALL_TIMEOUT_MS = Number(process.env.OMP_BRIDGE_TIMEOUT_MS) || 180_000

const TOOLS = [
    {
        name: 'bot_commands',
        description: 'Daftar fitur bot WhatsApp yang bisa kamu jalankan (nama | cara pakai — fungsi). Panggil ini bila ragu nama perintah yang tepat.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'run_bot_command',
        description: 'Jalankan satu fitur bot (mis. ssweb, sticker, ytmp3, removebg) atas nama pengguna. Hasilnya (gambar/stiker/file) dikirim langsung ke chat. Kamu dapat balasan OK/GAGAL/DITOLAK; laporkan apa adanya. Link di args harus ada di pesan pengguna. Maks 3 kali per tugas.',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'Nama perintah tanpa awalan, persis seperti di bot_commands (mis. "ssweb").' },
                args: { type: 'string', description: 'Argumen: link/judul/teks dari pesan pengguna. Kosongkan bila fitur memakai media yang dikirim/dibalas.' },
            },
            required: ['command'],
            additionalProperties: false,
        },
    },
    {
        name: 'agent_notes',
        description: 'Catatan permanen antar tugas. action "add": simpan SATU pelajaran/preferensi singkat (maks 400 karakter) yang berguna di tugas berikutnya. action "read": baca semua catatan. Jangan simpan rahasia, token, atau isi pesan pribadi.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['read', 'add'] },
                text: { type: 'string', description: 'Isi catatan (untuk action "add").' },
            },
            required: ['action'],
            additionalProperties: false,
        },
    },
]

async function callBridge(body) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS)
    try {
        const res = await fetch(`${URL_BASE}/v1/call`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
            body: JSON.stringify(body),
            signal: controller.signal,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok && !data.text) return { ok: false, text: `bridge membalas HTTP ${res.status}` }
        return { ok: Boolean(data.ok), text: String(data.text ?? '') }
    } catch (error) {
        const why = error?.name === 'AbortError' ? 'timeout menunggu fitur bot' : String(error?.message || error)
        return { ok: false, text: `Jembatan ke bot tidak bisa dihubungi (${why}). Fitur bot sedang tidak tersedia; beri tahu pengguna.` }
    } finally {
        clearTimeout(timer)
    }
}

const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')

async function handle(msg) {
    const { id, method, params } = msg
    const isRequest = id !== undefined && id !== null
    if (method === 'initialize') {
        return send({ id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'hoshino-bot', version: '1.0.0' } } })
    }
    if (method === 'ping') return isRequest && send({ id, result: {} })
    if (method === 'tools/list') return send({ id, result: { tools: TOOLS } })
    if (method === 'tools/call') {
        const name = params?.name
        const args = params?.arguments || {}
        if (!TOOLS.some(tool => tool.name === name)) {
            return send({ id, error: { code: -32602, message: `tool tidak dikenal: ${name}` } })
        }
        const out = await callBridge({ tool: name, ...args })
        return send({ id, result: { content: [{ type: 'text', text: out.text }], isError: !out.ok } })
    }
    if (isRequest) send({ id, error: { code: -32601, message: `method tidak didukung: ${method}` } })
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', line => {
    const text = line.trim()
    if (!text) return
    let msg
    try { msg = JSON.parse(text) } catch { return }
    handle(msg).catch(error => {
        if (msg?.id !== undefined && msg?.id !== null) send({ id: msg.id, error: { code: -32603, message: String(error?.message || error) } })
    })
})
rl.on('close', () => process.exit(0))
