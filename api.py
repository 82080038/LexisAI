"""REST API LexisAI - melayani frontend React.

Jalankan:
    venv/bin/uvicorn api:app --reload --port 8001

Endpoint:
    GET  /api/health    - status backend + jumlah chunk di vector DB
    GET  /api/stats     - statistik koleksi (dokumen, chunk)
    POST /api/ask       - tanya jawab RAG; body: {"question": "..."}
"""

import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel, Field

from main import answer as llm_answer
from src import config
from src.database import get_vector_store
from src.llm import get_llm_client, get_llm_model


# ---------------------------------------------------------------------------
# Retrieval dengan sitasi terstruktur
# ---------------------------------------------------------------------------

def retrieve(query: str, store, top_k: int = 5) -> tuple[str, list[dict[str, Any]]]:
    """Ambil pasal relevan; kembalikan (konteks_teks, daftar_sumber)."""
    if config.OPENAI_API_KEY:
        client = OpenAI(api_key=config.OPENAI_API_KEY)
        emb = client.embeddings.create(
            model=config.EMBEDDING_MODEL, input=[query]
        )
        results = store.query(
            query_embeddings=[emb.data[0].embedding], n_results=top_k
        )
    else:
        results = store.query(query_texts=[query], n_results=top_k)

    docs = results.get("documents", [[]])[0]
    metas = results.get("metadatas", [[]])[0]
    dists = results.get("distances", [[]])[0]

    sources, blocks = [], []
    for doc, meta, dist in zip(docs, metas, dists):
        sumber = (
            f"UU No. {meta.get('nomor_uu', '?')} "
            f"Tahun {meta.get('tahun_uu', '?')}, Pasal {meta.get('pasal', '?')}"
        )
        sources.append(
            {
                "citation": sumber,
                "nomor_uu": meta.get("nomor_uu"),
                "tahun_uu": meta.get("tahun_uu"),
                "pasal": meta.get("pasal"),
                "tentang": meta.get("tentang"),
                "text": doc,
                "distance": dist,
            }
        )
        blocks.append(f"[{sumber}]\n{doc}")
    return "\n\n---\n\n".join(blocks), sources


# ---------------------------------------------------------------------------
# Skema request/response
# ---------------------------------------------------------------------------

class AskRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=4000)
    top_k: int = Field(5, ge=1, le=20)


class Source(BaseModel):
    citation: str
    nomor_uu: str | None = None
    tahun_uu: str | None = None
    pasal: str | None = None
    tentang: str | None = None
    text: str
    distance: float | None = None


class AskResponse(BaseModel):
    answer: str
    sources: list[Source]
    llm_backend: str
    elapsed_ms: int


# ---------------------------------------------------------------------------
# Aplikasi
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Inisialisasi sekali di startup, dipakai ulang tiap request
    app.state.store = get_vector_store()
    app.state.llm = get_llm_client()
    yield


app = FastAPI(title="LexisAI API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    backend = (
        "openai"
        if config.OPENAI_API_KEY
        else ("ollama" if config.OLLAMA_ENABLED else "none")
    )
    return {
        "status": "ok",
        "llm_backend": backend,
        "chunks": app.state.store.count(),
    }


@app.get("/api/stats")
def stats():
    import collections

    res = app.state.store.get(include=["metadatas"])
    per_uu = collections.Counter(
        f"UU {m.get('nomor_uu')}/{m.get('tahun_uu')}" for m in res["metadatas"]
    )
    return {
        "total_chunks": len(res["metadatas"]),
        "total_documents": len(per_uu),
        "top_documents": per_uu.most_common(10),
    }


@app.post("/api/ask", response_model=AskResponse)
def ask(req: AskRequest):
    t0 = time.time()
    context, sources = retrieve(req.question, app.state.store, top_k=req.top_k)
    if not context.strip():
        raise HTTPException(404, "Tidak ditemukan pasal relevan di database.")

    client = app.state.llm
    if client is None:
        # Mode retrieval-only: kembalikan konteks mentah sebagai "jawaban"
        jawaban = (
            "[MODE LOKAL - tanpa backend LLM]\n"
            "Berikut pasal paling relevan:\n\n" + context
        )
        backend = "retrieval-only"
    else:
        try:
            jawaban = llm_answer(req.question, context, client)
        except Exception as e:
            raise HTTPException(502, f"LLM backend gagal: {e}") from e
        backend = get_llm_model()

    return AskResponse(
        answer=jawaban,
        sources=sources,
        llm_backend=backend,
        elapsed_ms=int((time.time() - t0) * 1000),
    )
