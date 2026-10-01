# 🎮 anime-extract — ekstraksi asset Unity **tanpa PC** (repo private)

Repo ini adalah kotak perkakas pribadi: memasang **[AnimeStudio](https://github.com/Escartem/AnimeStudio)**
(asset extractor game Unity, MIT, oleh **Escartem**) supaya bisa dipakai **100% dari HP**.

```
📱 HP kamu                     ☁️ Repo ini (private)              💻 Runner Windows GitHub
upload bundle ke Releases  →   Actions → Run workflow      →     AnimeStudio.CLI.exe
isi form (game + link)                                             bongkar bundle
unduh hasil (link)         ←   Releases / Artifacts         ←     zip hasil + log
```

## 📱 Cara pakai dari HP (paling gampang — pakai app)

Buka app-nya di Chrome HP: **https://kyokoapp.github.io/animestudio/**
→ menu ⋮ → **Add to Home screen / Install app** (jadi seperti aplikasi biasa).

Di dalam app: isi token GitHub sekali → kirim bundle → pilih game → jalankan → unduh hasilnya.
Bisa juga tetap manual lewat tombol **Actions → AnimeStudio Extract → Run workflow** seperti biasa.

(Kode sumber app-nya: repo publik [KyokoApp/animestudio](https://github.com/KyokoApp/animestudio) — app shell saja,
tanpa token dan tanpa hasil. Semua hasil ekstraksi tetap tersimpan **hanya di repo private ini**.)

---

Karena repo ini **private**, hasil ekstraksi (yang isinya asset berhak cipta) **tidak bisa diunduh
siapa pun kecuali kamu**.

| Isi repo | Fungsi |
| --- | --- |
| `.github/workflows/extract.yml` | Workflow: unduh build resmi CLI → jalankan → ringkasan + hasil |
| `tools/anime.py` | Alat bantu CLI: `kick` (jalankan), `status` (lihat), `pull` (unduh hasil) |
| `trigger.json` | Pemicu "kick" — ubah file ini → workflow jalan (bisa dari branch mana pun) |
| `web/` | Server web lokal (Node.js, tanpa dependensi) + UI mobile, untuk kalau nanti ada PC/VPS |

---

## 🚀 Mulai cepat (dari HP)

### 1. Taruh bundle di Releases

1. Tab **Releases** → **Draft a new release**
2. **Choose a tag** → tulis `bundle-v1` → *Create new tag*
3. **Attach binaries** → pilih file bundle dari HP. Maks **2 GB per file**
4. **Publish release** → **salin link filenya** (tekan lama → *Copy link*):

   ```
   https://github.com/KyokoApp/anime-extract/releases/download/bundle-v1/nama-file.zip
   ```

### 2. Jalankan ekstraksi

1. Tab **Actions** → **AnimeStudio Extract** (kiri) → **Run workflow** (kanan)
2. Isi: **game** (`GI`, `SR`, `ZZZ`, `Normal`, …) dan **bundle_url** (link tadi)
3. **Run workflow** → selesai dalam **< 1 menit** untuk bundle kecil (terukur 21 detik),
   bundel ratusan MB–GB bisa puluhan menit. Klik run-nya untuk log hidup.

   Kalau tombol belum muncul (mis. workflow baru diubah di branch lain), pakai jalur kick:
   ubah `trigger.json` (isi `bundle_url`, `dry_run: false`) lalu commit — atau pakai `tools/anime.py`.

### 3. Ambil hasilnya

| Cara | Di mana | Kapan |
| --- | --- | --- |
| **Releases** (default) | Tab Releases → tag `extract-N` → unduh `hasil-ekstraksi.zip` | paling enak dari HP, dapat link langsung |
| **Artifacts** | Halaman run → bagian **Artifacts** | kalau `publish_release = no`; disimpan 3 hari |

Ringkasan hasil (jumlah file + tabel per ekstensi) muncul di halaman run bagian **Summary**.

---

## 📝 Input workflow

| Input | Isi | Default |
| --- | --- | --- |
| **game** | Kode game AnimeStudio | `GI` |
| **bundle_url** | Link release GitHub / link http langsung / path file di repo | – |
| **types** | Jenis asset dipisah koma; **kosong = semua jenis** | `Texture2D,Sprite,TextAsset` |
| **export_type** | `Convert` (png/wav/obj siap pakai) · `Raw` · `Dump` · `JSON` | `Convert` |
| **group_assets** | `ByType` · `ByContainer` · `BySource` · `None` | `ByType` |
| **map_op** | Bikin/pakai asset map | `None` |
| **unity_version** | mis. `2020.3.30f1`; kosong = auto | – |
| **cli_build** | `net10` (terbaru) / `net9` (stabil) | `net10` |
| **publish_release** | `yes` = hasil ke tab Releases | `yes` |

### Kode game yang sering dipakai

| Game | Kode |
| --- | --- |
| Genshin Impact | `GI` (+ `GI_Pack`, `GI_CB1..CB3`, `GI_CB3Pre`) |
| Honkai: Star Rail | `SR` (+ `SR_CB2`) · Honkai Impact 3rd: `BH3` |
| Zenless Zone Zero | `ZZZ` (+ `ZZZ_CB1`, `ZZZ_CB2`) |
| Tears of Themis | `TOT` |
| Unity biasa (tanpa enkripsi) | `Normal` · header dimodifikasi: `FakeHeader` |
| Arknights: Endfield / Reverse: 1999 / Arknights / Girls' Frontline | `ArknightsEndfield`, `Reverse1999`, `Arknights`, `GirlsFrontline` |
| Unity CN (PGR, Neural Cloud, Mecharashi, …) | `PGR_GLB_KR`, `NeuralCloud`, … (74 kode total) |

Daftar lengkap: `python3 tools/anime.py games`

---

## 🔁 Memicu tanpa tombol ("kick")

| Cara | Kapan | Syarat |
| --- | --- | --- |
| Tombol **Run workflow** | sehari-hari dari HP | workflow ada di branch `main` |
| **Kick file** `trigger.json` | dari branch mana pun, dipakai agent/sandbox | – |

```bash
# Tulis trigger.json lalu push -> workflow langsung jalan
python3 tools/anime.py kick --game GI --url "https://.../bundle.zip" --watch
```

`tools/anime.py` juga bisa:
- `status` — riwayat run + kesimpulan
- `pull --run N` — unduh artifact/release lalu otomatis dibuka zip-nya
- `kick --dry-run true` — uji input tanpa ekstraksi

Butuh token GitHub (scope `repo` + `workflow`) di environment variable `GITHUB_TOKEN`.
**Jangan** pernah menaruh token di dalam repo.

---

## ⚠️ Batasan (angka per 2026)

| Batas | Angka |
| --- | --- |
| Ukuran file per release | **2 GB** (hasil > 1,8 GB otomatis dipecah `.001/.002`) |
| Runner Windows (repo **private**) | **2 core / 8 GB RAM / disk 14 GB** |
| Kuota Actions repo private (plan Free) | 2.000 menit Linux/bulan, Windows dihitung **×2** → **±1.000 menit/bulan** |
| Simpan artifact | 3 hari + kuota 500 MB (hasil > 450 MB otomatis lewat Releases) |
| Waktu tipikal | < 1 menit untuk bundle kecil, puluhan menit untuk bundle GB |

Kalau kuota menit menipis: jalankan hanya saat perlu, pakai `types` yang spesifik (jangan `kosong`
kalau tidak perlu semua), dan hindari bundle raksasa.

---

## 🧯 Kalau ada masalah

| Gejala | Solusi |
| --- | --- |
| Tombol *Run workflow* tidak ada | Workflow belum ada di branch default, atau Actions belum diaktifkan. Jalankan lewat kick file / `anime.py kick --branch <branch>`. |
| Selesai tapi **0 file** | 90% kode game salah (mis. `GI` vs `GI_CB3`), atau filter `types` terlalu sempit → kosongkan `types`. |
| Error ambil bundle | Link mati / bukan link langsung (link viewer Google Drive tidak bisa). |
| Hasil aneh / nama berantakan | Isi `unity_version` lalu jalankan ulang. |
| `MeshRenderer/SkinnedMeshRenderer` error | Batasi `types` ke `Mesh,Texture2D` dulu. |
| Kuota Actions habis | Tunggu reset bulanan, atau batasi pemakaian; repo publik gratis tanpa batas tapi **jangan** dipakai untuk asset berhak cipta. |

---

## 🔐 Hak cipta & etika

- Hasil ekstraksi tetap milik publisher game-nya. Pakai untuk keperluan pribadi (belajar, fanart,
  mod pribadi) — jangan dijual atau disebar bebas.
- Repo private ini menjaga hasil tetap tertutup, tapi itu bukan izin untuk redistribusi.
- Yang dijalankan adalah **AnimeStudio resmi** dari nightly build Escartem (bukan build modifikasi).
  Kredit: **Escartem** (AnimeStudio) → **Razmoth** (Studio) → **Perfare** (AssetStudio). Lisensi MIT.
- Jangan commit token/secret ke repo ini. Kalau pernah bocor, segera revoke di GitHub → Settings.

---

## 💻 Opsional: server web lokal (`web/`)

Kalau nanti punya PC/VPS Windows, folder `web/` berisi UI web (bahasa Indonesia, ramah HP) yang
membungkus `AnimeStudio.CLI`: upload bundle → progress hidup → galeri hasil (pratinjau gambar/audio/
teks) → download per file atau zip. Tanpa dependensi npm.

```bash
# di PC/VPS Windows: taruh AnimeStudio.CLI.exe di web/bin/AnimeStudio/, lalu
cd web && run-windows.bat     # atau: node server.js
# buka http://localhost:8787  (atau http://IP-PC:8787 dari HP)
```

Detailnya ada di `web/README.md`.
