"""Modul vector embedding dan koneksi ke database vektor.

Jika OPENAI_API_KEY tidak diisi, embedding didelegasikan ke fungsi
embedding bawaan Chroma (model lokal ONNX) agar pipeline tetap
bisa berjalan tanpa API key.
"""

from openai import OpenAI

from src import config
from src.chunker import LegalChunk
from src.database import get_vector_store
from src.enhancer import SemanticEnhancer


class Embedder:
    def __init__(self, enhancer: SemanticEnhancer | None = None):
        self.client = (
            OpenAI(api_key=config.OPENAI_API_KEY) if config.OPENAI_API_KEY else None
        )
        self.model = config.EMBEDDING_MODEL
        self.store = get_vector_store()
        self.enhancer = enhancer

    def embed_texts(self, texts: list[str]) -> list[list[float]] | None:
        """Ubah teks menjadi vektor; None jika pakai embedding bawaan store."""
        if self.client is None:
            return None
        response = self.client.embeddings.create(model=self.model, input=texts)
        return [item.embedding for item in response.data]

    def upsert_chunks(self, chunks: list[LegalChunk]) -> None:
        """Simpan chunk hukum + metadata ke vector database."""
        if not chunks:
            return

        # Jika SemanticEnhancer aktif, embedding memakai teks yang diperkaya
        # konteks; dokumen yang disimpan tetap teks pasal asli.
        texts_to_embed = (
            self.enhancer.enhance_batch(chunks)
            if self.enhancer
            else [c.text for c in chunks]
        )
        embeddings = self.embed_texts(texts_to_embed)

        ids = [
            f"{c.metadata.get('nomor_uu', 'uu')}-{c.metadata.get('tahun_uu', '')}-pasal-{c.pasal}-{i}"
            for i, c in enumerate(chunks)
        ]
        metadatas = [
            {**c.metadata, "enhanced": bool(self.enhancer)} for c in chunks
        ]
        kwargs = dict(
            ids=ids,
            documents=[c.text for c in chunks],
            metadatas=metadatas,
        )
        if embeddings is not None:
            kwargs["embeddings"] = embeddings
        # Tanpa `embeddings`, Chroma menghitung vektor via model lokal bawaan
        self.store.upsert(**kwargs)
