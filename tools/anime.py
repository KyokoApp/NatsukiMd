#!/usr/bin/env python3
"""
anime.py — alat bantu AnimeStudio untuk repo ini (stdlib Python saja, tanpa dependensi).

Perintah:
  kick    : jalankan workflow AnimeStudio (coba tombol Run workflow dulu; kalau belum
            aktif, otomatis lewat file pemicu trigger.json)
  status  : lihat riwayat jalan + kesimpulannya
  pull    : unduh hasil ekstraksi (artifact / release) lalu buka zip-nya
  games   : tampilkan daftar kode game yang dikenal

Token GitHub lewat environment variable:

    export GITHUB_TOKEN=ghp_xxx          # Linux / macOS / Termux
    set GITHUB_TOKEN=ghp_xxx             # Windows CMD
    $env:GITHUB_TOKEN="ghp_xxx"          # PowerShell

Scope yang dibutuhkan: `repo` + `workflow` (classic), atau fine-grained:
Contents read/write + Actions read/write. JANGAN taruh token di dalam repo.

Contoh:
    python3 tools/anime.py status
    python3 tools/anime.py kick --game GI --url "https://github.com/.../bundle.zip" --watch
    python3 tools/anime.py pull --latest --out hasil
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
import zipfile

API = "https://api.github.com"
DEFAULT_REPO = os.environ.get("ANIME_REPO", "KyokoApp/anime-extract")
WORKFLOW_PATH = ".github/workflows/extract.yml"
TRIGGER_PATH = "trigger.json"

KODE_GAME = """Normal UnityCN GI GI_Pack GI_CB1 GI_CB2 GI_CB3 GI_CB3Pre BH3 BH3Pre BH3PrePre
SR SR_CB2 ZZZ ZZZ_CB1 ZZZ_CB2 HNA_CB1 HYG_CB1 TOT Naraka EnsembleStars OPFP FakeHeader
FantasyOfWind ShiningNikki HelixWaltz2 NetEase AnchorPanic DreamscapeAlbireo ImaginaryFest
AliceGearAegis ProjectSekai CodenameJump GirlsFrontline Reverse1999 ArknightsEndfield
ArknightsEndfieldCB3 ArknightsEndfieldCB2 ArknightsEndfieldCB1 Arknights JJKPhantomParade
MuvLuvDimensions PartyAnimals LoveAndDeepspace SchoolGirlStrikers ExAstris PerpetualNovelty
RewindingCadence AzurPromiliaCBT2 AFKJourney PGR_GLB_KR PGR_CN_JP_TW PGR_CN_JP_TW_OLD
Archeland_KalpaOfUniverse Archeland_1114 NeuralCloud NeuralCloudCN HiganEruthyll WhiteCord
Mecharashi CastlevaniaMoonNightFantasy HYSXZY DoulaContinent BlessGlobal Starside
ResonanceSoltice OblivionOverride Dawnlands BB DynastyLegends2 EvernightCN XintianlongBabu
FrostpunkBeyondTheIce CatFantasy UnityCNCustomKey""".split()


# ------------------------------------------------------------------ HTTP dasar
class ApiError(Exception):
    def __init__(self, code, body):
        super().__init__(f"HTTP {code}: {body[:300]}")
        self.code = code
        self.body = body


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Jangan ikut redirect otomatis — supaya token tidak ikut terkirim ke host lain."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def token():
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not tok:
        sys.exit(
            "Token GitHub belum diset.\n"
            "  export GITHUB_TOKEN=ghp_xxxx   (Linux/macOS/Termux)\n"
            '  set GITHUB_TOKEN=ghp_xxxx      (Windows CMD)\n'
            "Bikin di: GitHub -> Settings -> Developer settings -> Personal access tokens"
        )
    return tok.strip()


def api(path, method="GET", body=None, raw=False, follow=True):
    url = path if path.startswith("http") else API + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token())
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("User-Agent", "animestudio-helper")
    if data is not None:
        req.add_header("Content-Type", "application/json")

    opener = urllib.request.build_opener(NoRedirect() if not follow else urllib.request.HTTPRedirectHandler())
    try:
        with opener.open(req, timeout=180) as r:
            payload = r.read()
            if raw:
                return payload
            if not payload:
                return {}
            return json.loads(payload) if "json" in r.headers.get("Content-Type", "") else payload
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        if e.code == 302 and e.headers.get("Location"):
            return {"location": e.headers["Location"]}
        raise ApiError(e.code, detail) from None
    except urllib.error.URLError as e:
        sys.exit(f"Gagal konek ke GitHub: {e.reason}")


def list_runs(repo, limit=10):
    """Run workflow terbaru (difilter dari daftar run repo, jadi tetap jalan walau
    file workflow belum ada di branch default)."""
    data = api(f"/repos/{repo}/actions/runs?per_page=100")
    runs = [r for r in data.get("workflow_runs", []) if r.get("path") == WORKFLOW_PATH]
    return runs[:limit]


def cari_run(repo, nomor):
    for r in list_runs(repo, limit=100):
        if r["run_number"] == nomor:
            return r
    return None


def fmt_bytes(n):
    n = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024


# ----------------------------------------------------------------------- kick
def input_dari_args(args):
    return {
        "game": args.game,
        "bundle_url": args.url,
        "types": args.types,
        "export_type": args.export,
        "group_assets": args.group,
        "map_op": args.map_op,
        "unity_version": args.unity,
        "cli_build": args.build,
        "publish_release": args.publish,
        "dry_run": args.dry_run,
    }


def kick_lewat_tombol(repo, branch, inputs):
    api(
        f"/repos/{repo}/actions/workflows/extract.yml/dispatches",
        "POST",
        {"ref": branch, "inputs": {k: v for k, v in inputs.items() if k != "dry_run"}},
    )


def kick_lewat_file(repo, branch, inputs, pesan=None):
    """Tulis trigger.json di branch -> push event -> workflow jalan."""
    sha = None
    try:
        info = api(f"/repos/{repo}/contents/{TRIGGER_PATH}?ref={branch}")
        sha = info.get("sha")
    except ApiError as e:
        if e.code != 404:
            raise

    isi = {
        "_catatan": "Dibuat oleh tools/anime.py — mengubah file ini memicu workflow AnimeStudio.",
        **inputs,
    }
    body = {
        "message": pesan or f"chore(kick): {inputs['game']} ({inputs['types'] or 'semua jenis'})",
        "content": base64.b64encode(
            (json.dumps(isi, indent=2, ensure_ascii=False) + "\n").encode()
        ).decode(),
        "branch": branch,
    }
    if sha:
        body["sha"] = sha
    api(f"/repos/{repo}/contents/{TRIGGER_PATH}", "PUT", body)


def cmd_kick(args):
    inputs = input_dari_args(args)
    print(f"→ repo {args.repo} | branch {args.branch}")
    print(f"  game={inputs['game']}  types={inputs['types'] or '(semua)'}  "
          f"export={inputs['export_type']}  publish_release={inputs['publish_release']}"
          + ("  [dry_run]" if args.dry_run == "true" else ""))

    jalur = "tombol Run workflow"
    try:
        kick_lewat_tombol(args.repo, args.branch, inputs)
    except ApiError as e:
        if e.code not in (404, 422):
            raise
        jalur = "file pemicu (trigger.json)"
        print("  tombol Run workflow belum aktif (workflow belum ada di branch default)")
        print("  → pakai jalur kick file:", TRIGGER_PATH)
        kick_lewat_file(args.repo, args.branch, inputs)
    print(f"✅ dikirim lewat {jalur}")

    if args.dry_run == "true" and jalur.startswith("file"):
        print("   (dry_run: hanya menguji input, ekstraksi tidak dijalankan)")

    # tunggu run-nya muncul
    run = None
    for _ in range(10):
        time.sleep(4)
        kandidat = [r for r in list_runs(args.repo, limit=5) if r.get("head_branch") == args.branch]
        if kandidat:
            run = kandidat[0]
            break
    if not run:
        print("   (run belum muncul; cek sebentar lagi: anime.py status)")
        return 0
    print(f"   Run #{run['run_number']} — {run['html_url']}")

    if args.watch:
        return cmd_watch(args, run["id"], run["run_number"])
    return 0


def cmd_watch(args, run_id, run_number):
    terakhir = ""
    while True:
        r = api(f"/repos/{args.repo}/actions/runs/{run_id}")
        st = f"{r['status']} / {r.get('conclusion') or '-'}"
        if st != terakhir:
            print(f"   [#{run_number}] {st}")
            terakhir = st
        if r["status"] == "completed":
            print(f"   Selesai: {r.get('conclusion')}")
            print(f"   Ringkasan & log: {r['html_url']}")
            if args.pull_saat_selesai:
                print()
                pull_results(args.repo, run_number, args.out)
            return 0
        time.sleep(15)


# --------------------------------------------------------------------- status
def cmd_status(args):
    runs = list_runs(args.repo, args.limit)
    if not runs:
        print(f"Belum ada riwayat AnimeStudio di {args.repo}.")
        return 0
    print(f"Riwayat AnimeStudio di {args.repo}:\n")
    for r in runs:
        judul = (r.get("display_title") or "")[:44]
        print(f"  #{r['run_number']:<4} {r['created_at'][:16].replace('T', ' ')}  "
              f"{r['status']:<11} {r.get('conclusion') or '-':<10} {judul}")
    b = runs[0]
    print(f"\nTerbaru: {b['html_url']}")
    print(f"Ambil hasilnya: python3 {os.path.relpath(__file__)} pull --run {b['run_number']}")
    return 0


# ----------------------------------------------------------------------- pull
def pull_results(repo, run_number=None, out="hasil", keep_zip=False):
    run = cari_run(repo, run_number) if run_number else (list_runs(repo, 1) or [None])[0]
    if not run:
        sys.exit(f"Run #{run_number} tidak ketemu (lihat: anime.py status)")

    run_number = run["run_number"]
    print(f"Run #{run_number} — {run['status']} / {run.get('conclusion') or '-'}")
    os.makedirs(out, exist_ok=True)
    dibuat = []

    atas = "Authorization"
    for a in api(f"/repos/{repo}/actions/runs/{run['id']}/artifacts").get("artifacts", []):
        if a["expired"]:
            print(f"  artifact {a['name']} sudah kedaluwarsa (lewat masa simpan)")
            continue
        print(f"  mengunduh artifact {a['name']} ({fmt_bytes(a['size_in_bytes'])}) ...")
        target = os.path.join(out, f"{a['name']}.zip")
        unduh_beredirect(f"/repos/{repo}/actions/artifacts/{a['id']}/zip", target)
        dibuat.append(target)

    try:
        rel = api(f"/repos/{repo}/releases/tags/extract-{run_number}")
        for asset in rel.get("assets", []):
            print(f"  mengunduh release asset {asset['name']} ({fmt_bytes(asset['size'])}) ...")
            target = os.path.join(out, asset["name"])
            unduh_beredirect(f"/repos/{repo}/releases/assets/{asset['id']}", target,
                             {"Accept": "application/octet-stream"})
            dibuat.append(target)
    except ApiError as e:
        if e.code != 404:
            raise

    if not dibuat:
        print("  Tidak ada artifact/release untuk run ini (mungkin hasilnya kosong / dry_run).")
        return 1

    for z in list(dibuat):
        if not z.lower().endswith(".zip"):
            continue
        tujuan = os.path.join(out, os.path.basename(z)[:-4])
        try:
            with zipfile.ZipFile(z) as zf:
                zf.extractall(tujuan)
                n = len(zf.namelist())
            print(f"  ✅ {os.path.basename(z)} -> {tujuan}/ ({n} entri)")
            if not keep_zip:
                os.remove(z)
        except zipfile.BadZipFile:
            print(f"  ⚠️  {z} bukan zip utuh (bisa jadi bagian .001 dari pecahan — buka dengan 7z/ZArchiver)")

    total = 0
    for root, _, files in os.walk(out):
        for f in files:
            total += os.path.getsize(os.path.join(root, f))
    print(f"\nSelesai. Isi {out}/ = {fmt_bytes(total)}")
    return 0


def unduh_beredirect(path, target, extra_headers=None):
    """Unduhan GitHub biasanya 302 ke blob storage; token hanya dikirim ke api.github.com."""
    req = urllib.request.Request(API + path, headers=extra_headers or {})
    req.add_header("Authorization", "Bearer " + token())
    req.add_header("User-Agent", "animestudio-helper")
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(req, timeout=180) as r:
            simpan_ke(r, target)
    except urllib.error.HTTPError as e:
        if e.code != 302:
            raise ApiError(e.code, e.read().decode("utf-8", "replace")) from None
        url = e.headers.get("Location")
        req2 = urllib.request.Request(url)
        req2.add_header("User-Agent", "animestudio-helper")
        with urllib.request.urlopen(req2, timeout=900) as r2:
            simpan_ke(r2, target)


def simpan_ke(response, target):
    panjang = response.headers.get("Content-Length")
    panjang = int(panjang) if panjang else None
    sudah = 0
    with open(target, "wb") as f:
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            sudah += len(chunk)
            if panjang:
                print(f"\r    {fmt_bytes(sudah)} / {fmt_bytes(panjang)}", end="")
    if panjang:
        print()


def cmd_games(_args):
    print("Kode game yang dikenal workflow AnimeStudio:\n")
    for i in range(0, len(KODE_GAME), 4):
        print("  " + "".join(f"{k:<26}" for k in KODE_GAME[i:i + 4]).rstrip())
    print("\n(Lihat README.md untuk tabel per game.)")
    return 0


# ----------------------------------------------------------------------- main
def main():
    p = argparse.ArgumentParser(
        description="Alat bantu AnimeStudio (ekstraksi jalan di runner Windows GitHub).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--repo", default=DEFAULT_REPO, help=f"owner/repo (default: {DEFAULT_REPO})")
    sub = p.add_subparsers(dest="cmd", required=True)

    k = sub.add_parser("kick", help="jalankan workflow")
    k.add_argument("--game", required=True)
    k.add_argument("--url", required=True, help="link bundle / path file di repo")
    k.add_argument("--types", default="Texture2D,Sprite,TextAsset", help="kosong = semua jenis")
    k.add_argument("--export", default="Convert", choices=["Convert", "Raw", "Dump", "JSON"])
    k.add_argument("--group", default="ByType", choices=["ByType", "ByContainer", "BySource", "None"])
    k.add_argument("--map-op", default="None", choices=["None", "CABMap", "AssetMap", "Both", "All"])
    k.add_argument("--unity", default="")
    k.add_argument("--build", default="net10", choices=["net10", "net9"])
    k.add_argument("--publish", default="no", choices=["no", "yes"])
    k.add_argument("--dry-run", default="false", choices=["false", "true"], help="uji input saja")
    k.add_argument("--branch", default="main", help="branch kerja (default main)")
    k.add_argument("--watch", action="store_true", help="pantau sampai selesai")
    k.add_argument("--pull-saat-selesai", action="store_true", help="langsung unduh hasil")
    k.add_argument("--out", default="hasil")
    k.set_defaults(func=cmd_kick)

    s = sub.add_parser("status", help="riwayat jalan")
    s.add_argument("--limit", type=int, default=5)
    s.set_defaults(func=cmd_status)

    u = sub.add_parser("pull", help="unduh hasil ekstraksi")
    u.add_argument("--run", type=int, default=None, help="nomor run (default: terbaru)")
    u.add_argument("--latest", action="store_true")
    u.add_argument("--out", default="hasil")
    u.add_argument("--keep-zip", action="store_true")
    u.set_defaults(func=lambda a: pull_results(a.repo, a.run, a.out, a.keep_zip))

    g = sub.add_parser("games", help="daftar kode game")
    g.set_defaults(func=cmd_games)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\ndibatalkan")
        sys.exit(130)
    except ApiError as e:
        sys.exit(f"GitHub API error — {e}")
