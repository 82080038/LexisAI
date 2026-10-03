"""Manajemen inisialisasi vector database (Chroma / Pinecone / pgvector)."""

from src import config


def get_vector_store():
    """Kembalikan client vector store sesuai VECTOR_DB_BACKEND."""
    backend = config.VECTOR_DB_BACKEND.lower()

    if backend == "chroma":
        import chromadb

        client = chromadb.PersistentClient(path=config.CHROMA_PERSIST_DIR)
        return client.get_or_create_collection(config.COLLECTION_NAME)

    if backend == "pinecone":
        # TODO: inisialisasi Pinecone index
        raise NotImplementedError("Backend Pinecone belum diimplementasikan")

    if backend == "pgvector":
        # TODO: inisialisasi koneksi PostgreSQL + pgvector
        raise NotImplementedError("Backend pgvector belum diimplementasikan")

    raise ValueError(f"VECTOR_DB_BACKEND tidak dikenal: {backend}")
