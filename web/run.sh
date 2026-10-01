#!/usr/bin/env bash
# AnimeStudio Web — untuk Linux / macOS / Termux (butuh Node.js 18+)
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "[!] Node.js belum terpasang. Install dulu:"
  echo "    Termux : pkg install nodejs-lts"
  echo "    Debian : sudo apt install nodejs npm"
  echo "    macOS  : brew install node"
  exit 1
fi

mkdir -p bin/AnimeStudio
echo "  AnimeStudio Web dijalankan… (Ctrl+C untuk berhenti)"
exec node server.js
