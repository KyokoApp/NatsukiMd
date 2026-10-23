// ==========================================================================
//  lib/a2ui.js — Builder + sender widget A2UI (MERGED + IMAGE HEADER)
//  - Surface components (gaya ping/bank)      -> jalur lama, TIDAK BERUBAH
//  - listCard (katalog, API FgsiDev)          -> jalur baru, port 1:1
//  - listCard support `image` (header, upload ke WA server)
//  - Tanpa buttons  -> amplop "ping" (FULL WIDTH)
//  - Dengan buttons -> amplop native_flow
// ==========================================================================

import crypto from 'crypto'
import {
    generateWAMessageFromContent,
    generateWAMessageContent
} from 'baileys'

const CATALOG = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'

export class A2UI {
    constructor({ version = 'v0.9' } = {}) {
        this.version = version
        this.comps = []
        this._n = 0
        this._root = null
        this._listCardPayload = null
    }

    _add(comp) {
        if (!comp.id) comp.id = `c${++this._n}`
        this.comps.push(comp)
        return comp
    }

    text(text, { variant = 'body' } = {}) {
        return this._add({ component: 'Text', text: String(text), variant })
    }

    image(url, { variant = 'header', fit = 'cover' } = {}) {
        return this._add({ component: 'Image', url, variant, fit })
    }

    divider() {
        return this._add({ component: 'Divider' })
    }

    slider(label, value, { min = 0, max = 100 } = {}) {
        return this._add({ component: 'Slider', label, min, max, value })
    }

    checkbox(label, value = false) {
        return this._add({ component: 'CheckBox', label, value })
    }

    textField(label, { variant = 'shortText', value = '' } = {}) {
        return this._add({ component: 'TextField', label, value, variant })
    }

    column(children) {
        return this._add({
            component: 'Column',
            children: children.map(c => c.id),
        })
    }

    row(children, { justify } = {}) {
        const r = { component: 'Row', children: children.map(c => c.id) }
        if (justify) r.justify = justify
        return this._add(r)
    }

    card(child) {
        return this._add({ component: 'Card', child: child.id })
    }

    button(labelText, { action } = {}) {
        return this._add({
            component: 'Button',
            child: this.text(labelText, { variant: 'caption' }).id,
            variant: 'borderless',
            ...(action ? { action } : {}),
        })
    }

    section(title, items) {
        const titleComp = this.text(title, { variant: 'h2' })
        const divComp = this.divider()
        const content = []
        for (const it of items) {
            if (typeof it === 'string') content.push(this.text(it))
            else if (it.slider) content.push(this.slider(it.label, it.value, { min: it.min, max: it.max }))
            else content.push(this.text(it.text, { variant: it.variant || 'body' }))
        }
        const col = this.column([titleComp, divComp, ...content])
        return this.card(col)
    }

    root(children) {
        this._root = {
            component: 'Column',
            id: 'root',
            children: children.map(c => c.id),
        }
        return this._root
    }

    // ===== listCard — port 1:1 dari lib FgsiDev =====
    // API: ui.listCard({ title, items: [{ assetId?, title, price?, assetType?, emphasis? }], fallbackText })
    // assetId GAK perlu upload — kalau kosong otomatis random ID (persis lib aslinya)
    listCard({ title, items, fallbackText, uuid = crypto.randomUUID() } = {}) {
        if (!title) throw new TypeError('listCard requires a title')
        if (!Array.isArray(items) || !items.length) {
            throw new TypeError('listCard requires a non-empty items array')
        }
        this._listCardPayload = {
            uuid,
            data: JSON.stringify({
                type: 'list_card',
                title,
                fallback_text: fallbackText ?? '',
                items: items.map((it) => ({
                    asset_id: it.assetId ?? crypto.randomUUID().replace(/-/g, '').slice(0, 17),
                    asset_type: it.assetType ?? 'PRODUCT_ITEM',
                    title: it.title,
                    trailing_label: it.price ?? it.trailingLabel ?? '',
                    trailing_emphasis: it.emphasis ?? 'strong',
                })),
            }),
            type: 'im_a2ui',
            fallback: fallbackText ?? '',
        }
        return this
    }

    build(surfaceId) {
        // listCard payload diprioritaskan (port dari lib asli)
        if (this._listCardPayload) return this._listCardPayload
        if (this._root) this.comps.unshift(this._root)
        return {
            version: this.version,
            createSurface: {
                surfaceId: surfaceId || `widget=${Date.now()}`,
                catalogId: CATALOG,
                components: this.comps,
            },
        }
    }
}

// ===== KIRIM WIDGET ========================================================
export async function sendA2UIWidget(conn, chat, opts = {}) {
    const { a2ui, surface, footer, buttons, contextInfo, fullWidth, singleScreen, image, bodyText, quoted } = opts
    const built = surface || (a2ui ? a2ui.build() : null)
    if (!built) throw new Error('a2ui instance atau surface wajib diisi')

    // listCard payload  : { uuid, data: string(sudah), type }
    // surface biasa     : { version, createSurface: {...} }
    const isListCard = !!built.uuid && typeof built.data === 'string'

    // ---- JALUR LISTCARD: amplop persis lib FgsiDev + support header gambar ----
    if (isListCard) {
        // upload gambar header ke server WA kalau ada (pola plugin sewa)
        let imageHeader = null
        if (image) {
            const { imageMessage } = await generateWAMessageContent({
                image: { url: image }
            }, {
                upload: conn.waUploadToServer
            })
            imageHeader = { hasMediaAttachment: true, imageMessage }
        }

        const nativeFlowMessage = buttons && buttons.length
            ? {
                  buttons: buttons.map((b) => ({
                      name: b.name ?? 'cta_url',
                      buttonParamsJson: typeof b.params === 'string' ? b.params : JSON.stringify(b.params ?? {}),
                  })),
                  messageParamsJson: '{}',
                  messageVersion: 1,
              }
            : { messageParamsJson: '' }

        const interactiveMessage = (singleScreen && !imageHeader)
            ? {
                  nativeFlowMessage,
                  bloksWidget: { uuid: built.uuid, data: built.data, type: built.type || 'im_a2ui' },
                  ...(Object.keys(contextInfo || {}).length ? { contextInfo } : {}),
              }
            : {
                  header: imageHeader || { hasMediaAttachment: false },
                  body: { text: bodyText || '' },
                  ...(footer !== undefined ? { footer: { text: footer } } : {}),
                  nativeFlowMessage,
                  bloksWidget: { uuid: built.uuid, data: built.data, type: built.type || 'im_a2ui' },
                  ...(Object.keys(contextInfo || {}).length ? { contextInfo } : {}),
              }

        const msg = generateWAMessageFromContent(chat, {
            messageContextInfo: { messageSecret: crypto.randomBytes(32) },
            interactiveMessage,
        }, { quoted })

        await conn.relayMessage(msg.key.remoteJid, msg.message, {
            messageId: msg.key.id,
            additionalNodes: [{
                tag: 'biz',
                attrs: { actual_actors: '2', host_storage: '2', privacy_mode_ts: String(Math.floor(Date.now() / 1e3)) },
                content: [
                    { tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] },
                    { tag: 'quality_control', attrs: { decision_id: crypto.randomUUID().replace(/-/g, ''), source_type: 'third_party' }, content: [{ tag: 'decision_source', attrs: { value: 'df' } }] },
                ],
            }],
        })
        return msg
    }

    // ---- JALUR SURFACE LAMA: TIDAK BERUBAH (ping/bank/profile/ww2) ----
    const uuid = crypto.randomUUID()
    const hasButtons = Array.isArray(buttons) && buttons.length > 0

    if (!hasButtons || fullWidth) {
        await conn.relayMessage(chat, {
            messageContextInfo: {
                threadId: [],
                messageSecret: new Uint8Array(crypto.randomBytes(32)),
            },
            interactiveMessage: {
                body: { text: '' },
                bloksWidget: {
                    uuid,
                    data: JSON.stringify(built),
                    type: 'im_a2ui',
                },
                contextInfo: contextInfo || {},
                nativeFlowMessage: {
                    buttons: [{ name: '' }],
                    messageParamsJson: '{}',
                },
            },
        }, {
            additionalNodes: [{ tag: 'biz', attrs: {} }],
        })
        return
    }

    await conn.relayMessage(chat, {
        messageContextInfo: {
            messageSecret: crypto.randomBytes(32).toString('base64'),
        },
        interactiveMessage: {
            header: { hasMediaAttachment: false },
            body: { text: '' },
            ...(footer ? { footer: { text: footer } } : {}),
            nativeFlowMessage: {
                buttons: [
                    {},
                    ...buttons.map(b => ({
                        name: b.name,
                        buttonParamsJson: JSON.stringify(b.params),
                    })),
                ],
                messageParamsJson: '{}',
                messageVersion: 1,
            },
            bloksWidget: {
                uuid,
                data: JSON.stringify(built),
                type: 'im_a2ui',
            },
            contextInfo: contextInfo || { expiration: 7776000 },
        },
    }, {
        additionalNodes: [{
            tag: 'biz',
            attrs: {},
            content: [{
                tag: 'interactive',
                attrs: { type: 'native_flow', v: '1' },
                content: [{
                    tag: 'native_flow',
                    attrs: { v: '9', name: 'mixed' },
                }],
            }],
        }],
    })
}