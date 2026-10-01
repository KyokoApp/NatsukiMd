'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const config = {
  root: ROOT,
  port: Number(process.env.PORT || process.env.AS_PORT || 8787),
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.AS_DATA_DIR || path.join(ROOT, 'data'),
  cliDir: process.env.AS_CLI_DIR || path.join(ROOT, 'bin', 'AnimeStudio'),
  // AS_CLI lets you point at any executable/command, e.g. a different build path.
  cliOverride: process.env.AS_CLI || '',
  maxLogBytes: 4 * 1024 * 1024,
  version: require(path.join(ROOT, 'package.json')).version,
};

function findCli() {
  if (config.cliOverride) {
    return { found: true, path: config.cliOverride, source: 'AS_CLI (env)', kind: 'custom' };
  }
  const bases = [config.cliDir, path.join(config.cliDir, 'AnimeStudio-net10'), path.join(config.cliDir, 'AnimeStudio-net9')];
  const candidates = ['AnimeStudio.CLI.exe', 'AnimeStudio.CLI', 'AnimeStudio.CLI.dll', 'AnimeStudio.exe', 'AnimeStudio.GUI.exe'];
  for (const base of bases) {
    for (const c of candidates) {
      const p = path.join(base, c);
      try {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          return { found: true, path: p, source: 'bin/AnimeStudio', kind: c.endsWith('.exe') ? 'exe' : 'bin' };
        }
      } catch (e) {
        /* ignore */
      }
    }
    // look one level deep (official zip extracts into a versioned folder)
    try {
      if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
        for (const sub of fs.readdirSync(base)) {
          for (const c of candidates) {
            const p = path.join(base, sub, c);
            if (fs.existsSync(p) && fs.statSync(p).isFile()) {
              return { found: true, path: p, source: 'bin/AnimeStudio', kind: c.endsWith('.exe') ? 'exe' : 'bin' };
            }
          }
        }
      }
    } catch (e) {
      /* ignore */
    }
  }
  return { found: false, path: null, source: null, kind: null };
}

function ensureDirs() {
  for (const d of [config.dataDir, path.join(config.dataDir, 'jobs'), config.cliDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

module.exports = { config, findCli, ensureDirs };
