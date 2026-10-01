'use strict';
/**
 * Job manager: every extraction is a "job" with its own input/output folder.
 *   data/jobs/<id>/job.json   metadata
 *   data/jobs/<id>/input/     uploaded bundles
 *   data/jobs/<id>/output/    CLI export target
 *   data/jobs/<id>/log.txt    full console log
 *   data/jobs/<id>/bundle.zip generated on demand
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { config, findCli } = require('./config.js');
const { randomId, extOf } = require('./util.js');
const { buildZip } = require('./zip.js');

const JOBS_DIR = path.join(config.dataDir, 'jobs');
const cache = new Map(); // id -> job
const subscribers = new Map(); // id -> Set<res>
const procs = new Map(); // id -> child process

/* ------------------------------------------------------------------ store */

function jobDir(id) {
  return path.join(JOBS_DIR, id);
}
function jobPaths(id) {
  const dir = jobDir(id);
  return {
    dir,
    meta: path.join(dir, 'job.json'),
    input: path.join(dir, 'input'),
    output: path.join(dir, 'output'),
    log: path.join(dir, 'log.txt'),
    zip: path.join(dir, 'bundle.zip'),
  };
}

async function saveJob(job) {
  const p = jobPaths(job.id);
  job.updatedAt = Date.now();
  await fsp.mkdir(p.dir, { recursive: true });
  await fsp.writeFile(p.meta, JSON.stringify(job, null, 1));
  cache.set(job.id, job);
  return job;
}

function getJob(id) {
  if (cache.has(id)) return cache.get(id);
  try {
    const raw = fs.readFileSync(jobPaths(id).meta, 'utf8');
    const job = JSON.parse(raw);
    cache.set(id, job);
    return job;
  } catch (e) {
    return null;
  }
}

function listJobs() {
  let ids = [];
  try {
    ids = fs.readdirSync(JOBS_DIR).filter((d) => fs.existsSync(jobPaths(d).meta));
  } catch (e) {
    return [];
  }
  const jobs = ids.map(getJob).filter(Boolean);
  jobs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return jobs;
}

function publicJob(job) {
  if (!job) return null;
  const { ...rest } = job;
  rest.hasZip = fs.existsSync(jobPaths(job.id).zip);
  rest.zipSize = rest.hasZip ? fs.statSync(jobPaths(job.id).zip).size : 0;
  return rest;
}

/* ------------------------------------------------------------------ create */

async function createJob(opts = {}) {
  const id = randomId();
  const job = {
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'draft',
    demo: false,
    game: opts.game || 'GI',
    exportType: opts.exportType || 'Convert',
    groupAssets: opts.groupAssets || 'ByType',
    types: Array.isArray(opts.types) ? opts.types : [],
    names: opts.names || [],
    containers: opts.containers || [],
    unityVersion: opts.unityVersion || '',
    mapOp: opts.mapOp || 'None',
    mapType: opts.mapType || 'XML',
    mapName: opts.mapName || 'assets_map',
    key: opts.key || '',
    aiFile: opts.aiFile || '',
    dummyDlls: opts.dummyDlls || '',
    silent: !!opts.silent,
    files: [],
    uploadedBytes: 0,
    exitCode: null,
    startedAt: null,
    endedAt: null,
    progress: null,
    resultCount: 0,
    resultBytes: 0,
    logBytes: 0,
    error: null,
  };
  const p = jobPaths(id);
  await fsp.mkdir(p.input, { recursive: true });
  await fsp.mkdir(p.output, { recursive: true });
  await fsp.writeFile(p.log, '');
  await saveJob(job);
  return job;
}

/* ---------------------------------------------------------------- logging */

function logTargets(id) {
  if (!subscribers.has(id)) subscribers.set(id, new Set());
  return subscribers.get(id);
}

function emit(id, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of logTargets(id)) {
    try {
      res.write(payload);
    } catch (e) {
      logTargets(id).delete(res);
    }
  }
}

function appendLog(id, text) {
  const job = getJob(id);
  if (!job) return;
  const p = jobPaths(id);
  let truncated = false;
  try {
    const st = fs.statSync(p.log);
    if (st.size < config.maxLogBytes) {
      fs.appendFileSync(p.log, text);
    } else {
      truncated = true;
    }
  } catch (e) {
    /* ignore */
  }
  job.logBytes = (job.logBytes || 0) + Buffer.byteLength(text);
  if (truncated && !job.logTruncated) {
    job.logTruncated = true;
    emit(id, 'log', { lines: ['… log terlalu panjang, sisanya tidak disimpan'] });
  }
  emit(id, 'log', { lines: splitLines(text) });
}

function splitLines(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\r/g, ''))
    .filter((l, i, a) => !(l === '' && i === a.length - 1));
}

function readLogTail(id, maxBytes = 300 * 1024) {
  const p = jobPaths(id);
  try {
    const st = fs.statSync(p.log);
    const start = Math.max(0, st.size - maxBytes);
    const fd = fs.openSync(p.log, 'r');
    const len = st.size - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    fs.closeSync(fd);
    return splitLines(buf.toString('utf8'));
  } catch (e) {
    return [];
  }
}

/* ------------------------------------------------------------------ runner */

function resolveCommand(job) {
  const found = findCli();
  if (!found.found) throw new Error('AnimeStudio.CLI tidak ditemukan');
  const override = config.cliOverride.trim();
  if (override) {
    const parts = override.match(/(?:[^\s"]+|"[^"]*")+/g) || [override];
    const cmd = parts[0].replace(/^"|"$/g, '');
    const rest = parts.slice(1).map((s) => s.replace(/^"|"$/g, ''));
    const cwd = fs.existsSync(path.dirname(cmd)) ? path.dirname(cmd) : config.root;
    return { cmd, baseArgs: rest, cwd };
  }
  if (found.path.toLowerCase().endsWith('.dll')) {
    return { cmd: 'dotnet', baseArgs: [found.path], cwd: path.dirname(found.path) };
  }
  return { cmd: found.path, baseArgs: [], cwd: path.dirname(found.path) };
}

function buildArgs(job) {
  const p = jobPaths(job.id);
  const args = [p.input, p.output, '--game', job.game];
  if (job.types && job.types.length) args.push('--types', ...job.types);
  if (job.names && job.names.length) args.push('--names', ...job.names);
  if (job.containers && job.containers.length) args.push('--containers', ...job.containers);
  if (job.exportType) args.push('--export_type', job.exportType);
  if (job.groupAssets) args.push('--group_assets', job.groupAssets);
  if (job.unityVersion) args.push('--unity_version', job.unityVersion);
  if (job.mapOp && job.mapOp !== 'None') {
    args.push('--map_op', job.mapOp);
    if (job.mapOp.includes('CABMap') || job.mapOp.includes('AssetMap') || job.mapOp === 'Both' || job.mapOp === 'All') {
      args.push('--map_name', job.mapName || 'assets_map');
      args.push('--map_type', job.mapType || 'XML');
    }
  }
  if (job.key) args.push('--key', job.key);
  if (job.aiFile) args.push('--ai_file', job.aiFile);
  if (job.dummyDlls) args.push('--dummy_dlls', job.dummyDlls);
  if (job.silent) args.push('--silent');
  return args;
}

function parseProgress(line, job) {
  // "[12/340] Exporting Texture2D: foo"
  const m = line.match(/\[(\d+)\/(\d+)\]/);
  if (m) {
    const done = Number(m[1]);
    const total = Number(m[2]);
    if (total > 0) {
      job.progress = { phase: 'export', done, total, percent: Math.round((done / total) * 100) };
      return true;
    }
  }
  const d = line.match(/Decompressing (.+?) ?\.\.\./);
  if (d) {
    job.progress = { phase: 'decompress', current: d[1], percent: job.progress ? job.progress.percent : 0 };
    return true;
  }
  if (/Scanning for files/.test(line) || /Found \d+ files/.test(line)) {
    job.progress = { phase: 'scan', current: line.trim(), percent: 2 };
    return true;
  }
  if (/AssetMap build successfully|Updated !!/.test(line)) {
    job.progress = { phase: 'map', current: line.trim(), percent: job.progress ? job.progress.percent : 5 };
    return true;
  }
  return false;
}

function runJob(job) {
  const p = jobPaths(job.id);
  const { cmd, baseArgs, cwd } = resolveCommand(job);
  const args = [...baseArgs, ...buildArgs(job)];
  job.status = 'running';
  job.startedAt = Date.now();
  job.endedAt = null;
  job.error = null;
  job.exitCode = null;
  job.progress = { phase: 'start', current: 'menjalankan CLI…', percent: 1 };
  saveJob(job);
  emit(job.id, 'status', publicJob(job));
  appendLog(job.id, `$ ${path.basename(cmd)} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}\n\n`);

  let child;
  try {
    child = spawn(cmd, args, { cwd, windowsHide: true, detached: process.platform !== 'win32' });
  } catch (e) {
    job.status = 'error';
    job.error = String(e.message || e);
    saveJob(job);
    emit(job.id, 'status', publicJob(job));
    return job;
  }
  procs.set(job.id, child);

  const onData = (buf) => {
    const text = buf.toString('utf8');
    appendLog(job.id, text);
    const lines = splitLines(text);
    let changed = false;
    for (const line of lines) if (parseProgress(line, job)) changed = true;
    if (changed) emit(job.id, 'progress', job.progress);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  child.on('error', async (err) => {
    job.status = 'error';
    job.error = err.code === 'ENOENT' ? `Tidak bisa menjalankan "${cmd}" — file tidak ditemukan.` : String(err.message || err);
    job.endedAt = Date.now();
    appendLog(job.id, `\n[error] ${job.error}\n`);
    await saveJob(job);
    procs.delete(job.id);
    emit(job.id, 'status', publicJob(job));
  });

  child.on('close', async (code) => {
    procs.delete(job.id);
    job.exitCode = code;
    job.endedAt = Date.now();
    if (job.status === 'canceled') {
      appendLog(job.id, '\n[dibatalkan]\n');
    } else if (code === 0) {
      job.status = 'done';
      job.progress = { phase: 'done', percent: 100, current: 'selesai' };
      const stats = await scanResults(job.id);
      job.resultCount = stats.count;
      job.resultBytes = stats.totalBytes;
      appendLog(job.id, `\n[selesai] ${stats.count} file (${stats.prettySize}) diekspor ke output\n`);
    } else {
      job.status = 'error';
      job.error = `CLI keluar dengan kode ${code}`;
      appendLog(job.id, `\n[error] ${job.error}\n`);
    }
    await saveJob(job);
    emit(job.id, 'status', publicJob(job));
    emit(job.id, 'progress', job.progress);
  });

  return job;
}

async function cancelJob(job) {
  const child = procs.get(job.id);
  job.status = 'canceled';
  await saveJob(job);
  if (!child) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch (e) {
    try {
      child.kill('SIGKILL');
    } catch (e2) {
      /* ignore */
    }
  }
  procs.delete(job.id);
}

/* ------------------------------------------------------------------ result */

async function walk(dir, base = dir, out = [], limit = 40000) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const ent of entries) {
    if (out.length >= limit) return out;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) await walk(full, base, out, limit);
    else if (ent.isFile()) {
      try {
        const st = await fsp.stat(full);
        out.push({
          rel: path.relative(base, full).split(path.sep).join('/'),
          size: st.size,
          mtime: st.mtimeMs,
          ext: extOf(ent.name),
        });
      } catch (e) {
        /* ignore */
      }
    }
  }
  return out;
}

function prettySize(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

async function scanResults(jobId) {
  const p = jobPaths(jobId);
  const files = await walk(p.output);
  files.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true }));
  const byExt = {};
  let totalBytes = 0;
  for (const f of files) {
    byExt[f.ext || 'lainnya'] = (byExt[f.ext || 'lainnya'] || 0) + 1;
    totalBytes += f.size;
  }
  return { files, count: files.length, totalBytes, prettySize: prettySize(totalBytes), byExt };
}

/* --------------------------------------------------------------------- zip */

async function makeZip(job) {
  if (job.zipStatus === 'running') return job;
  const p = jobPaths(job.id);
  const { files } = await scanResults(job.id);
  if (!files.length) throw new Error('Belum ada file hasil untuk di-zip.');
  job.zipStatus = 'running';
  job.zipProgress = { stage: 'starting', bytes: 0, totalBytes: files.reduce((a, f) => a + f.size, 0), percent: 0 };
  job.zipError = null;
  await saveJob(job);
  emit(job.id, 'zip', job.zipProgress);

  const entries = files.map((f) => ({ src: path.join(p.output, f.rel), name: f.rel, size: f.size }));
  const tmp = p.zip + '.part';

  // fire and forget – the UI polls / listens for events
  buildZip(
    entries,
    tmp,
    (pr) => {
      job.zipProgress = {
        stage: pr.stage,
        index: pr.index,
        total: pr.total,
        current: pr.current,
        bytes: pr.bytes,
        totalBytes: pr.totalBytes,
        percent: pr.totalBytes ? Math.min(99, Math.round((pr.bytes / pr.totalBytes) * 100)) : 0,
      };
      emit(job.id, 'zip', job.zipProgress);
    },
    () => job.zipStatus === 'canceled'
  )
    .then(async (res) => {
      await fsp.rename(tmp, p.zip).catch(async () => {
        await fsp.copyFile(tmp, p.zip);
        await fsp.unlink(tmp).catch(() => {});
      });
      job.zipStatus = 'done';
      job.zipSize = res.size;
      job.zipEntries = res.entries;
      job.zipProgress = { ...job.zipProgress, percent: 100, stage: 'done', bytes: job.zipProgress.totalBytes };
      await saveJob(job);
      emit(job.id, 'zip', job.zipProgress);
      emit(job.id, 'status', publicJob(job));
    })
    .catch(async (err) => {
      await fsp.unlink(tmp).catch(() => {});
      job.zipStatus = 'error';
      job.zipError = String(err.message || err);
      await saveJob(job);
      emit(job.id, 'zip', { stage: 'error', error: job.zipError });
    });
  return job;
}

/* -------------------------------------------------------------------- demo */

/** Build a job whose output is filled with the bundled sample assets. */
async function createDemoJob(sampleDir) {
  const job = await createJob({ game: 'Normal', exportType: 'Convert', demo: true });
  const p = jobPaths(job.id);
  async function copyDir(from, to) {
    await fsp.mkdir(to, { recursive: true });
    for (const ent of await fsp.readdir(from, { withFileTypes: true })) {
      const s = path.join(from, ent.name);
      const d = path.join(to, ent.name);
      if (ent.isDirectory()) await copyDir(s, d);
      else await fsp.copyFile(s, d);
    }
  }
  await copyDir(sampleDir, p.output);
  const stats = await scanResults(job.id);
  job.status = 'done';
  job.progress = { phase: 'done', percent: 100, current: 'contoh' };
  job.resultCount = stats.count;
  job.resultBytes = stats.totalBytes;
  job.startedAt = Date.now() - 1000;
  job.endedAt = Date.now();
  await saveJob(job);
  await fsp.writeFile(
    p.log,
    [
      '$ AnimeStudio.CLI.exe input output --game Normal --types Texture2D,Sprite,TextAsset,AudioClip,Mesh --export_type Convert',
      '',
      'INFO : Scanning for files...',
      'INFO : Found 3 files',
      'INFO : Decompressing sample_bundle_assets.ab ...',
      '[1/6] Exporting Texture2D: Sprite_UI_Icon_Set',
      '[2/6] Exporting Texture2D: Texture2D_Character_Albedo',
      '[3/6] Exporting TextAsset: TextAsset_ItemTable',
      '[4/6] Exporting AudioClip: AudioClip_UI_Click',
      '[5/6] Exporting Mesh: Mesh_Character_Rig',
      '[6/6] Exporting Sprite: Sprite_Skill_Icon',
      '',
      '[selesai] 6 file diekspor ke output',
      '',
      '(Ini contoh hasil — mode demo. Jalankan dengan CLI asli untuk file sungguhan.)',
    ].join('\n')
  );
  emit(job.id, 'status', publicJob(job));
  return job;
}

/* ---------------------------------------------------------------- helpers */

function subscribe(id, res) {
  logTargets(id).add(res);
  return () => logTargets(id).delete(res);
}

async function removeJob(id) {
  const job = getJob(id);
  if (job && procs.has(id)) await cancelJob(job);
  cache.delete(id);
  await fsp.rm(jobDir(id), { recursive: true, force: true });
}

module.exports = {
  createJob,
  createDemoJob,
  getJob,
  listJobs,
  saveJob,
  publicJob,
  runJob,
  cancelJob,
  removeJob,
  scanResults,
  makeZip,
  subscribe,
  emit,
  readLogTail,
  jobPaths,
  buildArgs,
  prettySize,
};
