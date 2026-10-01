#!/usr/bin/env node
'use strict';
/**
 * mock-cli.js — tiruan AnimeStudio.CLI untuk nguji AnimeStudio Web tanpa PC Windows.
 *
 * Cara pakai (di Linux/macOS/Android-Termux atau buat testing):
 *   AS_CLI="node tools/mock-cli.js" node server.js
 *
 * Dia menerima argumen yang sama (<input> <output> --game … --types …) lalu:
 *  - menulis log mirip CLI asli (termasuk baris progress "[n/m] Exporting …")
 *  - menyalin isi folder demo/ sebagai "hasil" ke folder output
 * Jadi seluruh alur web (upload → proses → hasil → zip) bisa diuji end-to-end.
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const positional = [];
const flags = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    const list = [];
    while (args[i + 1] && !args[i + 1].startsWith('--')) list.push(args[++i]);
    flags[a.slice(2)] = list.length ? list : [true];
  } else positional.push(a);
}

const [inputPath, outputPath] = positional;
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'demo');

const log = (s) => { process.stdout.write(s + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPE_DIR = {
  Texture2D: 'Texture2D', Sprite: 'Sprite', TextAsset: 'TextAsset',
  AudioClip: 'AudioClip', Mesh: 'Mesh', AnimationClip: 'AnimationClip',
};

async function main() {
  log(`INFO : Game selected : ${(flags.game || ['Normal'])[0]}`);
  log('INFO : Scanning for files...');
  let files = [];
  try {
    files = fs.statSync(inputPath).isDirectory()
      ? fs.readdirSync(inputPath).map((f) => path.join(inputPath, f)).filter((f) => fs.statSync(f).isFile())
      : [inputPath];
  } catch (e) {
    log(`ERROR: input "${inputPath}" tidak ditemukan`);
    process.exit(2);
  }
  log(`INFO : Found ${files.length} files`);
  for (const f of files) {
    log(`INFO : Decompressing ${path.basename(f)} ...`);
    await sleep(150);
  }
  if (!outputPath) { log('ERROR: output path kosong'); process.exit(2); }
  fs.mkdirSync(outputPath, { recursive: true });

  const wanted = flags.types && flags.types[0] !== true
    ? flags.types.flatMap((t) => String(t).split(',')).map((t) => t.split(':')[0])
    : null;

  const items = [];
  for (const type of Object.values(TYPE_DIR)) {
    const dir = path.join(SRC, TYPE_DIR[type]);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) items.push({ type, file: f, src: path.join(dir, f) });
  }
  const chosen = wanted ? items.filter((i) => wanted.includes(i.type)) : items;
  if (!chosen.length) {
    log('WARN : tidak ada asset yang cocok dengan filter --types');
  }

  let i = 0;
  for (const it of chosen) {
    i++;
    log(`[${i}/${chosen.length}] Exporting ${it.type}: ${path.parse(it.file).name}`);
    const group = (flags.group_assets || ['ByType'])[0];
    let dir = path.join(outputPath, group === 'None' ? '' : it.type);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(it.src, path.join(dir, it.file));
    await sleep(120);
  }

  // satu file besar buatan supaya progress zip terlihat
  const big = path.join(outputPath, 'TextAsset', 'mock_dump_besar.txt');
  fs.mkdirSync(path.dirname(big), { recursive: true });
  const chunk = 'Mock AnimeStudio output line — data dummy untuk uji zip.\n'.repeat(2000);
  const ws = fs.createWriteStream(big);
  for (let k = 0; k < 24; k++) ws.write(chunk);
  ws.end();
  await new Promise((r) => ws.on('finish', r));

  log('');
  log(`INFO : Selesai — ${chosen.length + 1} asset diekspor ke ${outputPath}`);
  log('(mock-cli: ini bukan AnimeStudio asli, hanya untuk uji alur web)');
}

main().catch((e) => { console.error(e); process.exit(1); });
