# AGENTS.md — LexisAI

## Perintah utama

```bash
venv/bin/python ingest.py --fast   # ingestion regex+embedding lokal (tanpa LLM)
venv/bin/python ingest.py          # ingestion penuh via Ollama/OpenAI
venv/bin/python main.py "pertanyaan"  # QA RAG dari chroma_db
venv/bin/python scripts/export_index.py   # chroma_db -> frontend/public/data/*.json
venv/bin/python scripts/build_graph.py    # graf rujukan -> frontend/public/data/graph.json
```

## Konvensi file & korpus

- PDF korpus di `data/pdf/` dengan nama `uu-<nomor>-<tahun>_<tentang>.pdf`
  (diparse jadi metadata `nomor_uu`, `tahun_uu`, `tentang`).
- `data/pdf/SUMBER.md` — manifes provenance tiap dokumen (52 UU, diverifikasi isi).
- Saat menambah PDF: WAJIB verifikasi teks halaman awal memuat
  `UNDANG-UNDANG REPUBLIK INDONESIA NOMOR <n> TAHUN <t>` yang cocok
  dengan nama file — PDF valid belum tentu dokumen benar.

## Jebakan yang sudah diketahui

- `openai==1.45.0` butuh `httpx==0.27.2` (httpx ≥0.28 → error `proxies`).
- ChromaDB telemetry warning `capture() takes 1 positional argument` — aman diabaikan.
- peraturan.bpk.go.id: ID `/Download/<file_id>/` ≠ ID `/Details/<record_id>/`.
  Ekstrak link unduhan dari bagian "FILE-FILE PERATURAN" halaman Details.
- Beberapa host menolak curl polos: pakai `-A "Mozilla/5.0"` (mkri.id),
  atau diganti sumber (ojk.go.id & dgip.go.id di balik WAF;
  jdih.kemenkoinfra.go.id kadang timeout — retry nanti).
- Jangan `cd` lalu jalankan download paralel background — selalu pakai
  path output absolut ke `data/pdf/`.
- Embedding query HARUS konsisten dengan embedding ingestion (keduanya
  lokal Chroma `all-MiniLM-L6-v2` saat tanpa OpenAI key).
- Koleksi Chroma perlu di-reset bila skema chunk-ID/metadata berubah,
  agar tidak terjadi duplikasi vektor.
