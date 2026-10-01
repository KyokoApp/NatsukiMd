'use strict';
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.tga': 'image/x-tga',
  '.exr': 'image/x-exr',
  '.ktx': 'image/ktx',
  '.dds': 'image/vnd-ms.dds',
  '.psd': 'image/vnd.adobe.photoshop',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.obj': 'text/plain; charset=utf-8',
  '.mtl': 'text/plain; charset=utf-8',
  '.fbx': 'application/octet-stream',
  '.shader': 'text/plain; charset=utf-8',
  '.anim': 'text/plain; charset=utf-8',
  '.asset': 'application/octet-stream',
  '.zip': 'application/zip',
};

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

const MEDIA_EXT = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico', 'svg', 'tga', 'dds', 'ktx', 'exr',
  'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac',
  'mp4', 'webm', 'mov',
]);
const TEXT_EXT = new Set(['txt', 'json', 'xml', 'yaml', 'yml', 'csv', 'md', 'obj', 'mtl', 'shader', 'anim', 'log', 'ini', 'bytes']);

function extOf(name) {
  const e = path.extname(name);
  return e ? e.slice(1).toLowerCase() : '';
}

/** Confine a client supplied relative path inside `base`. Returns null when unsafe. */
function safeJoin(base, rel) {
  const cleaned = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned) return null;
  const abs = path.resolve(base, cleaned);
  const root = path.resolve(base);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

function humanBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

function randomId() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${t}-${r}`;
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

function sendJson(res, code, data) {
  const buf = Buffer.from(JSON.stringify(data), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

module.exports = { mimeFor, extOf, safeJoin, humanBytes, randomId, readBody, readJson, sendJson, MEDIA_EXT, TEXT_EXT };
