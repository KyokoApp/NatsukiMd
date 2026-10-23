/**
 * Klien RPC untuk Oh My Pi (omp --mode rpc).
 *
 * Beda dengan lib/omp-runner.js (omp -p, sekali pakai):
 *   - satu proses omp hidup terus per sesi → tidak cold start tiap pesan
 *   - event asli streaming (tool mulai/selesai, teks) → bisa jadi status live
 *   - abort sungguhan (kirim {"type":"abort"}, kill bila macet)
 *   - sesi native omp (--continue + PI_CODING_AGENT_SESSION_DIR)
 *
 * Protokol: JSON per baris (NDJSON) lewat stdin/stdout. Bentuk frame yang dikenali
 * sengaja dibuat toleran (beberapa nama field alternatif) karena belum semua
 * frame omp terdokumentasi resmi. Cek di mesin kamu dengan:
 *     node scripts/omp-rpc-probe.mjs
 */

import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

const MAX_LINE_CHARS = 8 * 1024 * 1024
const MAX_TEXT_CHARS = 200_000
const STDERR_TAIL_CHARS = 4000
const ABORT_GRACE_MS = 6000
const COMMAND_TIMEOUT_MS = 15000
// omp RPC v1: satu frame masuk (termasuk newline) maksimal 1 MiB (maxFrameBytes). Sisakan ruang aman.
const MAX_INBOUND_FRAME_BYTES = 1024 * 1024 - 4096

export class OmpRpcError extends Error {
    constructor(message, { code = 'rpc_error', partialText = '', stderr = '', seenTypes = [] } = {}) {
        super(message)
        this.name = 'OmpRpcError'
        this.code = code
        this.partialText = partialText
        this.stderr = stderr
        this.seenTypes = seenTypes
    }
}

/** Ambil teks dari pesan omp/pi: content bisa string atau array blok {type:'text', text}. */
export function messageText(message) {
    if (!message) return ''
    const content = message.content ?? message.text
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content
        .map(block => (typeof block === 'string' ? block : block?.type === 'text' ? block.text : ''))
        .filter(Boolean)
        .join('')
}

function lastAssistantMessage(messages) {
    if (!Array.isArray(messages)) return null
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === 'assistant') return messages[i]
    }
    return null
}

/** Ubah satu frame mentah jadi bentuk seragam { kind, ... }. Fungsi murni (mudah dites). */
export function normalizeFrame(frame) {
    if (!frame || typeof frame !== 'object') return { kind: 'unknown', type: typeof frame, raw: frame }
    const type = String(frame.type || '')
    switch (type) {
        case 'response':
            return {
                kind: 'response', id: frame.id, command: frame.command,
                success: frame.success !== false, error: frame.error, data: frame.data, raw: frame,
            }
        case 'prompt_result':
            return {
                kind: 'prompt_result', id: frame.id,
                stopReason: frame.stopReason ?? frame.stop_reason, usage: frame.usage, error: frame.error, raw: frame,
            }
        case 'agent_start':
            return { kind: 'agent_start', raw: frame }
        case 'agent_end':
            // isTerminal === false: omp masih punya kerja terjadwal (hasil subagent/job latar belakang) dan akan lanjut sendiri.
            return { kind: 'agent_end', messages: frame.messages, isTerminal: frame.isTerminal, raw: frame }
        case 'message_start':
            return { kind: 'message_start', role: frame.message?.role, raw: frame }
        case 'message_update': {
            const ev = frame.assistantMessageEvent || frame.event || {}
            const sub = String(ev.type || '')
            const delta = ev.delta ?? ev.text ?? ''
            if (sub === 'text_delta') return { kind: 'text_delta', text: String(delta), raw: frame }
            if (sub === 'thinking_delta') return { kind: 'thinking_delta', text: String(delta), raw: frame }
            return { kind: 'message_update', subtype: sub, raw: frame }
        }
        case 'message_end':
            return { kind: 'message_end', role: frame.message?.role, message: frame.message, text: messageText(frame.message), raw: frame }
        case 'tool_execution_start':
            return {
                kind: 'tool_start', id: frame.toolCallId ?? frame.tool_call_id ?? frame.id,
                name: frame.toolName ?? frame.tool_name ?? frame.name, args: frame.args ?? frame.arguments ?? frame.input, raw: frame,
            }
        case 'tool_execution_update':
            return {
                kind: 'tool_update', id: frame.toolCallId ?? frame.tool_call_id ?? frame.id,
                name: frame.toolName ?? frame.tool_name ?? frame.name, raw: frame,
            }
        case 'tool_execution_end':
            return {
                kind: 'tool_end', id: frame.toolCallId ?? frame.tool_call_id ?? frame.id,
                name: frame.toolName ?? frame.tool_name ?? frame.name,
                isError: Boolean(frame.isError ?? frame.is_error), raw: frame,
            }
        case 'auto_compaction_start':
        case 'auto_compaction_end':
            return { kind: 'compaction', phase: type.endsWith('start') ? 'start' : 'end', raw: frame }
        case 'error':
            return { kind: 'error', message: String(frame.message ?? frame.error ?? 'error'), raw: frame }
        default:
            return { kind: 'unknown', type, raw: frame }
    }
}

/** Buang entri gambar yang bentuknya salah; terima {data, mimeType} atau {buffer, mimeType}. */
export function normalizeImages(images) {
    if (!Array.isArray(images)) return []
    const out = []
    for (const item of images) {
        if (!item || typeof item !== 'object') continue
        const mimeType = String(item.mimeType || item.mimetype || '').toLowerCase()
        let data = item.data
        if (!data && item.buffer) data = Buffer.from(item.buffer).toString('base64')
        else if (Buffer.isBuffer(data)) data = data.toString('base64')
        if (!/^image\/(?:png|jpe?g|webp|gif)$/.test(mimeType) || typeof data !== 'string' || !data) continue
        out.push({ type: 'image', data, mimeType })
        if (out.length >= 3) break
    }
    return out
}

export class OmpRpcSession extends EventEmitter {
    #opts
    #child = null
    #buffer = ''
    #stderrTail = ''
    #nextId = 1
    #pending = new Map()
    #turn = null
    #queue = Promise.resolve()
    #seenTypes = new Set()
    #closed = false

    constructor({ command, args = [], cwd, env, spawnImpl = spawn, label = 'omp-rpc', abortGraceMs = ABORT_GRACE_MS, stallCheckMs = 5000 } = {}) {
        super()
        if (!command) throw new TypeError('OmpRpcSession: command wajib diisi')
        this.#opts = { command, args, cwd, env, spawnImpl, label, abortGraceMs, stallCheckMs }
    }

    get alive() {
        return Boolean(this.#child && this.#child.exitCode === null && !this.#child.killed && !this.#closed)
    }

    get busy() {
        return Boolean(this.#turn)
    }

    get pid() {
        return this.#child?.pid ?? null
    }

    get stderrTail() {
        return this.#stderrTail
    }

    async start() {
        if (this.alive) return
        this.#closed = false
        this.#buffer = ''
        this.#stderrTail = ''
        const { command, args, cwd, env, spawnImpl } = this.#opts
        const child = spawnImpl(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
        this.#child = child

        child.stdin.on('error', () => {})
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', chunk => this.#feed(chunk))
        child.stderr.on('data', chunk => {
            this.#stderrTail = (this.#stderrTail + chunk).slice(-STDERR_TAIL_CHARS)
        })
        child.on('exit', (code, signal) => this.#onExit(child, code, signal))

        let spawned = false
        await new Promise((resolve, reject) => {
            child.once('spawn', () => { spawned = true; resolve() })
            child.on('error', error => {
                if (!spawned) {
                    this.#child = null
                    reject(error.code === 'ENOENT'
                        ? new OmpRpcError('Perintah omp tidak ditemukan. Pasang omp atau atur OMP_BIN.', { code: 'not_found' })
                        : error)
                    return
                }
                this.#failTurn(new OmpRpcError(`Proses omp error: ${error.message}`, { code: 'process_error' }))
            })
        })
    }

    /**
     * Kirim satu tugas. Giliran diserialkan per sesi.
     * @returns {{text:string, stopReason?:string, usage?:object, aborted:boolean, tools:string[], error?:string}}
     */
    prompt(message, { onEvent, timeoutMs = 300000, stallMs = 180000, images } = {}) {
        const run = () => this.#runTurn(String(message), { onEvent, timeoutMs, stallMs, images })
        const result = this.#queue.then(run, run)
        this.#queue = result.catch(() => {})
        return result
    }

    /** Snapshot sesi omp (model, thinking, daftar tool yang dilihat model: dumpTools). Dipakai untuk diagnosis. */
    async state() {
        await this.start()
        return await this.#command('get_state')
    }

    /** Hentikan giliran yang sedang jalan. true bila ada yang dihentikan. */
    abort(reason = 'user') {
        const turn = this.#turn
        if (!turn || turn.ending) return false
        // Sudah pernah diminta berhenti: jangan pasang ulang timer kill paksa. Pemeriksa stall berjalan tiap beberapa detik;
        // kalau tiap kali menunda timer ini, omp yang tidak membalas abort tidak pernah dimatikan.
        if (turn.aborted) return true
        turn.aborted = true
        turn.abortReason = reason
        this.#write({ type: 'abort' })
        clearTimeout(turn.graceTimer)
        turn.graceTimer = setTimeout(() => {
            // omp tidak merespons abort → matikan paksa; sesi akan dibuat ulang di giliran berikutnya
            this.#child?.kill('SIGKILL')
        }, this.#opts.abortGraceMs)
        return true
    }

    async close() {
        this.#closed = true
        const child = this.#child
        if (this.#turn) this.#failTurn(new OmpRpcError('Sesi ditutup.', { code: 'closed' }))
        if (!child || child.exitCode !== null) return
        try { child.stdin.end() } catch {}
        const exited = new Promise(resolve => child.once('exit', resolve))
        child.kill('SIGTERM')
        const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
        await exited
        clearTimeout(timer)
    }

    // ───────────────────────── internal ─────────────────────────

    #write(object) {
        if (!this.#child?.stdin?.writable) return false
        this.#child.stdin.write(JSON.stringify(object) + '\n')
        return true
    }

    #command(type, extra = {}, timeoutMs = COMMAND_TIMEOUT_MS) {
        return new Promise((resolve, reject) => {
            const id = `c${this.#nextId++}`
            const timer = setTimeout(() => {
                this.#pending.delete(id)
                reject(new OmpRpcError(`Perintah ${type} tidak dibalas omp.`, { code: 'command_timeout' }))
            }, timeoutMs)
            this.#pending.set(id, { resolve, reject, timer, type })
            if (!this.#write({ id, type, ...extra })) {
                clearTimeout(timer)
                this.#pending.delete(id)
                reject(new OmpRpcError('Proses omp tidak aktif.', { code: 'not_running' }))
            }
        })
    }

    #feed(chunk) {
        this.#buffer += chunk
        let index
        while ((index = this.#buffer.indexOf('\n')) !== -1) {
            const line = this.#buffer.slice(0, index).replace(/\r$/, '')
            this.#buffer = this.#buffer.slice(index + 1)
            this.#handleLine(line)
        }
        if (this.#buffer.length > MAX_LINE_CHARS) this.#buffer = ''
    }

    #handleLine(line) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('{')) return
        let frame
        try { frame = JSON.parse(trimmed) } catch { return }
        const norm = normalizeFrame(frame)
        this.#seenTypes.add(norm.kind === 'unknown' ? `?${norm.type}` : String(frame.type))

        if (norm.kind === 'response' && norm.id != null) {
            const pending = this.#pending.get(String(norm.id))
            if (pending) {
                clearTimeout(pending.timer)
                this.#pending.delete(String(norm.id))
                if (norm.success) pending.resolve(norm.data)
                else pending.reject(new OmpRpcError(String(norm.error || `${pending.type} ditolak omp`), { code: 'command_failed' }))
                return
            }
        }
        this.emit('frame', norm)
        if (this.#turn) this.#onTurnFrame(this.#turn, norm)
    }

    #onTurnFrame(turn, norm) {
        turn.lastFrameAt = Date.now()
        switch (norm.kind) {
            case 'response':
                if (String(norm.id) === turn.promptId && !norm.success) {
                    this.#finishTurn(turn, new OmpRpcError(String(norm.error || 'Prompt ditolak omp.'), { code: 'prompt_rejected' }))
                    return
                }
                break
            case 'message_start':
                if (norm.role === 'assistant') turn.deltaText = ''
                break
            case 'text_delta':
                if (turn.deltaText.length < MAX_TEXT_CHARS) turn.deltaText += norm.text
                break
            case 'message_end':
                if (norm.role === 'assistant' && norm.text) turn.lastMessageText = norm.text
                break
            case 'tool_start':
                turn.activeTools.add(norm.id ?? norm.name)
                turn.tools.push(String(norm.name || 'tool'))
                break
            case 'tool_end':
                turn.activeTools.delete(norm.id ?? norm.name)
                break
            case 'error':
                turn.lastError = norm.message
                break
            case 'agent_end': {
                const last = lastAssistantMessage(norm.messages)
                if (last) {
                    const text = messageText(last)
                    if (text) turn.lastMessageText = text
                    if (last.stopReason) turn.stopReason = last.stopReason
                    if (last.errorMessage) turn.lastError = last.errorMessage
                    if (last.usage) turn.usage = last.usage
                }
                // Per dokumen RPC omp: agent_end dengan isTerminal:false BUKAN akhir giliran. omp akan membangunkan sesi lagi
                // setelah subagent/job latar belakang selesai (agent_start lalu agent_end berikutnya). Kalau di sini kita
                // berhenti, hasil subagent tidak pernah terbaca dan jawaban akhir hilang. Teks sementara ("tunggu ya") ditimpa
                // oleh jawaban akhir; batas waktu & stall tetap berlaku sebagai pengaman.
                if (norm.isTerminal === false) {
                    turn.deferredEnds = (turn.deferredEnds || 0) + 1
                    turn.interimText = turn.lastMessageText || turn.deltaText || turn.interimText || ''
                    turn.lastMessageText = ''
                    turn.deltaText = ''
                    break
                }
                this.#finishTurn(turn)
                return
            }
            case 'prompt_result':
                if (norm.id == null || String(norm.id) === turn.promptId) {
                    if (norm.stopReason) turn.stopReason = norm.stopReason
                    if (norm.usage) turn.usage = norm.usage
                    if (norm.error) turn.lastError = String(norm.error)
                    this.#finishTurn(turn)
                    return
                }
                break
            default:
                break
        }
        try { turn.onEvent?.(norm) } catch {}
    }

    async #runTurn(message, { onEvent, timeoutMs, stallMs, images }) {
        await this.start()
        const promptId = `p${this.#nextId++}`
        const turn = {
            promptId, onEvent, deltaText: '', lastMessageText: '', tools: [], activeTools: new Set(),
            lastError: '', stopReason: undefined, usage: undefined, aborted: false, abortReason: '', ending: false,
            lastFrameAt: Date.now(), timers: [], graceTimer: null, resolve: null, reject: null,
        }
        this.#turn = turn

        const done = new Promise((resolve, reject) => { turn.resolve = resolve; turn.reject = reject })

        turn.totalTimer = setTimeout(() => {
            turn.timedOut = 'timeout'
            this.abort('timeout')
        }, timeoutMs)
        turn.stallTimer = setInterval(() => {
            // Selama ada tool jalan (mis. bash lama), omp memang bisa diam: hanya batas total yang berlaku.
            if (turn.activeTools.size === 0 && Date.now() - turn.lastFrameAt > stallMs) {
                turn.timedOut = 'stall'
                this.abort('stall')
            }
        }, this.#opts.stallCheckMs)
        turn.stallTimer.unref?.()

        // Gambar dikirim native lewat `images` (ImageContent: {type:'image', data:<base64>, mimeType}).
        const imageList = normalizeImages(images)
        const frame = { id: promptId, type: 'prompt', message, ...(imageList.length ? { images: imageList } : {}) }
        if (Buffer.byteLength(JSON.stringify(frame), 'utf8') > MAX_INBOUND_FRAME_BYTES) {
            this.#finishTurn(turn, new OmpRpcError('Lampiran gambar terlalu besar untuk dikirim ke omp (batas 1 MiB per perintah). Perkecil gambarnya.', { code: 'frame_too_large' }))
            return done
        }
        if (!this.#write(frame)) {
            this.#finishTurn(turn, new OmpRpcError('Proses omp tidak aktif.', { code: 'not_running' }))
        }
        return done
    }

    #cleanTurn(turn) {
        clearTimeout(turn.totalTimer)
        clearInterval(turn.stallTimer)
        clearTimeout(turn.graceTimer)
        if (this.#turn === turn) this.#turn = null
    }

    async #finishTurn(turn, error) {
        if (turn.ending) return
        turn.ending = true
        this.#cleanTurn(turn)

        let text = turn.lastMessageText || turn.deltaText
        if (!error && !text && !turn.aborted) {
            // frame akhir tidak membawa teks → tanya langsung ke omp
            try {
                const data = await this.#command('get_last_assistant_text')
                // data bisa string, {text}, {text:null}, atau {}: jangan pernah String(objek) -> "[object Object]"
                const raw = typeof data === 'string' ? data : data?.text
                text = typeof raw === 'string' ? raw
                    : Array.isArray(raw) ? raw.map(b => (typeof b === 'string' ? b : b?.type === 'text' ? b.text : '')).filter(Boolean).join('')
                    : ''
            } catch {}
        }
        text = String(text || '').trim().slice(0, MAX_TEXT_CHARS)

        if (error) {
            error.partialText ||= text || turn.interimText || ''
            error.stderr ||= this.#stderrTail
            error.seenTypes = [...this.#seenTypes]
            return turn.reject(error)
        }
        if (turn.aborted && turn.timedOut) {
            return turn.reject(new OmpRpcError(
                turn.timedOut === 'stall' ? 'omp berhenti merespons, tugas dihentikan.' : 'Tugas melewati batas waktu dan dihentikan.',
                { code: turn.timedOut, partialText: text || turn.interimText || '', stderr: this.#stderrTail, seenTypes: [...this.#seenTypes] }
            ))
        }
        if (!text && turn.lastError && !turn.aborted) {
            return turn.reject(new OmpRpcError(turn.lastError, { code: 'agent_error', stderr: this.#stderrTail, seenTypes: [...this.#seenTypes] }))
        }
        turn.resolve({
            text, stopReason: turn.stopReason, usage: turn.usage, aborted: turn.aborted,
            tools: turn.tools, error: turn.lastError || undefined, deferredEnds: turn.deferredEnds || 0,
        })
    }

    #failTurn(error) {
        const turn = this.#turn
        if (turn) this.#finishTurn(turn, error)
    }

    #onExit(child, code, signal) {
        if (this.#child === child) this.#child = null
        for (const pending of this.#pending.values()) {
            clearTimeout(pending.timer)
            pending.reject(new OmpRpcError('Proses omp berhenti.', { code: 'exited' }))
        }
        this.#pending.clear()
        const turn = this.#turn
        if (turn && !turn.ending) {
            if (turn.aborted && !turn.timedOut) {
                // user minta stop dan proses ikut mati → anggap berhenti normal
                this.#finishTurn(turn)
            } else {
                this.#finishTurn(turn, new OmpRpcError(
                    `Proses omp berhenti tiba-tiba (kode ${code ?? signal}).${this.#stderrTail ? '\n' + this.#stderrTail.trim().slice(-800) : ''}`,
                    { code: 'exited' }
                ))
            }
        }
        this.emit('exit', { code, signal })
    }
}
