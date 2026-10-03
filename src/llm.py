"""Factory client LLM terpusat.

Prioritas backend:
1. OpenAI (jika OPENAI_API_KEY diisi di .env)
2. Ollama lokal (fallback gratis; api.openai-compatible di /v1)

Semua agen memanggil get_llm_client() agar konsisten.
"""

from openai import OpenAI

from src import config


def get_llm_client() -> OpenAI | None:
    """Kembalikan client kompatibel-OpenAI, atau None jika tidak ada backend."""
    if config.OPENAI_API_KEY:
        return OpenAI(api_key=config.OPENAI_API_KEY)
    if config.OLLAMA_ENABLED:
        return OpenAI(base_url=config.OLLAMA_BASE_URL, api_key="ollama")
    return None


def get_llm_model() -> str:
    """Nama model sesuai backend yang aktif."""
    if config.OPENAI_API_KEY:
        return config.LLM_MODEL
    return config.OLLAMA_MODEL
