# Panduan Deployment — LexisAI

## Keputusan arsitektur (terkunci)

> **PWA + GitHub Pages + index di HuggingFace Datasets + Transformers.js + WebLLM.
> Zero rupiah ke pemilik, offline setelah unduhan pertama, update granular per-versi.**

Implementasi aktual: hosting utama **GitHub Pages** (korpus ikut di-deploy dari
`frontend/public/data/` — 15.5MB, gratis). HuggingFace Datasets tetap tersedia
sebagai opsi apabila korpus membesar atau trafik Pages mendekati limit.

### Prinsip zero-cost

| Komponen | Berjalan di | Biaya ke pemilik |
|---|---|---|
| App (React bundle) | CDN GitHub Pages | Rp 0 |
| Korpus pasal (~16MB) | GitHub Pages / HF Datasets | Rp 0 |
| Model embedding (~25MB) | CDN HuggingFace (`Xenova/all-MiniLM-L6-v2`) | Rp 0 |
| Model LLM (~1GB) | CDN HuggingFace (`Qwen2.5-1.5B-Instruct-q4f16_1-MLC`) | Rp 0 |
| Retrieval + generasi | **Perangkat user** (WASM + WebGPU) | Rp 0 |
| Cek update korpus | `manifest.json` (~KB) tiap buka app | Rp 0 |

---

## A. Deploy ke GitHub Pages (utama)

### Setup sekali

1. Push repo ke GitHub (sudah berisi `.github/workflows/deploy.yml`).
2. Di repo GitHub: **Settings → Pages → Build and deployment → Source: `GitHub Actions`**.
3. Push ke `main` — workflow `Deploy PWA to GitHub Pages` berjalan otomatis.
4. Aplikasi live di **`https://82080038.github.io/LexisAI/`**.

### Cara kerja workflow

`deploy.yml` (jalan tiap push ke `main`):
1. `npm ci` + `npm run build` di `frontend/` dengan `VITE_BASE=/LexisAI/`
   (subpath repo — ganti bila nama repo/domain berubah).
2. `frontend/dist` diunggah sebagai Pages artifact, lalu di-deploy.

`frontend/public/data/` (korpus hasil `export_index.py`) ikut ter-commit dan
tersaji statis dari `/LexisAI/data/` — tidak perlu langkah terpisah.

### Deploy manual (tanpa Actions)

```bash
cd frontend
VITE_BASE=/LexisAI/ npm run build   # sesuaikan subpath
# unggah isi dist/ ke branch gh-pages atau static host mana pun
```

---

## B. Update korpus saat UU berubah/bertambah

```bash
# 1. Tambah/ganti PDF di data/pdf/, ingest ulang
venv/bin/python ingest.py --fast

# 2. Export ulang korpus ke FE
venv/bin/python scripts/export_index.py

# 3. Commit + push -> deploy.yml otomatis mendeploy versi baru
git add frontend/public/data && git commit -m "update korpus" && git push
```

Di sisi user: app cek `manifest.json` tiap startup; hanya file UU dengan
sha256 berbeda yang diunduh ulang (**delta per-dokumen**). Update kode app
ditangani service worker (toast "Versi baru tersedia").

---

## C. Opsi: korpus di HuggingFace Datasets

Berguna bila korpus >100MB atau ingin memisahkan update data dari deploy kode.

```bash
# 1. Buat repo dataset publik di huggingface.co (sekali)
# 2. Upload hasil export
huggingface-cli upload <user>/lexisai-corpus frontend/public/data data --repo-type dataset

# 3. Build dengan basis korpus eksternal
cd frontend
VITE_BASE=/LexisAI/ \
VITE_CORPUS_BASE=https://huggingface.co/datasets/<user>/lexisai-corpus/resolve/main/data \
npm run build
```

Catatan: `resolve/main/data/...` menyesuaikan struktur repo dataset.
CORS di HF Datasets sudah terbuka untuk fetch publik.

---

## D. Hosting alternatif (semua gratis)

- **Cloudflare Pages / Netlify / Vercel free tier** — drag-drop `dist/` atau
  sambungkan repo; build command `cd frontend && npm ci && npm run build`,
  output `frontend/dist`. Set `VITE_BASE=/` (root domain).
- **Hostinger shared (PHP)** — upload isi `dist/` ke `public_html/`
  (set `VITE_BASE=/` atau `/subfolder/`). App statis murni; PHP tidak dipakai.

## E. Kebutuhan browser user

- **Retrieval + baca pasal**: semua browser modern (WASM).
- **Jawaban LLM (WebLLM)**: WebGPU — Chrome/Edge desktop, sebagian Android.
  Tanpa WebGPU (Firefox lama, iOS Safari) → mode retrieval-only otomatis.
- Unduhan pertama: ~16MB korpus + ~25MB embedding (saat tanya pertama) +
  ~1GB bobot LLM (saat generate pertama, opsional & tercache permanen).
