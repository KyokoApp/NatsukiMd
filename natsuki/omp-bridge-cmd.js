import crypto from 'node:crypto'
import path from 'node:path'
import { bridgeConfig, bridgeEnabled } from './omp-bot-bridge.js'
import { describeBotCatalog, diagnoseCatalog } from './omp-router.js'
import { addExtraPlugin, listExtraPlugins, removeExtraPlugin } from './omp-allowlist.js'

// Perintah admin bridge, dipanggil dari plugins/ai/agent.js (owner saja):
// .agent bridge        → tampilkan token + isi .env + entri mcp.json untuk dipasang sendiri (chat pribadi)
// .agent bridge status → cek konfigurasi saat ini (token tidak ditampilkan)
// .agent izinkan <folder/nama.js> → izinkan plugin (non-owner) dipakai agent/router; .agent cabut <path>; .agent izin = lihat daftar
// .agent katalog debug → alasan tiap fitur allowlist yang tidak masuk katalog
// .agent katalog → daftar fitur bot persis seperti yang dikirim ke agent
export async function handleBridgeCommand(m, extra, text) {
    const { port, url, token } = bridgeConfig()
    const sub = String(text || '').trim().match(/^(izinkan|cabut|izin)\b\s*(.*)$/i)
    if (sub) {
        const action = sub[1].toLowerCase()
        let rel = sub[2].trim()
        if (action === 'izin') {
            const list = listExtraPlugins()
            return m.reply(list.length
                ? `🔓 *Plugin tambahan yang diizinkan untuk agent/router:*\n${list.map(item => `• ${item}`).join('\n')}\n\nCabut: .agent cabut <path>`
                : 'Belum ada plugin tambahan. Tambah: .agent izinkan <folder/nama.js>')
        }
        if (!rel) return m.reply(`Contoh: .agent ${action} downloader/tiktok2.js`)
        // Boleh tulis nama file saja (tiktok2.js) kalau cuma ada satu plugin dengan nama itu.
        if (!rel.includes('/')) {
            const hits = Object.keys(global.plugins || {}).filter(key => key.endsWith(`/${rel}`))
            if (hits.length === 1) rel = hits[0]
            else if (hits.length > 1) return m.reply(`Nama "${rel}" ada di beberapa folder:\n${hits.map(item => `• ${item}`).join('\n')}\nTulis path lengkapnya.`)
        }
        if (action === 'cabut') {
            return m.reply((await removeExtraPlugin(rel))
                ? `🔒 ${rel} dicabut dari izin tambahan. Fitur bawaan allowlist tidak bisa dicabut dari sini.`
                : `${rel} tidak ada di daftar izin tambahan.`)
        }
        try {
            const { plugin, help } = await addExtraPlugin(rel, global.plugins)
            const flags = ['premium', 'admin', 'botAdmin', 'group', 'private', 'nsfw', 'register', 'limit'].filter(flag => plugin[flag]).join(', ')
            return m.reply([
                `✅ *${rel}* diizinkan. Langsung masuk katalog agent tanpa restart.`,
                `Perintah: ${help.map(item => `.${item}`.slice(0, 60)).join(' | ')}`,
                flags ? `Aturan akses plugin tetap berlaku: ${flags}.` : 'Plugin ini tidak punya aturan akses khusus, siapa pun yang memakai agent bisa memicunya.',
                'Cek: .agent katalog',
            ].filter(Boolean).join('\n'))
        } catch (error) {
            return m.reply(`❌ ${error.message}`)
        }
    }
    if (/^(?:katalog|catalog)\s+debug$/i.test(String(text || '').trim())) {
        const { total, sampleKeys, rows } = diagnoseCatalog(extra)
        const out = rows.filter(row => row.reason)
        const body = out.map(row => `• ${row.rel} → ${row.reason}`).join('\n')
        return m.reply([
            `🔎 *Diagnosis katalog*`,
            `global.plugins: ${total} plugin. Contoh key: ${sampleKeys.join(', ') || '-'}`,
            `Allowlist: ${rows.length}, masuk katalog: ${rows.length - out.length}, tersaring: ${out.length}`,
            '',
            body.length > 3300 ? `${body.slice(0, 3300)}\n…(dipotong)` : body || '(tidak ada yang tersaring)',
        ].join('\n'))
    }
    if (/^(?:katalog|catalog)$/i.test(String(text || '').trim())) {
        const catalog = describeBotCatalog(extra)
        const lines = catalog ? catalog.split('\n').length : 0
        const body = catalog.length > 3300 ? `${catalog.slice(0, 3300)}\n…(dipotong untuk tampilan)` : catalog
        return m.reply(`📚 *Katalog yang dilihat agent:* ${lines} fitur, ${catalog.length} karakter\n\n${body || '(kosong)'}`)
    }
    const configured = token.length >= 16

    if (/^status$/i.test(String(text || '').trim())) {
        return m.reply([
            '🌉 *Status jembatan OMP*',
            `• OMP_BOT_BRIDGE: ${bridgeEnabled() ? 'ON' : 'OFF'}`,
            `• OMP_BRIDGE_TOKEN: ${configured ? 'sudah diisi' : 'BELUM diisi (min. 16 karakter)'}`,
            `• OMP_BOT_BRIDGE_TOOLS: ${String(process.env.OMP_BOT_BRIDGE_TOOLS || '').trim() || 'BELUM diisi'}`,
            `• Alamat: ${url}`,
        ].join('\n'))
    }

    const inGroup = m.isGroup ?? String(m.chat || '').endsWith('@g.us')
    if (inGroup) return m.reply('⚠️ Perintah ini menampilkan token rahasia. Jalankan `.agent bridge` di chat pribadi dengan bot.')
    const useToken = configured ? token : crypto.randomBytes(24).toString('hex')
    const script = path.resolve(process.cwd(), 'lib', 'omp-bot-mcp.mjs')
    const entry = {
        mcpServers: {
            'hoshino-bot': {
                command: process.execPath,
                args: [script],
                env: { OMP_BRIDGE_URL: url, OMP_BRIDGE_TOKEN: useToken },
            },
        },
    }

    await m.reply([
        '🌉 *Pasang jembatan OMP*',
        configured ? 'Token di .env-mu sudah ada, dipakai ulang di bawah.' : 'Token baru dibuat (belum tersimpan di mana pun, pasang sendiri).',
        '',
        '*1) Tambahkan ke .env lalu restart bot:*',
        '```',
        'OMP_BOT_BRIDGE=1',
        `OMP_BRIDGE_TOKEN=${useToken}`,
        port !== 39517 ? `OMP_BRIDGE_PORT=${port}` : '',
        'OMP_BOT_BRIDGE_TOOLS=<isi nama tool, lihat poin 3>',
        '```',
    ].filter(line => line !== '').join('\n'))

    await m.reply([
        '*2) Tanpa bwrap:* tambahkan ke ~/.omp/agent/mcp.json (gabungkan ke "mcpServers" yang sudah ada). Dengan bwrap, file ini dibuat otomatis, lewati.',
        '```',
        JSON.stringify(entry, null, 2),
        '```',
        '',
        '*3) Nama tool:* server ini punya 3 tool: `bot_commands`, `run_bot_command`, `agent_notes`. Awalan namanya ditentukan omp, jadi isi `OMP_BOT_BRIDGE_TOOLS` dengan nama persis yang tampil di omp (pisahkan koma).',
        '',
        '⚠️ Token ini rahasia. Hapus pesan ini setelah disalin. Cek hasilnya dengan `.agent bridge status`.',
    ].join('\n'))
}
