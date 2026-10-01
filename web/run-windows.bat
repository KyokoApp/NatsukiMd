@echo off
REM ============================================================
REM  AnimeStudio Web — jalankan di Windows (dobel klik saja)
REM  Butuh Node.js (https://nodejs.org, pilih LTS)
REM ============================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Node.js belum terpasang.
  echo     Download dulu di https://nodejs.org  ^(pilih versi LTS^)
  echo     Setelah dipasang, dobel klik lagi file ini.
  echo.
  pause
  exit /b 1
)

if not exist "bin\AnimeStudio" mkdir "bin\AnimeStudio"

echo.
echo  Membuka AnimeStudio Web...
echo  Kalau ada peringatan Windows Firewall, pilih Allow
echo  supaya HP di wifi yang sama bisa mengakses.
echo.

start "" http://localhost:8787
node server.js

pause
