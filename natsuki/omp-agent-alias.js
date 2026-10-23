// Jalur Yuki: "yuki <tugas>" diteruskan ke handler .omp dengan viaYuki = true, supaya aturan owner,
// routing fitur bot, dan animasinya sama. Hanya jalur ini yang boleh memakai agent; .omp biasa tidak.
export async function forwardToOmp(m, extra, text) {
    const omp = global.plugins?.['ai/omp.js'] || (await import('../../plugins/ai/omp.js')).default
    if (typeof omp !== 'function') return m.reply('⚠️ Plugin OMP belum termuat.')
    return await omp.call(extra.conn, m, { ...extra, command: 'omp', text, viaYuki: true })
}
