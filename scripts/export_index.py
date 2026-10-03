"""Export chroma_db -> file statis per-UU untuk FE PWA (client-side retrieval).

Output di frontend/public/data/:
  manifest.json        - {version, dim, docs:[{key,file,chunks,bytes,sha256}]}
  uu-<n>-<t>.json      - {nomor_uu,tahun_uu,tentang,chunks:[{id,pasal,ayat,text}],
                         vec_scale, vec_b64}  (vektor int8 kuantisasi, base64)

Vektor di-kuantisasi per-dokumen: q = round(v / scale), scale = max|v|/127.
De-kuantisasi di browser: v ~= q * scale. Cosine similarity tetap valid
(skala seragam tidak mengubah peringkat setelah normalisasi).

Jalankan:  venv/bin/python scripts/export_index.py
"""

import base64
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import config  # noqa: E402
from src.database import get_vector_store  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent.parent / "frontend" / "public" / "data"


def quantize_int8(vectors: np.ndarray) -> tuple[str, float]:
    """Kuantisasi float32 -> int8 simetris per-dokumen; kembalikan (b64, scale)."""
    scale = float(np.abs(vectors).max()) / 127.0
    if scale == 0:
        scale = 1.0
    q = np.clip(np.round(vectors / scale), -127, 127).astype(np.int8)
    return base64.b64encode(q.tobytes()).decode("ascii"), scale


def main() -> None:
    store = get_vector_store()
    res = store.get(include=["embeddings", "documents", "metadatas"])
    ids, docs, metas = res["ids"], res["documents"], res["metadatas"]
    embs = np.asarray(res["embeddings"], dtype=np.float32)
    if embs.ndim != 2:
        raise RuntimeError("Tidak ada embedding tersimpan di koleksi")
    dim = int(embs.shape[1])
    print(f"Koleksi: {len(ids)} chunk, dim={dim}")

    # Kelompokkan per (nomor_uu, tahun_uu), urut stabil by index suffix chunk
    groups: dict[tuple[str, str], list[int]] = {}
    for i, m in enumerate(metas):
        key = (str(m.get("nomor_uu", "")), str(m.get("tahun_uu", "")))
        groups.setdefault(key, []).append(i)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # Bersihkan file lama agar tidak tertinggal yatim
    for f in OUT_DIR.glob("uu-*.json"):
        f.unlink()

    manifest_docs = []
    for (nomor, tahun), idx in sorted(
        groups.items(), key=lambda kv: (kv[0][1], kv[0][0])
    ):
        idx.sort(key=lambda i: int(ids[i].rsplit("-", 1)[-1]))
        chunks = [
            {
                "id": ids[i],
                "pasal": str(metas[i].get("pasal", "")),
                "ayat": metas[i].get("ayat"),
                "bab": metas[i].get("bab"),
                "text": docs[i],
            }
            for i in idx
        ]
        vec_b64, scale = quantize_int8(embs[idx])
        tentang = metas[idx[0]].get("tentang", "")

        payload = {
            "nomor_uu": nomor,
            "tahun_uu": tahun,
            "tentang": tentang,
            "vec_scale": scale,
            "vec_b64": vec_b64,
            "chunks": chunks,
        }
        key = f"uu-{nomor}-{tahun}"
        fname = f"{key}.json"
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        (OUT_DIR / fname).write_bytes(raw)
        manifest_docs.append(
            {
                "key": key,
                "file": fname,
                "chunks": len(chunks),
                "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
        )
        print(f"  {fname}: {len(chunks)} chunk, {len(raw)/1024:.0f} KB")

    manifest = {
        "version": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dim": dim,
        "model": "Xenova/all-MiniLM-L6-v2",
        "docs": manifest_docs,
    }
    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    total_mb = sum(d["bytes"] for d in manifest_docs) / 1e6
    print(
        f"Selesai: {len(manifest_docs)} dokumen, "
        f"{sum(d['chunks'] for d in manifest_docs)} chunk, total {total_mb:.1f} MB"
    )


if __name__ == "__main__":
    main()
