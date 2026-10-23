// Pengaturan kecil OMP per pengirim (disimpan di data/omp-settings.json). Default: animasi NYALA.
import fs from 'fs/promises'
import path from 'path'

const FILE = path.resolve(process.env.OMP_SETTINGS_FILE || path.join(process.cwd(), 'data', 'omp-settings.json'))
let cache = null

async function load() {
    if (cache) return cache
    try { cache = JSON.parse(await fs.readFile(FILE, 'utf8')) } catch { cache = {} }
    if (!cache || typeof cache !== 'object') cache = {}
    return cache
}

const keyOf = sender => String(sender || '').split('@')[0].split(':')[0]

/** true = animasi tampil (default); false = hanya teks. */
export async function isAnimOn(sender) {
    const data = await load()
    return data.animOff?.[keyOf(sender)] !== true
}

export async function setAnim(sender, on) {
    const data = await load()
    data.animOff = data.animOff || {}
    if (on) delete data.animOff[keyOf(sender)]
    else data.animOff[keyOf(sender)] = true
    await fs.mkdir(path.dirname(FILE), { recursive: true })
    await fs.writeFile(FILE, JSON.stringify(data), 'utf8')
}
