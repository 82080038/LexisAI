"""Aplikasi utama LexisAI: tanya jawab hukum berbasis RAG.

Backend LLM otomatis: OpenAI jika OPENAI_API_KEY diisi, else Ollama lokal.
Embedding: OpenAI jika key ada, else model lokal bawaan Chroma.
"""

from openai import OpenAI

from src import config
from src.database import get_vector_store
from src.llm import get_llm_client, get_llm_model


def retrieve_context(query: str, store, top_k: int = 5) -> str:
    """Cari pasal paling relevan dari vector database.

    Menggunakan query_texts agar embedding query dihitung oleh fungsi
    embedding koleksi (sama seperti saat upsert tanpa embeddings eksplisit).
    Catatan: jika dokumen di-ingest dengan embedding OpenAI eksplisit,
    query juga harus memakai embedding OpenAI — lihat Embedder.
    """
    if config.OPENAI_API_KEY:
        client = OpenAI(api_key=config.OPENAI_API_KEY)
        emb = client.embeddings.create(model=config.EMBEDDING_MODEL, input=[query])
        results = store.query(query_embeddings=[emb.data[0].embedding], n_results=top_k)
    else:
        results = store.query(query_texts=[query], n_results=top_k)

    docs = results.get("documents", [[]])[0]
    metas = results.get("metadatas", [[]])[0]
    blocks = []
    for doc, meta in zip(docs, metas):
        sumber = f"UU No. {meta.get('nomor_uu', '?')} Tahun {meta.get('tahun_uu', '?')}, Pasal {meta.get('pasal', '?')}"
        blocks.append(f"[{sumber}]\n{doc}")
    # TODO: tambahkan re-ranking kandidat pasal
    return "\n\n---\n\n".join(blocks)


def answer(query: str, context: str, client: OpenAI) -> str:
    """Hasilkan jawaban berdasarkan konteks pasal via LLM."""
    system_prompt = config.load_prompt("lexis_prompt.txt")
    qa_template = config.load_prompt("qa_prompt.txt")
    response = client.chat.completions.create(
        model=get_llm_model(),
        messages=[
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": qa_template.format(context=context, question=query),
            },
        ],
        temperature=0.1,
    )
    return response.choices[0].message.content


def main():
    client = get_llm_client()
    store = get_vector_store()

    backend = "OpenAI" if config.OPENAI_API_KEY else f"Ollama ({config.OLLAMA_MODEL})"
    if client is None:
        print("[MODE LOKAL] Tidak ada backend LLM - hanya retrieval konteks.")
    else:
        print(f"Backend LLM: {backend}")
    print("LexisAI - Asisten Hukum Indonesia (ketik 'exit' untuk keluar)")
    while True:
        query = input("\nPertanyaan> ").strip()
        if query.lower() in {"exit", "quit", ""}:
            break
        context = retrieve_context(query, store)
        if client is None:
            print("\n--- Konteks terambil ---\n" + context)
        else:
            print("\n" + answer(query, context, client))


if __name__ == "__main__":
    main()
