"""Memuat variabel lingkungan (.env) dan konfigurasi database."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_PDF_DIR = BASE_DIR / "data" / "pdf"
DATA_PROCESSED_DIR = BASE_DIR / "data" / "processed"
PROMPTS_DIR = BASE_DIR / "prompts"

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY or "your_" in OPENAI_API_KEY:
    OPENAI_API_KEY = None  # placeholder .env -> mode lokal tanpa OpenAI
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o")

# LLM lokal via Ollama (fallback gratis saat OPENAI_API_KEY kosong)
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b-instruct")
OLLAMA_ENABLED = os.getenv("OLLAMA_ENABLED", "true").lower() == "true"

VECTOR_DB_BACKEND = os.getenv("VECTOR_DB_BACKEND", "chroma")  # chroma | pinecone | pgvector
VECTOR_DB_URL = os.getenv("VECTOR_DB_URL", "")
CHROMA_PERSIST_DIR = os.getenv("CHROMA_PERSIST_DIR", str(BASE_DIR / "chroma_db"))
COLLECTION_NAME = os.getenv("COLLECTION_NAME", "lexisai_legal")


def load_prompt(name: str) -> str:
    """Memuat file prompt dari direktori prompts/."""
    return (PROMPTS_DIR / name).read_text(encoding="utf-8")
