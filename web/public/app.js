/* AnimeStudio Web — front-end (vanilla JS, tanpa dependensi) */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const S = {
  catalog: { games: [], classids: [] },
  state: null,
  game: null,
  types: ['Texture2D', 'Sprite', 'Mesh', 'TextAsset', 'AudioClip', 'AnimationClip'],
  files: [],            // {file, path, size}
  currentJob: null,
  jobs: [],
  zipReady: false,
  results: null,
  query: '',
  ext: '',
  es: null,
  uploading: false,
};

const POPULAR_TYPES = [
  'Texture2D', 'Sprite', 'Mesh', 'TextAsset', 'AudioClip', 'AnimationClip',
  'Material', 'Shader', 'Font', 'MonoBehaviour', 'VideoClip', 'AnimatorController',
];

const PRESETS = {
  'Gambar & sprite': ['Texture2D', 'Sprite', 'SpriteAtlas', 'RenderTexture'],
  'Audio': ['AudioClip'],
  'Model 3D': ['Mesh', 'SkinnedMeshRenderer', 'MeshRenderer', 'Material', 'Texture2D'],
  'Animasi': ['AnimationClip', 'Animator', 'AnimatorController', 'Avatar'],
  'Teks & data': ['TextAsset', 'MonoBehaviour', 'Font', 'Shader'],
};

const EXT_ICON = {
  png: '🖼️', jpg: '🖼️', jpeg: '🖼️', webp: '🖼️', gif: '🖼️', bmp: '🖼️', tga: '🖼️', exr: '🖼️',
  mp3: '🎵', wav: '🎵', ogg: '🎵', flac: '🎵', m4a: '🎵', aac: '🎵',
  mp4: '🎬', webm: '🎬', mov: '🎬',
  obj: '🧊', fbx: '🧊', mtl: '🧊',
  txt: '📄', json: '📄', xml: '📄', yaml: '📄', yml: '📄', csv: '📄', md: '📄', shader: '📄', anim: '📄',
  zip: '🗜️',
};
const isImage = (e) => ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico'].includes(e);
const isSvg = (e) => e === 'svg';
const isAudio = (e) => ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(e);
const isVideo = (e) => ['mp4', 'webm', 'mov'].includes(e);
const isText = (e) => ['txt', 'json', 'xml', 'yaml', 'yml', 'csv', 'md', 'obj', 'mtl', 'shader', 'anim', 'log'].includes(e);

/* ------------------------------------------------------------------ utils */

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? n.toFixed(0) : n.toFixed(1)} ${u[i]}`;
}
function fmtTime(ts) {
  if (!ts) return '—';
  const d = Date.now() - ts;
  if (d < 45000) return 'baru saja';
  const m = Math.round(d / 60000);
  if (m < 60) return `${m} menit lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return new Date(ts).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
}
function el(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of [].concat(kids)) if (kid) n.append(kid);
  return n;
}
function toast(msg, kind = '') {
  const t = el('div', { class: `toast ${kind}`, text: msg });
  $('#toast').append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 7000 : 4000);
}
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { data });
  return data;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* -------------------------------------------------------------- navigation */

function tab(name) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  if (name === 'jobs') { loadJobs(); if (S.currentJob) attachStream(S.currentJob); }
  if (name === 'results') loadResults();
}
$$('.tabbar button').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.tab; }));
window.addEventListener('hashchange', () => {
  const h = location.hash.replace('#', '') || 'new';
  tab(['new', 'jobs', 'results', 'guide'].includes(h) ? h : 'new');
});

/* -------------------------------------------------------------- modal/sheet */

function sheet(title, bodyNode, { onClose } = {}) {
  const back = el('div', { class: 'backdrop' });
  const card = el('div', { class: 'sheet' });
  const close = () => { back.remove(); if (onClose) onClose(); document.body.style.overflow = ''; };
  card.append(
    el('header', {}, [el('b', { text: title }), el('button', { class: 'x', text: '✕', onClick: close })]),
    el('div', { class: 'body' }, [bodyNode])
  );
  back.append(card);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  $('#modalRoot').append(back);
  document.body.style.overflow = 'hidden';
  return { close, back };
}

/* ------------------------------------------------------------------- boot */

async function boot() {
  try {
    const [cat, state] = await Promise.all([api('/api/catalog'), api('/api/state')]);
    S.catalog = cat;
    S.state = state;
    S.game = cat.games.find((g) => g.name === 'GI') || cat.games[0];
    renderGame();
    renderTypes();
    renderTopbar();
    renderJobs(state.jobs || []);
    if (state.cli.mock) {
      $('#demoBanner').style.display = '';
      $('#demoBannerTitle').textContent = '🔧 Server ini pakai CLI tiruan (tools/mock-cli.js)';
      $('#demoBannerText').innerHTML =
        'Semua alur bisa dicoba dari awal sampai selesai (upload → proses → hasil → zip), tapi hasilnya file contoh — ' +
        'bukan dari bundle asli kamu. Untuk hasil sungguhan, jalankan server dengan <code class="kbd">AnimeStudio.CLI.exe</code> asli ' +
        'di folder <code class="path">bin/AnimeStudio/</code>.';
      $('#btnDemo').textContent = 'Lihat contoh hasil instan';
    } else if (!state.cli.found) {
      $('#demoBanner').style.display = '';
    }
    const last = localStorage.getItem('as:lastJob');
    if (last && (state.jobs || []).some((j) => j.id === last)) S.currentJob = last;
  } catch (e) {
    toast('Gagal memuat katalog: ' + e.message, 'err');
  }
}

function renderTopbar() {
  const cli = S.state.cli;
  const pill = $('#cliPill');
  pill.classList.remove('ok', 'warn', 'err');
  if (cli.mock) {
    pill.classList.add('warn');
    $('#cliPillText').textContent = 'CLI tiruan (uji)';
    pill.title = 'Server jalan dengan AS_CLI="node tools/mock-cli.js" — hasilnya file contoh, bukan dari bundle asli.';
  } else if (cli.found) {
    pill.classList.add('ok');
    $('#cliPillText').textContent = cli.custom ? 'CLI kustom siap' : 'CLI siap';
    pill.title = cli.path + (cli.custom ? ' (dari AS_CLI)' : '');
  } else {
    pill.classList.add('warn');
    $('#cliPillText').textContent = 'belum ada CLI';
    pill.title = 'Taruh AnimeStudio.CLI.exe di folder bin/AnimeStudio/';
  }
}

/* ------------------------------------------------------------- game picker */

function renderGame() {
  $('#gameLabel').textContent = S.game.label;
  $('#gameSub').textContent = `${S.game.name} · ${S.game.category}${S.game.note ? ' — ' + S.game.note : ''}`;
}

$('#gameSelector').addEventListener('click', () => {
  const body = el('div');
  const search = el('input', { type: 'search', placeholder: 'Cari game… (mis. genshin, star rail, zzz)' });
  const list = el('div', { class: 'list', style: 'margin-top:10px' });
  body.append(search, list);

  let current = null;
  function render(q = '') {
    list.innerHTML = '';
    const ql = q.trim().toLowerCase();
    const games = S.catalog.games.filter(
      (g) => !ql || g.label.toLowerCase().includes(ql) || g.name.toLowerCase().includes(ql) || g.category.toLowerCase().includes(ql)
    );
    const byCat = {};
    for (const g of games) (byCat[g.category] = byCat[g.category] || []).push(g);
    const order = ['HoYoverse', 'Unity CN', 'Unity', 'Lainnya'];
    for (const cat of order.filter((c) => byCat[c])) {
      list.append(el('div', { class: 'grp', text: cat }));
      for (const g of byCat[cat]) {
        const b = el('button', { class: 'opt' + (S.game && g.name === S.game.name ? ' on' : '') }, [
          el('span', { text: g.label }),
          el('span', { class: 'sub', text: `${g.name}${g.note ? ' · ' + g.note : ''}` }),
        ]);
        b.addEventListener('click', () => { S.game = g; renderGame(); modal.close(); });
        list.append(b);
      }
    }
    if (!games.length) list.append(el('div', { class: 'muted small', text: 'Tidak ada yang cocok.' }));
  }
  search.addEventListener('input', () => render(search.value));
  render();
  const modal = sheet('Pilih game', body);
});

/* ------------------------------------------------------------- type picker */

function renderTypes() {
  const wrap = $('#typeChips');
  wrap.innerHTML = '';
  if (!S.types.length) {
    wrap.append(el('span', { class: 'muted small', text: 'Semua jenis asset (belum difilter).' }));
    return;
  }
  for (const t of S.types) {
    const chip = el('span', { class: 'chip on' }, [el('span', { text: t }), el('span', { class: 'x', text: '✕' })]);
    chip.addEventListener('click', () => { S.types = S.types.filter((x) => x !== t); renderTypes(); });
    wrap.append(chip);
  }
}

$('#btnPresetAll').addEventListener('click', () => { S.types = []; S.uiAllTypes = true; renderTypes(); toast('Akan mengekspor semua jenis asset'); });

$('#btnPickTypes').addEventListener('click', () => {
  const body = el('div');
  const search = el('input', { type: 'search', placeholder: 'Cari jenis asset… (Texture2D, AudioClip, Mesh…)' });
  const presets = el('div', { class: 'chips', style: 'margin-top:10px' });
  for (const [name, list] of Object.entries(PRESETS)) {
    const c = el('span', { class: 'chip mini', text: '+' + name });
    c.addEventListener('click', () => {
      S.types = Array.from(new Set([...S.types, ...list]));
      renderTypes();
      toast(`${name}: ${list.length} jenis ditambahkan`, 'ok');
    });
    presets.append(c);
  }
  const list = el('div', { class: 'list', style: 'margin-top:10px' });
  body.append(search, presets, list);

  function render(q = '') {
    list.innerHTML = '';
    const ql = q.trim().toLowerCase();
    const items = ql
      ? S.catalog.classids.filter((c) => c.toLowerCase().includes(ql)).slice(0, 200)
      : POPULAR_TYPES.concat(S.catalog.classids.filter((c) => !POPULAR_TYPES.includes(c))).slice(0, 300);
    if (!ql) list.append(el('div', { class: 'grp', text: 'paling sering dipakai' }));
    let headerDone = false;
    for (const c of items) {
      if (!ql && headerDone === false && !POPULAR_TYPES.includes(c)) {
        list.append(el('div', { class: 'grp', text: 'semua jenis asset (' + S.catalog.classids.length + ')' }));
        headerDone = true;
      }
      const on = S.types.includes(c);
      const b = el('button', { class: 'opt' + (on ? ' on' : '') });
      b.append(el('span', { text: (on ? '✓ ' : '') + c }));
      b.addEventListener('click', () => {
        S.types = on ? S.types.filter((x) => x !== c) : [...S.types, c];
        renderTypes();
        render(search.value);
      });
      list.append(b);
    }
    if (!items.length) list.append(el('div', { class: 'muted small', text: 'Tidak ditemukan — pastikan nama enum Unity benar (contoh: Texture2D).' }));
  }
  search.addEventListener('input', () => render(search.value));
  render();
  sheet('Pilih jenis asset', body);
});

/* ------------------------------------------------------------------ upload */

$('#btnPickFiles').addEventListener('click', () => $('#fileInput').click());
$('#btnPickFolder').addEventListener('click', () => $('#folderInput').click());
$('#fileInput').addEventListener('change', (e) => addFiles(Array.from(e.target.files), false));
$('#folderInput').addEventListener('change', (e) => addFiles(Array.from(e.target.files), true));
$('#btnClearFiles').addEventListener('click', () => { S.files = []; renderFiles(); });

const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => {
  const items = Array.from(e.dataTransfer.files || []);
  if (items.length) addFiles(items, items.some((f) => f.webkitRelativePath));
});

function relPathOf(f, fromFolder) {
  if (f.webkitRelativePath && f.webkitRelativePath.includes('/')) return f.webkitRelativePath.split('/').slice(1).join('/');
  if (f.webkitRelativePath) return f.webkitRelativePath;
  return fromFolder ? f.name : f.name;
}

function addFiles(files, fromFolder) {
  for (const f of files) {
    if (f.size === 0) continue;
    S.files.push({ file: f, path: relPathOf(f, fromFolder), size: f.size });
  }
  renderFiles();
}

function renderFiles() {
  const list = $('#fileList');
  list.innerHTML = '';
  const total = S.files.reduce((a, f) => a + f.size, 0);
  for (const [i, f] of S.files.entries()) {
    list.append(
      el('div', { class: 'fileitem' }, [
        el('span', { class: 'nm', text: f.path, title: f.path }),
        el('span', { class: 'sz', text: fmtBytes(f.size) }),
        el('button', { class: 'rm', text: '✕', onClick: () => { S.files.splice(i, 1); renderFiles(); } }),
      ])
    );
  }
  $('#fileSummary').style.display = S.files.length ? '' : 'none';
  $('#fileSummaryText').textContent = `${S.files.length} file · ${fmtBytes(total)}${total > 2 * 1024 ** 3 ? ' — file besar, upload dari HP bisa lama/putus' : ''}`;
}

/* --------------------------------------------------------------- start job */

$('#btnStart').addEventListener('click', async () => {
  if (S.uploading) return;
  if (!S.files.length) return toast('Pilih file bundle dulu ya.', 'err');
  if (!S.state.cli.found) {
    return toast('CLI belum terpasang — taruh AnimeStudio.CLI.exe di bin/AnimeStudio/, atau coba Mode Demo.', 'err');
  }
  const btn = $('#btnStart');
  S.uploading = true;
  btn.disabled = true;
  const totalBytes = S.files.reduce((a, f) => a + f.size, 0);
  let sent = 0;
  try {
    const opts = {
      game: S.game.name,
      types: S.types,
      exportType: $('#optExportType').value,
      groupAssets: $('#optGroup').value,
      names: $('#optNames').value.trim() ? $('#optNames').value.split(/\s+/).filter(Boolean) : [],
      containers: $('#optContainers').value.trim() ? $('#optContainers').value.split(/\s+/).filter(Boolean) : [],
      unityVersion: $('#optUnity').value.trim(),
      mapOp: $('#optMapOp').value,
      mapType: $('#optMapType').value,
      mapName: $('#optMapName').value.trim() || 'assets_map',
      key: $('#optKey').value.trim(),
      aiFile: $('#optAiFile').value.trim(),
      dummyDlls: $('#optDummy').value.trim(),
      silent: $('#optSilent').checked,
    };
    const { job } = await api('/api/jobs', { method: 'POST', body: opts });
    S.currentJob = job.id;
    localStorage.setItem('as:lastJob', job.id);
    tab('jobs');
    upsertJob(job);

    // upload file satu per satu supaya bisa menampilkan progress & hemat memori
    for (const f of S.files) {
      await uploadOne(job.id, f, (loaded) => {
        const pct = totalBytes ? Math.round(((sent + loaded) / totalBytes) * 100) : 0;
        btn.textContent = `⬆️ Upload ${pct}% — ${f.path.slice(0, 28)}`;
      });
      sent += f.size;
    }
    btn.textContent = '🚀 Mulai ekstraksi';
    const run = await api(`/api/jobs/${job.id}/run`, { method: 'POST' });
    upsertJob(run.job);
    attachStream(job.id);
    toast('Ekstraksi dimulai — lihat progress di tab Proses.', 'ok');
    S.files = [];
    renderFiles();
    $('#fileInput').value = '';
    $('#folderInput').value = '';
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    S.uploading = false;
    btn.disabled = false;
    btn.textContent = '🚀 Mulai ekstraksi';
  }
});

function uploadOne(jobId, f, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/jobs/${jobId}/file?path=${encodeURIComponent(f.path)}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.addEventListener('progress', (e) => onProgress(e.loaded));
    xhr.addEventListener('load', () => (xhr.status >= 200 && xhr.status < 300 ? resolve(JSON.parse(xhr.responseText || '{}')) : reject(new Error(`upload gagal (${xhr.status})`))));
    xhr.addEventListener('error', () => reject(new Error('koneksi ke server terputus saat upload')));
    xhr.send(f.file);
  });
}

/* ----------------------------------------------------------------- job list */

function stateLabel(s) {
  return {
    draft: 'siap', running: 'berjalan', done: 'selesai', error: 'gagal', canceled: 'dibatalkan',
  }[s] || s;
}

function renderJobs(jobs) {
  S.jobs = jobs;
  const wrap = $('#jobList');
  wrap.innerHTML = '';
  if (!jobs.length) {
    wrap.append(el('div', { class: 'muted small', text: 'Belum ada job. Mulai dari tab Ekstrak.' }));
    updateBadge();
    return;
  }
  for (const j of jobs) {
    const running = j.status === 'running';
    const card = el('div', { class: 'job' });
    card.append(
      el('div', { class: 'head' }, [
        el('div', { class: 't' }, [
          el('b', { text: `${j.game} · ${j.files.length} file${j.demo ? ' (contoh)' : ''}` }),
          el('span', { class: 'tiny muted', text: `${fmtTime(j.createdAt)} · ${fmtBytes(j.uploadedBytes || 0)} input${j.resultCount ? ` · ${j.resultCount} hasil (${fmtBytes(j.resultBytes)})` : ''}` }),
        ]),
        el('span', { class: `state ${j.status}`, text: stateLabel(j.status) }),
      ])
    );

    if (running || j.status === 'draft') {
      const pct = j.progress && j.progress.percent ? j.progress.percent : 0;
      const bar = el('div', { class: 'bar' + (pct ? '' : ' indet') });
      bar.append(el('i', { style: `width:${pct}%` }));
      card.append(bar, el('div', { class: 'tiny muted', style: 'margin-top:6px', text: (j.progress && j.progress.current) || 'menunggu…' }));
    }
    if (j.error) card.append(el('div', { class: 'tiny', style: 'color:#fca5a5;margin-top:6px', text: j.error }));

    const actions = el('div', { class: 'row wrap', style: 'margin-top:10px' });
    actions.append(el('button', { class: 'btn small ghost', text: 'Log', onClick: () => { S.currentJob = j.id; localStorage.setItem('as:lastJob', j.id); showLog(); } }));
    if (j.status === 'done' || j.resultCount) {
      actions.append(el('button', { class: 'btn small primary', text: 'Lihat hasil', onClick: () => { S.currentJob = j.id; localStorage.setItem('as:lastJob', j.id); location.hash = 'results'; } }));
    }
    if (running) actions.append(el('button', { class: 'btn small danger', text: 'Batalkan', onClick: async () => { await api(`/api/jobs/${j.id}/cancel`, { method: 'POST' }); loadJobs(); } }));
    actions.append(el('button', { class: 'btn small ghost', text: 'Hapus', onClick: async () => {
      if (!confirm('Hapus job ini beserta file input & hasilnya?')) return;
      await api(`/api/jobs/${j.id}`, { method: 'DELETE' });
      if (S.currentJob === j.id) { S.currentJob = null; $('#logCard').style.display = 'none'; }
      loadJobs();
    } }));
    card.append(actions);
    wrap.append(card);
  }
  updateBadge();
}

function updateBadge() {
  const running = S.jobs.filter((j) => j.status === 'running').length;
  const b = $('#jobBadge');
  b.classList.toggle('hidden', !running);
  b.textContent = running;
}

async function loadJobs() {
  try {
    const { jobs } = await api('/api/jobs');
    renderJobs(jobs);
    (jobs || []).forEach((j) => {
      if (j.status === 'running' && !j.silent) attachStream(j.id);
    });
  } catch (e) { /* ignore */ }
}

function upsertJob(job) {
  const i = S.jobs.findIndex((j) => j.id === job.id);
  if (i >= 0) S.jobs[i] = job; else S.jobs.unshift(job);
  renderJobs(S.jobs);
}

/* --------------------------------------------------------------------- log */

function showLog() {
  const job = S.jobs.find((j) => j.id === S.currentJob);
  if (!job) return toast('Pilih job dulu.', 'err');
  $('#logCard').style.display = '';
  $('#logJobId').textContent = job.id;
  tab('jobs');
  attachStream(job.id, true);
}

function logLine(text) {
  const box = $('#logBox');
  const line = el('div', { text });
  if (/\bERROR\b|\[error\]|Exception|Unhandled/i.test(text)) line.className = 'l-err';
  else if (/\bWARN/i.test(text)) line.className = 'l-warn';
  else if (/selesai|successfully|done/i.test(text)) line.className = 'l-ok';
  box.append(line);
  while (box.childElementCount > 4000) box.firstElementChild.remove();
  if ($('#logFollow').checked) box.scrollTop = box.scrollHeight;
}

function attachStream(jobId, force = false) {
  if (S.es && S.es._jobId === jobId && !force) return;
  if (S.es) { S.es.close(); S.es = null; }
  if (!jobId) return;
  if (force) $('#logBox').textContent = '';
  const es = new EventSource(`/api/jobs/${jobId}/events`);
  es._jobId = jobId;
  es.addEventListener('log', (e) => {
    const { lines } = JSON.parse(e.data);
    if (S.es !== es) return;
    if ($('#logCard').style.display !== 'none' || $('#view-jobs').classList.contains('active')) lines.forEach(logLine);
  });
  es.addEventListener('progress', (e) => {
    const p = JSON.parse(e.data);
    const j = S.jobs.find((x) => x.id === jobId);
    if (!j) return;
    j.progress = p;
    const now = Date.now();
    if (now - (S.lastProgressRender || 0) > 350) {
      S.lastProgressRender = now;
      renderJobs(S.jobs);
    }
  });
  es.addEventListener('zip', (e) => onZipEvent(jobId, JSON.parse(e.data)));
  es.addEventListener('status', (e) => {
    const job = JSON.parse(e.data);
    upsertJob(job);
    if (job.status !== 'running' && es._jobId === jobId) {
      // tetap sambung sebentar supaya event zip ikut tertangkap
    }
    if (job.status === 'done' && S.currentJob === jobId) toast('Ekstraksi selesai! Cek tab Hasil.', 'ok');
    if (job.status === 'error') toast('Ekstraksi gagal: ' + (job.error || ''), 'err');
  });
  es.onerror = () => { /* EventSource auto-reconnect */ };
  S.es = es;
}

/* ----------------------------------------------------------------- results */

async function loadResults() {
  if (!S.currentJob) {
    $('#resultHead').textContent = 'Belum ada job aktif — jalankan ekstraksi atau buka contoh hasil dari tab Ekstrak.';
    $('#gallery').innerHTML = '';
    $('#extChips').innerHTML = '';
    return;
  }
  try {
    const data = await api(`/api/jobs/${S.currentJob}/results?q=${encodeURIComponent(S.query)}&ext=${encodeURIComponent(S.ext)}`);
    const job = S.jobs.find((j) => j.id === S.currentJob) || {};
    $('#resultHead').innerHTML =
      `Job <b>${esc(S.currentJob)}</b> · game <b>${esc(job.game || '—')}</b> · status <b>${esc(stateLabel(job.status || '—'))}</b>` +
      (job.error ? `<br><span style="color:#fca5a5">${esc(job.error)}</span>` : '');
    renderExtChips(data.byExt || {});
    renderGallery(data.files || []);
    $('#resultFoot').textContent = data.count
      ? `${data.filtered} dari ${data.count} file · total ${data.prettySize}${data.shown < data.filtered ? ` · menampilkan ${data.shown} pertama` : ''}`
      : (job.status === 'running' ? 'Masih memproses… refresh beberapa saat lagi.' : 'Belum ada file di folder output.');
    if (data.hasZip) {
      S.zipReady = true;
      $('#zipInfo').textContent = `Zip sudah siap: ${fmtBytes(data.zipSize)}`;
      $('#btnZip').textContent = '⬇️ Download zip';
    } else {
      S.zipReady = false;
      $('#zipInfo').textContent = '';
      $('#btnZip').textContent = '⬇️ Download semua (.zip)';
    }
    $('#btnCancelJob').classList.toggle('hidden', job.status !== 'running');
  } catch (e) {
    toast(e.message, 'err');
  }
}

function renderExtChips(byExt) {
  const wrap = $('#extChips');
  wrap.innerHTML = '';
  const entries = Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 14);
  if (!entries.length) return;
  const all = el('span', { class: 'chip mini' + (S.ext === '' ? ' on' : ''), text: `semua (${Object.values(byExt).reduce((a, b) => a + b, 0)})` });
  all.addEventListener('click', () => { S.ext = ''; loadResults(); });
  wrap.append(all);
  for (const [ext, n] of entries) {
    const c = el('span', { class: 'chip mini' + (S.ext === ext ? ' on' : ''), text: `${EXT_ICON[ext] || '📄'} ${ext || 'lainnya'} (${n})` });
    c.addEventListener('click', () => { S.ext = S.ext === ext ? '' : ext; loadResults(); });
    wrap.append(c);
  }
}

function renderGallery(files) {
  const g = $('#gallery');
  g.innerHTML = '';
  if (!files.length) { g.append(el('div', { class: 'muted small', text: 'Tidak ada file yang cocok dengan filter.' })); return; }
  const MAX = 400;
  for (const f of files.slice(0, MAX)) {
    const url = `/api/jobs/${S.currentJob}/file?path=${encodeURIComponent(f.rel)}`;
    let tile;
    if (isImage(f.ext)) {
      tile = el('div', { class: 'tile', title: f.rel }, [
        el('img', { src: url, loading: 'lazy', decoding: 'async', alt: f.rel, onError: (e) => { e.target.replaceWith(el('div', { class: 'ic', style: 'font-size:26px;text-align:center;padding-top:38%', text: '🖼️' })); } }),
        el('div', { class: 'cap', text: f.rel.split('/').pop() }),
      ]);
    } else {
      tile = el('div', { class: 'tile file', title: f.rel }, [
        el('div', { class: 'ic', text: EXT_ICON[f.ext] || '📄' }),
        el('div', { class: 'nm', text: f.rel.split('/').pop() }),
        el('div', { class: 'tiny muted', text: fmtBytes(f.size), style: 'font-size:10px' }),
      ]);
    }
    tile.addEventListener('click', () => preview(f));
    g.append(tile);
  }
  if (files.length > MAX) g.append(el('div', { class: 'muted small', text: `… dan ${files.length - MAX} file lain (pakai filter untuk mempersempit)` }));
}

let searchTimer;
$('#resultSearch').addEventListener('input', (e) => {
  S.query = e.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadResults, 300);
});
$('#btnRefreshResults').addEventListener('click', loadResults);

function preview(f) {
  const url = `/api/jobs/${S.currentJob}/file?path=${encodeURIComponent(f.rel)}`;
  const dl = `${url}&download=1`;
  const body = el('div', { class: 'preview' });
  body.append(el('div', { class: 'small muted', style: 'margin-bottom:8px', text: `${f.rel} · ${fmtBytes(f.size)}` }));
  if (isImage(f.ext) || isSvg(f.ext)) body.append(el('img', { src: url, alt: f.rel }));
  else if (isAudio(f.ext)) body.append(el('audio', { controls: true, src: url }));
  else if (isVideo(f.ext)) body.append(el('video', { controls: true, src: url }));
  else if (isText(f.ext) || f.size < 96 * 1024) {
    const pre = el('pre', { class: 'log', text: 'memuat…' });
    body.append(pre);
    fetch(url, { headers: { Range: 'bytes=0-262143' } })
      .then((r) => r.text())
      .then((t) => { pre.textContent = t.slice(0, 200000) + (f.size > 200000 ? '\n… (dipotong)' : ''); })
      .catch(() => { pre.textContent = '(gagal memuat pratinjau teks)'; });
  } else {
    body.append(el('div', { class: 'muted small', text: 'Tidak ada pratinjau untuk tipe file ini — unduh saja filenya.' }));
  }
  body.append(el('div', { class: 'row wrap', style: 'margin-top:12px' }, [
    el('a', { class: 'btn primary', href: dl, text: '⬇️ Download file ini' }),
    el('button', { class: 'btn ghost', text: 'Copy nama', onClick: () => { navigator.clipboard?.writeText(f.rel); toast('Nama file dicopy', 'ok'); } }),
  ]));
  sheet(f.rel.split('/').pop(), body);
}

/* --------------------------------------------------------------------- zip */

$('#btnZip').addEventListener('click', async () => {
  if (!S.currentJob) return toast('Belum ada job aktif.', 'err');
  if (S.zipReady) {
    window.location.href = `/api/jobs/${S.currentJob}/zip`; // server kirim attachment → browser unduh
    return;
  }
  try {
    await api(`/api/jobs/${S.currentJob}/zip`, { method: 'POST' });
    toast('Zip sedang dibuat — halaman ini bisa ditinggal.', 'ok');
  } catch (e) { toast(e.message, 'err'); }
});

function onZipEvent(jobId, p) {
  const wrap = $('#zipBarWrap');
  const bar = $('#zipBar');
  if (p.stage === 'error') {
    toast('Zip gagal: ' + p.error, 'err');
    wrap.classList.add('hidden');
    S.zipReady = false;
    return;
  }
  wrap.classList.remove('hidden');
  bar.style.width = (p.percent || 0) + '%';
  if (p.stage === 'done') {
    S.zipReady = true;
    wrap.classList.add('hidden');
    $('#btnZip').textContent = '⬇️ Download zip';
    $('#zipInfo').textContent = 'Zip siap — klik "Download zip".';
    toast('Zip siap, mulai diunduh…', 'ok');
    window.location.href = `/api/jobs/${jobId}/zip`;
    return;
  }
  S.zipReady = false;
  $('#zipInfo').textContent = `Membuat zip… ${p.percent || 0}% (${p.stage === 'hash' ? 'memeriksa' : 'menulis'} ${p.current || ''})`;
}

/* -------------------------------------------------------------------- demo */

$('#btnDemo').addEventListener('click', async () => {
  try {
    const { job } = await api('/api/demo', { method: 'POST' });
    S.currentJob = job.id;
    localStorage.setItem('as:lastJob', job.id);
    upsertJob(job);
    toast('Contoh hasil dibuat — membuka tab Hasil.', 'ok');
    location.hash = 'results';
    setTimeout(loadResults, 300);
  } catch (e) { toast(e.message, 'err'); }
});

/* --------------------------------------------------------------- life cycle */

$('#btnOpenResults').addEventListener('click', () => { location.hash = 'results'; });
$('#btnCancelJob').addEventListener('click', async () => {
  if (!S.currentJob) return;
  await api(`/api/jobs/${S.currentJob}/cancel`, { method: 'POST' });
  toast('Job dibatalkan');
  loadJobs();
});
$('#btnDeleteJob').addEventListener('click', async () => {
  if (!S.currentJob) return;
  if (!confirm('Hapus job ini beserta input & hasilnya?')) return;
  await api(`/api/jobs/${S.currentJob}`, { method: 'DELETE' });
  S.currentJob = null;
  localStorage.removeItem('as:lastJob');
  $('#logCard').style.display = 'none';
  loadJobs();
  loadResults();
});
$('#btnRefreshJobs').addEventListener('click', loadJobs);

setInterval(() => {
  if (document.hidden) return;
  const running = S.jobs.some((j) => j.status === 'running');
  if (running || $('#view-jobs').classList.contains('active')) loadJobs();
  if (running && $('#view-results').classList.contains('active')) loadResults();
}, 5000);

boot().then(() => {
  const h = location.hash.replace('#', '');
  if (h) tab(h);
});
