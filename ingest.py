"""Pipeline penyerapan data (ingestion) - berjalan sekuensial.

Alur:
  Langkah 1: Baca PDF -> LegalTextCleaner (Prompt 1) membersihkan teks.
  Langkah 2: Teks bersih -> LegalChunkingAgent (Prompt 2) memotong per pasal.
  Langkah 3: Setiap chunk -> SemanticEnhancer (Prompt 3) memperkaya makna.
  Langkah 4: Teks diperkaya -> Embedding -> Vector Database (Chroma/Pinecone).

Gunakan --fast untuk jalur regex tanpa LLM (cepat, tanpa biaya token).
"""

import argparse
import re
import sys
from pathlib import Path

import pdfplumber

from src import config
from src.cleaner import LegalTextCleaner
from src.chunker import LegalChunkingAgent
from src.embedder import Embedder
from src.enhancer import SemanticEnhancer


def extract_text(pdf_path: Path) -> str:
    """Langkah 1a: Ekstrak teks mentah dari PDF (fallback OCR untuk scan)."""
    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            pages.append(page.extract_text() or "")
    text = "\n".join(pages)

    # TODO: jika teks kosong/terlalu sedikit (PDF hasil scan), jalankan
    # Tesseract OCR per halaman di sini.
    return text


def parse_uu_metadata(pdf_path: Path) -> dict:
    """Parse metadata dari nama file: uu-<nomor>-<tahun>_<tentang>.pdf

    Contoh: uu-19-2019_perubahan-uu-kpk.pdf
    -> nomor_uu=19, tahun_uu=2019, tentang='perubahan uu kpk'
    """
    m = re.match(r"uu-(\d+[A-Za-z]?)-(\d{4})_(.+)", pdf_path.stem, re.IGNORECASE)
    if m:
        return {
            "nomor_uu": m.group(1),
            "tahun_uu": m.group(2),
            "tentang": m.group(3).replace("-", " ").replace("_", " "),
        }
    return {"nomor_uu": "", "tahun_uu": "", "tentang": pdf_path.stem}


def ingest_file(pdf_path: Path, cleaner, chunker, embedder) -> int:
    # Langkah 1: ekstraksi + pembersihan
    raw = extract_text(pdf_path)
    if not raw.strip():
        print(f"[SKIP] Tidak ada teks terekstrak: {pdf_path.name}")
        return 0
    clean = cleaner.clean(raw)

    # Langkah 2: pemotongan per pasal (metadata UU dari nama file)
    meta = parse_uu_metadata(pdf_path)
    chunks = chunker.chunk(clean, **meta)

    # Langkah 3 & 4: enrichment + embedding + simpan ke vector DB
    # (enhancer dipanggil di dalam embedder.upsert_chunks jika aktif)
    embedder.upsert_chunks(chunks)

    print(f"[OK] {pdf_path.name}: {len(chunks)} chunk disimpan")
    return len(chunks)


def main():
    parser = argparse.ArgumentParser(description="LexisAI ingestion pipeline")
    parser.add_argument(
        "--fast",
        action="store_true",
        help="Jalur cepat: regex cleaner/chunker tanpa LLM dan tanpa enhancer",
    )
    parser.add_argument(
        "--no-enhance",
        action="store_true",
        help="Lewati SemanticEnhancer (Prompt 3) pada mode LLM",
    )
    args = parser.parse_args()

    pdf_dir = config.DATA_PDF_DIR
    pdfs = sorted(pdf_dir.glob("*.pdf"))
    if not pdfs:
        print(f"Tidak ada PDF di {pdf_dir}")
        sys.exit(0)

    use_llm = not args.fast
    cleaner = LegalTextCleaner(use_llm=use_llm)
    chunker = LegalChunkingAgent(use_llm=use_llm)
    enhancer = SemanticEnhancer() if use_llm and not args.no_enhance else None
    embedder = Embedder(enhancer=enhancer)

    mode = "regex" if args.fast else ("llm" if enhancer else "llm (tanpa enhancer)")
    print(f"Mode: {mode} | Dokumen: {len(pdfs)}")

    total = sum(ingest_file(p, cleaner, chunker, embedder) for p in pdfs)
    print(f"Selesai. Total {total} chunk dari {len(pdfs)} dokumen.")


if __name__ == "__main__":
    main()
