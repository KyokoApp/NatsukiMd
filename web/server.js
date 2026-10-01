#!/usr/bin/env node
'use strict';
/**
 * AnimeStudio Web — a small local web front-end for AnimeStudio.CLI
 * (asset extractor for Unity games by Escartem, MIT licensed).
 *
 * Zero npm dependencies: only Node's standard library is used.
 *   node server.js            → http://localhost:8787
 *   PORT=9000 node server.js
 *   AS_CLI="C:\\tools\\AnimeStudio.CLI.exe" node server.js
 */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { config, findCli, ensureDirs } = require('./src/config.js');
const jobs = require('./src/jobs.js');
const { readJson, sendJson, safeJoin, mimeFor, extOf, MEDIA_EXT, TEXT_EXT } = require('./src/util.js');

const PUBLIC_DIR = path.join(config.root, 'public');
const DEMO_DIR = path.join(config.root, 'demo');
const games = require('./src/data/games.json');
const classids = require('./src/data/classids.json');

ensureDirs();

/* ------------------------------------------------------------------ helpers */

function localIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

function cliState() {
  const found = findCli();
  return {
    found: found.found,
    path: found.path,
    source: found.source,
    kind: found.kind,
    custom: !!config.cliOverride,
    // AS_CLI pointing at tools/mock-cli.js means the server is in "uji alur" mode
    mock: !!found.path && /mock-cli/i.test(found.path),
  };
}

/** Sanitise a client supplied relative path (Windows-safe, no traversal). */
function sanitizeRelPath(rel) {
  const parts = String(rel || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.' && p !== '..')
    .map((p) => p.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[ .]+$/, ''));
  return parts.join('/');
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = safeJoin(PUBLIC_DIR, rel);
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 — tidak ditemukan');
    return;
  }
  const st = fs.statSync(file);
  res.writeHead(200, {
    'Content-Type': mimeFor(file),
    'Content-Length': st.size,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

/** Serve a file with byte-range support (media scrubbing) and inline/download modes. */
function serveFile(req, res, file, { download = false } = {}) {
  let st;
  try {
    st = fs.statSync(file);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  const type = mimeFor(file);
  const isText = TEXT_EXT.has(extOf(file));
  const range = req.headers.range;
  const baseHeaders = {
    'Content-Type': isText ? 'text/plain; charset=utf-8' : type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(path.basename(file))}"`,
  };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      if (start >= st.size || end < start) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Content-Length': end - start + 1,
      });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
  }
  res.writeHead(200, { ...baseHeaders, 'Content-Length': st.size });
  fs.createReadStream(file).pipe(res);
}

/* -------------------------------------------------------------------- routes */

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  // ---- state -------------------------------------------------------------
  if (p === '/api/state' && method === 'GET') {
    return sendJson(res, 200, {
      version: config.version,
      cli: cliState(),
      demoAvailable: fs.existsSync(DEMO_DIR),
      dataDir: config.dataDir,
      jobs: jobs.listJobs().slice(0, 50).map(jobs.publicJob),
      platform: `${process.platform} ${process.arch}`,
      node: process.version,
      lanAddress: `http://${localIp()}:${config.port}`,
    });
  }

  if (p === '/api/catalog' && method === 'GET') {
    return sendJson(res, 200, { games, classids });
  }

  // ---- demo --------------------------------------------------------------
  if (p === '/api/demo' && method === 'POST') {
    const job = await jobs.createDemoJob(DEMO_DIR);
    return sendJson(res, 200, { job: jobs.publicJob(job) });
  }

  // ---- jobs --------------------------------------------------------------
  const jobMatch = /^\/api\/jobs\/([\w-]+)(\/.*)?$/.exec(p);
  if (p === '/api/jobs' && method === 'POST') {
    const body = await readJson(req);
    const job = await jobs.createJob(body);
    return sendJson(res, 200, { job: jobs.publicJob(job) });
  }
  if (p === '/api/jobs' && method === 'GET') {
    return sendJson(res, 200, { jobs: jobs.listJobs().map(jobs.publicJob) });
  }

  if (jobMatch) {
    const id = jobMatch[1];
    const sub = jobMatch[2] || '';
    const job = jobs.getJob(id);
    if (!job) return sendJson(res, 404, { error: 'Job tidak ditemukan' });

    if (sub === '' && method === 'GET') return sendJson(res, 200, { job: jobs.publicJob(job) });

    if (sub === '' && method === 'DELETE') {
      await jobs.removeJob(id);
      return sendJson(res, 200, { ok: true });
    }

    // upload one file (raw body) -------------------------------------------
    if (sub === '/file' && method === 'PUT') {
      const rel = sanitizeRelPath(url.searchParams.get('path') || '');
      if (!rel) return sendJson(res, 400, { error: 'path kosong' });
      const dest = safeJoin(jobs.jobPaths(id).input, rel);
      if (!dest) return sendJson(res, 400, { error: 'path tidak valid' });
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      const size = await new Promise((resolve, reject) => {
        let bytes = 0;
        const ws = fs.createWriteStream(dest);
        req.on('data', (c) => {
          bytes += c.length;
        });
        req.pipe(ws);
        ws.on('finish', () => resolve(bytes));
        ws.on('error', reject);
        req.on('error', reject);
      });
      const known = job.files.find((f) => f.name === rel);
      if (known) known.size = size;
      else job.files.push({ name: rel, size });
      job.uploadedBytes = job.files.reduce((a, f) => a + f.size, 0);
      await jobs.saveJob(job);
      return sendJson(res, 200, { ok: true, name: rel, size, uploadedBytes: job.uploadedBytes });
    }

    // run / cancel ----------------------------------------------------------
    if (sub === '/run' && method === 'POST') {
      if (!job.files.length) return sendJson(res, 400, { error: 'Belum ada file yang di-upload.' });
      const cli = cliState();
      if (!cli.found) {
        return sendJson(res, 400, {
          error: 'AnimeStudio.CLI belum terpasang',
          hint: 'Taruh AnimeStudio.CLI.exe (atau folder hasil unzip) di folder bin/AnimeStudio/ lalu muat ulang halaman. Atau pakai Mode Demo untuk mencoba UI-nya.',
          demoAvailable: fs.existsSync(DEMO_DIR),
        });
      }
      if (job.status === 'running') return sendJson(res, 409, { error: 'Job ini sedang berjalan.' });
      await jobs.runJob(job);
      return sendJson(res, 200, { job: jobs.publicJob(job) });
    }

    if (sub === '/cancel' && method === 'POST') {
      await jobs.cancelJob(job);
      return sendJson(res, 200, { job: jobs.publicJob(job) });
    }

    // live events -----------------------------------------------------------
    if (sub === '/events' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ job: jobs.publicJob(job) })}\n\n`);
      const tail = jobs.readLogTail(id);
      if (tail.length) res.write(`event: log\ndata: ${JSON.stringify({ lines: tail })}\n\n`);
      const unsub = jobs.subscribe(id, res);
      const ping = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch (e) {
          /* ignore */
        }
      }, 15000);
      req.on('close', () => {
        clearInterval(ping);
        unsub();
      });
      return;
    }

    if (sub === '/log' && method === 'GET') {
      return sendJson(res, 200, { lines: jobs.readLogTail(id, 1024 * 1024), status: job.status });
    }

    // results ---------------------------------------------------------------
    if (sub === '/results' && method === 'GET') {
      const stats = await jobs.scanResults(id);
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const ext = (url.searchParams.get('ext') || '').toLowerCase();
      let files = stats.files;
      if (q) files = files.filter((f) => f.rel.toLowerCase().includes(q));
      if (ext) files = files.filter((f) => f.ext === ext);
      const limit = Math.min(Number(url.searchParams.get('limit') || 5000), 40000);
      return sendJson(res, 200, {
        count: stats.count,
        totalBytes: stats.totalBytes,
        prettySize: stats.prettySize,
        byExt: stats.byExt,
        shown: Math.min(files.length, limit),
        filtered: files.length,
        files: files.slice(0, limit),
        hasZip: fs.existsSync(jobs.jobPaths(id).zip),
        zipSize: fs.existsSync(jobs.jobPaths(id).zip) ? fs.statSync(jobs.jobPaths(id).zip).size : 0,
      });
    }

    // one result file --------------------------------------------------------
    if (sub === '/file' && method === 'GET') {
      const rel = sanitizeRelPath(url.searchParams.get('path') || '');
      const file = rel ? safeJoin(jobs.jobPaths(id).output, rel) : null;
      if (!file) return sendJson(res, 400, { error: 'path tidak valid' });
      return serveFile(req, res, file, { download: url.searchParams.get('download') === '1' });
    }

    // zip -------------------------------------------------------------------
    if (sub === '/zip' && method === 'POST') {
      const stats = await jobs.scanResults(id);
      if (!stats.count) return sendJson(res, 400, { error: 'Belum ada hasil untuk di-zip.' });
      jobs.makeZip(job);
      return sendJson(res, 200, { ok: true, started: true });
    }
    if (sub === '/zip' && method === 'GET') {
      const zip = jobs.jobPaths(id).zip;
      if (!fs.existsSync(zip)) return sendJson(res, 404, { error: 'Zip belum dibuat.' });
      return serveFile(req, res, zip, { download: true });
    }
    if (sub === '/zip' && method === 'DELETE') {
      const zip = jobs.jobPaths(id).zip;
      await fsp.unlink(zip).catch(() => {});
      job.zipStatus = null;
      job.zipSize = 0;
      await jobs.saveJob(job);
      return sendJson(res, 200, { ok: true });
    }
  }

  return sendJson(res, 404, { error: 'Endpoint tidak dikenal' });
}

/* ------------------------------------------------------------------- server */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err) => {
      console.error('[api]', err);
      if (!res.headersSent) sendJson(res, 500, { error: String(err.message || err) });
      else res.end();
    });
    return;
  }
  serveStatic(req, res);
});

server.listen(config.port, config.host, () => {
  const cli = cliState();
  const line = '─'.repeat(58);
  console.log(line);
  console.log('  AnimeStudio Web  ·  asset extractor Unity lewat browser');
  console.log(line);
  console.log(`  Lokal     : http://localhost:${config.port}`);
  console.log(`  Jaringan  : http://${localIp()}:${config.port}   (buka dari HP di wifi yang sama)`);
  console.log(`  Data      : ${config.dataDir}`);
  console.log(
    `  CLI       : ${cli.found ? cli.path + (cli.custom ? '  (dari AS_CLI)' : '') : '❌ belum terpasang → cek bin/AnimeStudio/ atau pakai Mode Demo'}`
  );
  console.log(line);
  console.log('  Tekan Ctrl+C untuk berhenti.');
});

process.on('SIGINT', () => {
  console.log('\nMenutup server…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
});
