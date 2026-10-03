# LexisAI - Asisten AI Ahli Hukum Indonesia (Berbasis RAG)

LexisAI adalah aplikasi kecerdasan buatan (*Artificial Intelligence*) yang dirancang khusus untuk memetakan, menganalisis, dan menjawab pertanyaan seputar hukum dan perundang-undangan di Indonesia. Aplikasi ini menggunakan metode **RAG (Retrieval-Augmented Generation)**, di mana AI tidak menebak jawaban (berhalusinasi), melainkan membaca langsung dari database dokumen hukum resmi (PDF) yang telah dikurasi.

Fokus utama sistem saat ini adalah melakukan kurasi dan pemetaan **Undang-Undang yang menjadi basis kewenangan Aparat Penegak Hukum (APH)** di Indonesia seperti POLRI, Kejaksaan, KPK, hingga PPNS Sektoral.

---

## 🚀 Fitur Utama

- **Pembersihan Teks Hukum Otomatis (Smart Cleaner):** Mengubah dokumen PDF/OCR mentah dari JDIH menjadi teks bersih tanpa merusak struktur pasal, ayat, dan bab.
- **Pemotongan Berbasis Makna (Legal Chunking):** Memotong dokumen secara cerdas per pasal utuh agar konteks hukum tidak terputus saat disimpan ke database.
- **Mesin Pencari Konteks (Semantic Retrieval):** Menemukan pasal dan dasar hukum yang paling relevan berdasarkan makna pertanyaan pengguna, bukan sekadar kesamaan kata kunci.
- **Pemisahan Wewenang APH yang Ketat:** AI dilatih secara khusus untuk membedakan yurisdiksi dan batasan kewenangan antar-lembaga penegak hukum secara presisi guna menghindari tumpang tindih (*overlapping*).
- **Sitasi Sumber Hukum:** Setiap jawaban disertai rujukan eksplisit ke nomor undang-undang, pasal, dan ayat yang menjadi dasar jawaban.

---

## 🏗️ Arsitektur Sistem & Alur Kerja

Aplikasi ini bekerja melalui dua alur utama: **Pipeline Penyerapan Data (Ingestion)** dan **Pipeline Tanya Jawab (Inference)**.

### 1. Pipeline Penyerapan Data (Ingestion)

```
PDF JDIH ──► Ekstraksi Teks/OCR ──► Smart Cleaner ──► Legal Chunker ──► Embedding ──► Vector Database
```

1. **Ekstraksi Teks** — Dokumen PDF hasil unduhan dari JDIH (Jaringan Dokumentasi dan Informasi Hukum) diekstrak menjadi teks mentah. Untuk dokumen hasil pindai (*scan*), digunakan OCR.
2. **Smart Cleaner** — Teks mentah dibersihkan dari artefak PDF (header/footer berulang, nomor halaman, watermark, hasil OCR yang rusak) sambil mempertahankan struktur hierarkis dokumen: BAB → Bagian → Paragraf → Pasal → Ayat.
3. **Legal Chunker** — Dokumen dipotong per pasal utuh (bukan per jumlah token/karakter), sehingga setiap *chunk* menyimpan satu satuan norma yang lengkap beserta metadata-nya: nomor UU, tahun, pasal, ayat, dan lembaga terkait.
4. **Embedding & Indexing** — Setiap *chunk* diubah menjadi vektor numerik menggunakan model *embedding* multilingual, lalu disimpan ke *vector database* bersama metadata-nya.

### 2. Pipeline Tanya Jawab (Inference)

```
Pertanyaan ──► Embedding Query ──► Semantic Search ──► Re-ranking ──► Prompt + Konteks ──► LLM ──► Jawaban + Sitasi
```

1. **Query Understanding** — Pertanyaan pengguna dalam bahasa natural (mis. *"Siapa yang berwenang menyidik tindak pidana korupsi?"*) diubah menjadi vektor.
2. **Semantic Retrieval** — Sistem mencari pasal-pasal paling relevan dari vector database, difilter berdasarkan metadata (mis. jenis tindak pidana, lembaga APH).
3. **Re-ranking** — Kandidat pasal diurutkan ulang untuk memastikan konteks yang diberikan ke LLM benar-benar yang paling tepat.
4. **Generation** — LLM menerima pertanyaan + potongan pasal sebagai konteks, lalu menyusun jawaban dalam bahasa Indonesia yang lugas dengan sitasi pasal/ayat yang jelas.
5. **Guardrail** — Jika konteks yang ditemukan tidak cukup menjawab pertanyaan, sistem diinstruksikan untuk mengatakan "tidak ditemukan dasar hukum" daripada mengarang jawaban.

---

## 🛠️ Teknologi yang Digunakan

- **Bahasa Pemrograman:** Python 3.10+ (dikembangkan pada venv Python 3.12)
- **Ekstraksi PDF:** `pdfplumber` (+ fallback `pypdf`); OCR opsional via Tesseract
- **Kerangka Kerja AI:** `LangChain`, `langchain-community`, `langchain-openai`
- **Model Embedding:**
  - Default lokal (gratis): `all-MiniLM-L6-v2` bawaan ChromaDB (ONNX)
  - Opsional berbayar: `text-embedding-3-small` (OpenAI)
- **Database Vector:** `ChromaDB` (lokal, persist di `./chroma_db`) — Pinecone/pgvector direncanakan
- **Model Bahasa Besar (LLM):**
  - Default lokal (gratis): **Ollama** `qwen2.5:3b-instruct` via API kompatibel OpenAI (`http://localhost:11434/v1`)
  - Opsional berbayar: OpenAI GPT-4o / Claude
- **Catatan versi:** `openai==1.45.0` wajib dipasangkan dengan `httpx==0.27.2` (versi httpx ≥ 0.28 menyebabkan error `proxies` pada klien OpenAI)

---

## 📝 Konfigurasi Prompt Sistem (System Prompts)

Aplikasi ini digerakkan oleh arsitektur Multi-Agent berbasis prompt terstruktur. Seluruh prompt berikut diintegrasikan ke dalam kode backend aplikasi:

### 1. Agen Pengekstrak & Pembersih (`LegalTextCleaner`)
Bertugas menghapus *watermark*, nomor halaman, dan memperbaiki *typo* hasil scan/OCR tanpa mengubah teks undang-undang murni.

### 2. Agen Pemotong Konteks (`LegalChunkingAgent`)
Bertugas memotong dokumen secara sekuensial berdasarkan batasan pasal dan ayat serta menyematkan metadata peraturan.

### 3. Agen Pemeta Wewenang APH (`APH-AuthorityCurator`)
Mengatur otak utama LLM saat berinteraksi dengan pengguna agar secara disiplin merujuk pada UU Organik dan UU Sektoral yang sah.

---

## 📁 Struktur Proyek

```
LexisAI/
├── data/
│   ├── pdf/              # PDF mentah dari JDIH/sumber resmi (input ingestion)
│   ├── processed/        # Teks hasil ekstraksi & pembersihan
│   └── pdf/SUMBER.md     # Manifes provenance setiap dokumen
├── src/
│   ├── config.py         # Konfigurasi env & deteksi backend (OpenAI/Ollama/lokal)
│   ├── cleaner.py        # Smart Cleaner (LLM + fallback regex)
│   ├── chunker.py        # Legal Chunker per pasal/ayat
│   ├── enhancer.py       # Semantic Enhancer (kata kunci + konteks)
│   ├── embedder.py       # Embedding lokal / OpenAI
│   ├── database.py       # Akses ChromaDB
│   └── llm.py            # Factory klien LLM (OpenAI-compatible)
├── prompts/              # System prompts multi-agent
├── chroma_db/            # Vector store persisten (auto-generated)
├── ingest.py             # Pipeline: extract → clean → chunk → enhance → embed
├── main.py               # Tanya jawab RAG (CLI)
├── requirements.txt
├── .env.example
└── README.md
```

---

## 📋 Panduan Memulai (Quick Start)

### 1. Kloning Repositori
```bash
git clone https://github.com/username/lexisai-rag.git
cd lexisai-rag
```

### 2. Instalasi Dependensi
```bash
python -m venv venv
venv/bin/pip install -r requirements.txt
```

### 3. Pengaturan Environment Variables (`.env`)
Salin `.env.example` menjadi `.env`. Untuk mode **sepenuhnya lokal & gratis** (tanpa API key), cukup isi:
```env
OLLAMA_ENABLED=true
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=qwen2.5:3b-instruct
VECTOR_DB_BACKEND=chroma
```
Jika `OPENAI_API_KEY` diisi kunci asli, sistem otomatis memakai OpenAI untuk embedding & generasi.

### 4. Jalankan Pipeline Penyerapan Data
Taruh PDF ke `data/pdf/` dengan konvensi nama `uu-<nomor>-<tahun>_<tentang>.pdf`, lalu:
```bash
venv/bin/python ingest.py --fast   # mode regex/lokal (cepat, tanpa LLM)
venv/bin/python ingest.py          # mode LLM penuh (cleaner+chunker+enhancer via Ollama/OpenAI)
```

### 5. Jalankan Aplikasi Utama
```bash
venv/bin/python main.py "Pertanyaan hukum Anda di sini"
```

---

## 📚 Cakupan Dokumen (Roadmap Kurasi)

### Lapis Formil — Hukum Acara

| Dokumen | Keterangan | Status |
|---|---|---|
| UU 20/2025 (KUHAP baru, berlaku 2 Jan 2026) | Hukum acara pidana utama | ✅ |
| UU 8/1981 (KUHAP lama) | Transisi perkara < 2026 | ✅ |
| UU 1/2023 (KUHP Nasional, berlaku 2 Jan 2026) | Hukum pidana materiil utama | ✅ |
| UU 26/2000 Pengadilan HAM | Acara pelanggaran HAM berat | ✅ |
| UU 31/1997 Peradilan Militer | Acara pidana anggota TNI | ✅ |

### Lapis Organik — Lembaga APH

| Dokumen | Lembaga | Status |
|---|---|---|
| UU 2/2002 jo. UU 5/2026 | Polri (penyidik umum + koordinator PPNS) | ✅ |
| UU 16/2004 jo. UU 11/2021 | Kejaksaan (penuntut umum + penyidik terbatas) | ✅ |
| UU 30/2002 jo. UU 10/2015 jo. UU 19/2019 | KPK | ✅ |
| UU 35/2009 | BNN (penyidik narkotika) | ✅ |
| UU 32/2014 Kelautan | Bakamla (penyidik di laut) | ✅ |
| UU 21/2011 jo. UU 4/2023 P2SK | OJK (penyidik jasa keuangan) | ✅ |

### Lapis Materiil/Sektoral — Kewenangan Khusus

| Dokumen | Penyidik | Status |
|---|---|---|
| UU 31/1999 jo. 20/2001 Tipikor | Polri, Kejaksaan, KPK | ✅ |
| UU 8/2010 TPPU | Penyidik tindak pidana asal | ✅ |
| UU 35/2009 Narkotika | Polri, BNN | ✅ |
| UU 15/2003 jo. 5/2018 Terorisme | Polri (Densus 88) | ✅ |
| UU 26/2000 | Jaksa Agung (HAM berat) | ✅ |
| UU 17/2006 Kepabeanan | PPNS Bea Cukai | ✅ |
| UU 39/2007 Cukai | PPNS Bea Cukai | ✅ |
| UU 6/2011 Keimigrasian | PPNS Imigrasi | ✅ |
| UU 18/2013 P3H | PPNS Kehutanan | ✅ |
| UU 32/2009 Lingkungan Hidup | PPNS LH | ✅ |
| UU 31/2004 jo. 45/2009 Perikanan | PPNS KKP | ✅ |
| UU 7/2017 Pemilu (Gakkumdu) | Polri | ✅ |
| UU 8/1999 Konsumen, 3/2014 Perindustrian, 13/2003 Ketenagakerjaan | PPNS sektoral | ✅ |
| UU 7/2021 HPP, 16/2009 KUP (perpajakan) | PPNS Pajak | ✅ |
| UU ITE 11/2008 jo. 19/2016 jo. 1/2024 | Polri, PPNS Kominfo | ✅ |
| UU 12/2022 TPKS, UU 21/2007 TPPO | Polri | ✅ |
| UU 18/2012 Pangan | PPNS Pangan/BPOM | ✅ |
| UU 36/2009 & 17/2023 Kesehatan | PPNS Kesehatan | ✅ |
| UU 28/2014 Hak Cipta, 20/2016 Merek, 13/2016 Paten | PPNS DJKI | ✅ |
| UU 21/2019 Karantina & 6/2018 Kekarantinaan Kesehatan | PPNS Karantina | ✅ |
| UU 4/2009 jo. 3/2020 Minerba | PPNS Minerba | ✅ |
| UU 7/1992 jo. 10/1998 Perbankan, 8/1995 Pasar Modal | Penyidik OJK | ✅ |

**Total korpus saat ini: 52 undang-undang resmi**, seluruhnya
diverifikasi isi (judul + nomor + teks terekstrak) dari sumber
pemerintah (JDIH BPK, JDIH Kemenkeu, DJP, MK, KPK, JDIH kementerian
terkait). Dokumen yang telah dicabut (mis. UU 6/2018 & UU 36/2009
oleh UU 17/2023) tetap dipertahankan untuk konteks historis/transisi.

---

## 🛣️ Roadmap

- [ ] Integrasi sumber peraturan non-UU (PP, Permen, SE, Perda)
- [ ] Deteksi otomatis status perubahan/pencabutan pasal antar-versi UU
- [ ] Antarmuka web untuk tanya jawab interaktif
- [ ] Ekspor jawaban beserta sitasi ke format dokumen (PDF/DOCX)
- [ ] Evaluasi akurasi retrieval dengan *benchmark* pertanyaan hukum

---

## ⚖️ Penolakan Tanggung Jawab (Disclaimer)

LexisAI adalah alat bantu berbasis kecerdasan buatan yang bertujuan untuk memberikan informasi hukum, edukasi, dan referensi dasar hukum di Indonesia berdasarkan dokumen yang tersedia di database. Aplikasi ini **bukan** penasihat hukum resmi atau advokat. Pengguna sangat disarankan untuk tetap berkonsultasi dengan ahli hukum atau advokat profesional sebelum mengambil tindakan hukum nyata.

---

## 📄 Lisensi

[Lisensi akan ditentukan] — lihat berkas `LICENSE` jika tersedia.
