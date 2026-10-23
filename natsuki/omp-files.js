/**
 * Pembaca berkas untuk OMP: teks/kode biasa + PDF, DOCX, XLSX, PPTX, ODT/ODS/ODP.
 *
 * - Tanpa dependensi baru: ZIP Office dibaca dengan pembaca ZIP mini berbasis node:zlib
 *   (dengan batas ukuran keluaran, jadi aman dari zip-bomb).
 * - PDF memakai `pdftotext` (paket poppler-utils) bila ada; bila tidak ada, mencoba
 *   paket opsional `pdf-parse`. Kalau dua-duanya tidak ada, errornya jelas.
 * - Semua fungsi hanya mengembalikan TEKS. Tidak ada yang dieksekusi.
 */

import { execFile, spawnSync } from 'node:child_process'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

// ───────────────────────── jenis berkas ─────────────────────────

export const TEXT_EXTENSIONS = new Set([
    // web & JS
    '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte', '.html', '.htm', '.css', '.scss', '.sass', '.less', '.ejs',
    // data & konfigurasi
    '.json', '.jsonc', '.json5', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.properties', '.xml', '.csv', '.tsv', '.sql', '.graphql',
    // dokumen teks
    '.md', '.mdx', '.txt', '.log', '.rst', '.srt', '.vtt',
    // bahasa lain
    '.py', '.sh', '.bash', '.php', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.dart', '.lua', '.c', '.h', '.cpp', '.hpp', '.cs', '.gradle',
])
export const DOC_EXTENSIONS = new Set(['.pdf', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp'])

const DOC_MIMES = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
])
const TEXT_MIMES = new Set([
    'application/json', 'application/javascript', 'application/x-javascript', 'application/xml',
    'application/x-sh', 'application/x-yaml', 'application/sql', 'application/x-httpd-php',
])

export const MAX_EXTRACT_CHARS = 600_000
const MAX_XML_BYTES = 24 * 1024 * 1024
const MAX_OFFICE_ENTRIES = 4000
const MAX_SHEET_ROWS = 3000
const PDF_TIMEOUT_MS = 25_000
const PDF_MAX_PAGES = 300

export const READABLE_SUMMARY = 'teks/kode (.txt .md .js .html .json .py .csv .sql dll.), PDF, DOCX, XLSX, PPTX, ODT/ODS/ODP'

export function extOf(name) {
    return path.extname(String(name || '')).toLowerCase()
}
export const isTextName = name => TEXT_EXTENSIONS.has(extOf(name))
export const isDocName = name => DOC_EXTENSIONS.has(extOf(name))
export const isReadableName = name => isTextName(name) || isDocName(name)

/** Cocok untuk lampiran WA yang kadang tidak membawa nama file yang jelas. */
export function isReadableMedia(mime, filename) {
    const m = String(mime || '').toLowerCase().split(';')[0].trim()
    if (isReadableName(filename)) return true
    if (extOf(filename)) return false // punya ekstensi lain (apk, mp4, ...) → bukan untuk dibaca
    return m.startsWith('text/') || TEXT_MIMES.has(m) || DOC_MIMES.has(m)
}

// ───────────────────────── pembaca ZIP mini ─────────────────────────

export function readZip(buffer, { maxEntries = MAX_OFFICE_ENTRIES, maxEntryBytes = MAX_XML_BYTES } = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
        throw new Error('Berkas ini bukan dokumen Office/ZIP yang valid.')
    }
    let eocd = -1
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
    }
    if (eocd < 0) throw new Error('Dokumen rusak (struktur ZIP tidak ditemukan).')
    const total = buffer.readUInt16LE(eocd + 10)
    let offset = buffer.readUInt32LE(eocd + 16)
    if (total === 0xffff || offset === 0xffffffff) throw new Error('Dokumen ZIP64 tidak didukung.')
    if (total > maxEntries) throw new Error('Dokumen berisi terlalu banyak bagian.')

    const entries = new Map()
    for (let n = 0; n < total; n++) {
        if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Dokumen rusak (direktori ZIP).')
        const flags = buffer.readUInt16LE(offset + 8)
        const method = buffer.readUInt16LE(offset + 10)
        const compSize = buffer.readUInt32LE(offset + 20)
        const size = buffer.readUInt32LE(offset + 24)
        const nameLen = buffer.readUInt16LE(offset + 28)
        const extraLen = buffer.readUInt16LE(offset + 30)
        const commentLen = buffer.readUInt16LE(offset + 32)
        const local = buffer.readUInt32LE(offset + 42)
        const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen).replace(/\\/g, '/')
        entries.set(name, { name, flags, method, compSize, size, local })
        offset += 46 + nameLen + extraLen + commentLen
    }

    const read = name => {
        const e = entries.get(name)
        if (!e || name.endsWith('/')) return null
        if (e.flags & 1) throw new Error('Dokumen terenkripsi tidak bisa dibaca.')
        if (e.size > maxEntryBytes) throw new Error(`Bagian dokumen terlalu besar (${name}).`)
        const lo = e.local
        if (lo + 30 > buffer.length || buffer.readUInt32LE(lo) !== 0x04034b50) throw new Error('Dokumen rusak (header lokal).')
        const start = lo + 30 + buffer.readUInt16LE(lo + 26) + buffer.readUInt16LE(lo + 28)
        const raw = buffer.subarray(start, start + e.compSize)
        if (e.method === 0) return Buffer.from(raw)
        if (e.method === 8) {
            try {
                return zlib.inflateRawSync(raw, { maxOutputLength: maxEntryBytes })
            } catch {
                throw new Error(`Bagian dokumen rusak atau terlalu besar (${name}).`)
            }
        }
        throw new Error('Metode kompresi dokumen tidak didukung.')
    }
    return {
        names: [...entries.keys()],
        has: name => entries.has(name),
        text: name => read(name)?.toString('utf8') ?? null,
    }
}

// ───────────────────────── XML → teks ─────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeXml(text) {
    return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
        if (code[0] === '#') {
            const num = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
            try { return String.fromCodePoint(num) } catch { return '' }
        }
        return ENTITIES[code.toLowerCase()] ?? whole
    })
}

const stripTags = xml => decodeXml(String(xml).replace(/<[^>]+>/g, ''))
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? ''
const tidy = text => text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

function docxText(buffer) {
    const zip = readZip(buffer)
    const parts = ['word/document.xml', ...zip.names.filter(n => /^word\/(?:header|footer|footnotes|endnotes)\d*\.xml$/.test(n))]
    const out = []
    for (const part of parts) {
        const xml = zip.text(part)
        if (!xml) continue
        out.push(stripTags(
            xml.replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>(\s*<\/w:tc>)/g, '$1').replace(/<\/w:tc>/g, '\t').replace(/<\/w:tr>/g, '\n').replace(/<\/w:p>/g, '\n')
        ))
    }
    return tidy(out.join('\n\n'))
}

function pptxText(buffer) {
    const zip = readZip(buffer)
    const slides = zip.names
        .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]))
    const out = []
    slides.forEach((name, index) => {
        const xml = zip.text(name) || ''
        out.push(`## Slide ${index + 1}\n${tidy(stripTags(xml.replace(/<\/a:p>/g, '\n')))}`)
        const notes = zip.text(name.replace('slides/slide', 'notesSlides/notesSlide'))
        if (notes) {
            const noteText = tidy(stripTags(notes.replace(/<\/a:p>/g, '\n')))
            if (noteText) out.push(`(catatan pembicara) ${noteText}`)
        }
    })
    return tidy(out.join('\n\n'))
}

function columnIndex(ref) {
    const letters = String(ref).match(/^[A-Z]+/i)?.[0].toUpperCase() || 'A'
    let n = 0
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
    return n - 1
}

function xlsxText(buffer) {
    const zip = readZip(buffer)
    const shared = []
    const sharedXml = zip.text('xl/sharedStrings.xml')
    if (sharedXml) {
        for (const si of sharedXml.match(/<si\b[\s\S]*?<\/si>/g) || []) {
            shared.push(stripTags((si.match(/<t\b[^>]*>[\s\S]*?<\/t>/g) || []).join('')))
        }
    }
    const rels = new Map()
    for (const tag of (zip.text('xl/_rels/workbook.xml.rels') || '').match(/<Relationship\b[^>]*>/g) || []) {
        rels.set(attr(tag, 'Id'), attr(tag, 'Target').replace(/^\/?(?:xl\/)?/, 'xl/'))
    }
    const sheets = []
    for (const tag of (zip.text('xl/workbook.xml') || '').match(/<sheet\b[^>]*>/g) || []) {
        const target = rels.get(attr(tag, 'r:id'))
        if (target) sheets.push({ name: decodeXml(attr(tag, 'name')), target })
    }
    if (!sheets.length) {
        zip.names.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()
            .forEach((target, i) => sheets.push({ name: `Sheet${i + 1}`, target }))
    }

    const out = []
    for (const sheet of sheets) {
        const xml = zip.text(sheet.target)
        if (!xml) continue
        const lines = []
        let rows = 0
        for (const row of xml.match(/<row\b[\s\S]*?<\/row>/g) || []) {
            if (++rows > MAX_SHEET_ROWS) { lines.push(`[... baris lainnya dipotong, batas ${MAX_SHEET_ROWS} baris ...]`); break }
            const cells = []
            for (const cell of row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
                const head = cell.match(/<c\b[^>]*/)[0]
                const type = attr(head, 't')
                const v = cell.match(/<v>([\s\S]*?)<\/v>/)?.[1]
                let value = ''
                if (type === 's') value = shared[Number(v)] ?? ''
                else if (type === 'inlineStr') value = stripTags(cell.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? '')
                else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE'
                else if (v != null) value = decodeXml(v)
                const col = columnIndex(attr(head, 'r'))
                while (cells.length < col) cells.push('')
                cells[col] = String(value).replace(/[\t\r\n]+/g, ' ')
            }
            while (cells.length && cells[cells.length - 1] === '') cells.pop()
            if (cells.length) lines.push(cells.join('\t'))
        }
        out.push(`## Sheet: ${sheet.name}\n${lines.join('\n')}`)
    }
    return tidy(out.join('\n\n'))
}

function odfText(buffer) {
    const xml = readZip(buffer).text('content.xml') || ''
    return tidy(stripTags(
        xml.replace(/<text:tab\/>/g, '\t').replace(/<text:line-break\/>/g, '\n')
            .replace(/<\/text:(?:p|h)>/g, '\n').replace(/<\/table:table-cell>/g, '\t').replace(/<\/table:table-row>/g, '\n')
            .replace(/<\/draw:page>/g, '\n\n')
    ))
}

// ───────────────────────── PDF ─────────────────────────

const PDF_NOT_AVAILABLE = 'PDF tidak bisa dibaca di server ini. Pasang poppler-utils (perintah `pdftotext`, mis. `apt install poppler-utils`) atau jalankan `npm i pdf-parse`.'
const PDF_NO_TEXT = 'PDF ini tidak punya teks yang bisa dibaca (kemungkinan hasil scan atau gambar). Kirim sebagai gambar atau pakai PDF yang teksnya bisa diseleksi.'

function pdfPages(raw) {
    return raw.split('\f').map(page => page.trim()).filter(Boolean).map((page, i) => `[halaman ${i + 1}]\n${page}`).join('\n\n')
}

function finishPdf(text) {
    const out = String(text || '')
    if (out.replace(/\[halaman \d+\]|\s/g, '').length < 20) throw new Error(PDF_NO_TEXT)
    return out
}

function withTempPdf(buffer, fn) {
    const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'omp-pdf-'))
    const file = path.join(dir, 'in.pdf')
    fsSync.writeFileSync(file, buffer)
    const cleanup = () => { try { fsSync.rmSync(dir, { recursive: true, force: true }) } catch {} }
    try {
        const result = fn(file)
        if (result && typeof result.then === 'function') return result.finally(cleanup)
        cleanup()
        return result
    } catch (error) {
        cleanup()
        throw error
    }
}

const PDFTOTEXT_ARGS = file => ['-layout', '-enc', 'UTF-8', '-l', String(PDF_MAX_PAGES), file, '-']

function pdfTextSync(buffer) {
    return withTempPdf(buffer, file => {
        const run = spawnSync('pdftotext', PDFTOTEXT_ARGS(file), { encoding: 'utf8', timeout: PDF_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 })
        if (run.error) throw new Error(PDF_NOT_AVAILABLE)
        if (run.status !== 0) throw new Error('PDF rusak atau terkunci password, jadi tidak bisa dibaca.')
        return finishPdf(pdfPages(run.stdout))
    })
}

async function pdfTextAsync(buffer) {
    try {
        return await withTempPdf(buffer, file => new Promise((resolve, reject) => {
            execFile('pdftotext', PDFTOTEXT_ARGS(file), { encoding: 'utf8', timeout: PDF_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
                if (error) return reject(Object.assign(error, { missing: error.code === 'ENOENT' }))
                resolve(pdfPages(stdout))
            })
        }).then(finishPdf))
    } catch (error) {
        if (!error.missing) {
            if (error.message === PDF_NO_TEXT) throw error
            throw new Error('PDF rusak atau terkunci password, jadi tidak bisa dibaca.')
        }
    }
    // cadangan: pdf-parse (opsional)
    let mod
    try { mod = await import('pdf-parse') } catch { throw new Error(PDF_NOT_AVAILABLE) }
    try {
        if (typeof mod.default === 'function') return finishPdf((await mod.default(buffer)).text)
        if (mod.PDFParse) {
            const parser = new mod.PDFParse({ data: new Uint8Array(buffer) })
            try { return finishPdf((await parser.getText()).text) } finally { await parser.destroy?.() }
        }
    } catch (error) {
        if (error.message === PDF_NO_TEXT) throw error
        throw new Error('PDF rusak atau terkunci password, jadi tidak bisa dibaca.')
    }
    throw new Error(PDF_NOT_AVAILABLE)
}

// ───────────────────────── pintu masuk ─────────────────────────

function decodeText(buffer) {
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString('utf16le', 2)
    let text = buffer.toString('utf8')
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    if (buffer.subarray(0, 8000).includes(0)) throw new Error('Berkas ini berisi data biner, bukan teks.')
    return text
}

function capText(text) {
    if (text.length <= MAX_EXTRACT_CHARS) return { text, truncated: false }
    return { text: `${text.slice(0, MAX_EXTRACT_CHARS)}\n[... dipotong, batas ${MAX_EXTRACT_CHARS} karakter ...]`, truncated: true }
}

function officeText(buffer, ext) {
    if (ext === '.docx') return docxText(buffer)
    if (ext === '.pptx') return pptxText(buffer)
    if (ext === '.xlsx') return xlsxText(buffer)
    return odfText(buffer)
}

/** Versi sinkron (dipakai saat membaca isi ZIP). @returns {{text:string, kind:string, truncated:boolean}} */
export function extractTextSync(buffer, filename) {
    const ext = extOf(filename)
    if (!isReadableName(filename)) throw new Error(`Jenis berkas ${ext || 'ini'} belum didukung. Yang bisa dibaca: ${READABLE_SUMMARY}.`)
    if (ext === '.pdf') return { kind: 'pdf', ...capText(pdfTextSync(buffer)) }
    if (DOC_EXTENSIONS.has(ext)) return { kind: ext.slice(1), ...capText(officeText(buffer, ext)) }
    return { kind: 'text', ...capText(decodeText(buffer)) }
}

/** Versi async (dipakai untuk lampiran tunggal; PDF tidak memblokir bot). */
export async function extractText(buffer, filename) {
    const ext = extOf(filename)
    if (ext === '.pdf') return { kind: 'pdf', ...capText(await pdfTextAsync(buffer)) }
    if (!ext && buffer.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf', ...capText(await pdfTextAsync(buffer)) }
    return extractTextSync(buffer, filename || 'berkas.txt')
}
