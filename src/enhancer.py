"""Agen SemanticEnhancer: memperkaya chunk hukum dengan konteks semantik.

Menghasilkan deskripsi konteks (keywords, istilah hukum resmi, ranah hukum)
via LLM untuk ditempelkan pada teks asli sebelum embedding, guna meningkatkan
recall pencarian vector (contextual retrieval).
"""

from src.chunker import LegalChunk
from src.config import load_prompt
from src.llm import get_llm_client, get_llm_model


class SemanticEnhancer:
    def __init__(self):
        self.prompt_template = load_prompt("enhancer_prompt.txt")
        self.client = get_llm_client()

    def generate_context(self, chunk_text: str) -> str:
        """Hasilkan paragraf konteks semantik untuk satu chunk."""
        response = self.client.chat.completions.create(
            model=get_llm_model(),
            messages=[
                {
                    "role": "user",
                    "content": self.prompt_template.format(individual_chunk=chunk_text),
                },
            ],
            temperature=0,
        )
        return response.choices[0].message.content.strip()

    def enhance(self, chunk: LegalChunk) -> str:
        """Kembalikan teks diperkaya: konteks semantik + teks pasal asli."""
        context = self.generate_context(chunk.text)
        return f"{context}\n\n{chunk.text}"

    def enhance_batch(self, chunks: list[LegalChunk]) -> list[str]:
        """Perkaya daftar chunk; kembalikan teks siap embedding."""
        return [self.enhance(c) for c in chunks]
