"""Bangun graf rujukan peraturan dari indeks statis -> data/graph.json.

Bukan GNN: graf sitasi eksplisit diekstrak dari teks pasal. Dua jenis edge:
  internal  pasal -> pasal lain di UU yang sama ("sebagaimana dimaksud dalam Pasal 9")
  lintas    pasal -> pasal/dokumen UU lain ("Undang-Undang Nomor 31 Tahun 1999")

Node  : "<doc-key>#<pasal>"  (sub-chunk ayat digabung ke level pasal)
Edge  : {from, to, kind}     kind = "internal" | "lintas"

Regenerasi setiap ingest selesai: file kecil, struktur mengikuti database.
Jalankan SETELAH export_index.py:
  venv/bin/python scripts/export_index.py && venv/bin/python scripts/build_graph.py
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "frontend" / "public" / "data"
OUT_FILE = DATA_DIR / "graph.json"

# "Pasal 9" / "Pasal 9 ayat (1)" — rujukan internal (tanpa nama UU eksplisit)
PASAL_REF = re.compile(r"\bPasal\s+(\d+[A-Za-z]?)\b")

# "Undang-Undang Nomor 31 Tahun 1999" (+ varian "UU No. 31 Tahun 1999")
UU_REF = re.compile(
    r"(?:Undang-Undang|UU)\s+(?:Republik\s+Indonesia\s+)?"
    r"(?:Nomor|No\.?)\s+(\d+[A-Za-z]?)\s+Tahun\s+(\d{4})"
)

# Jendela teks di sekitar sitasi UU untuk menangkap "Pasal X" target (bila ada)
WINDOW = 120


def load_docs() -> tuple[dict, set]:
    """Baca uu-*.json dari data dir -> {key: payload}, set key yang valid."""
    docs = {}
    for f in sorted(DATA_DIR.glob("uu-*.json")):
        payload = json.loads(f.read_text(encoding="utf-8"))
        key = f.stem
        docs[key] = payload
    return docs, set(docs)


def pasal_nodes(payload: dict) -> dict:
    """Gabung sub-chunk ayat: {pasal_no: text_gabungan}."""
    by_pasal: dict[str, list[str]] = {}
    for c in payload["chunks"]:
        by_pasal.setdefault(str(c.get("pasal", "")), []).append(c["text"])
    return {p: "\n".join(texts) for p, texts in by_pasal.items() if p}


def main() -> None:
    docs, valid_keys = load_docs()
    if not docs:
        raise RuntimeError(f"Tidak ada uu-*.json di {DATA_DIR} — jalankan export_index.py dulu")

    edges: set[tuple[str, str, str]] = set()
    nodes: set[str] = set()

    for key, payload in docs.items():
        for pasal_no, text in pasal_nodes(payload).items():
            src = f"{key}#{pasal_no}"
            nodes.add(src)

            # Rujukan lintas-UU: sitasi "UU Nomor N Tahun T" + Pasal terdekat
            for m in UU_REF.finditer(text):
                nomor, tahun = m.group(1), m.group(2)
                tgt_key = f"uu-{nomor}-{tahun}"
                if tgt_key not in valid_keys or tgt_key == key:
                    continue
                # cari "Pasal X" dalam jendela sekitar sitasi
                window = text[max(0, m.start() - WINDOW):m.end() + WINDOW]
                pm = PASAL_REF.search(window)
                tgt = f"{tgt_key}#{pm.group(1)}" if pm else tgt_key
                edges.add((src, tgt, "lintas"))
                nodes.add(tgt)

            # Rujukan internal: semua "Pasal X" di luar konteks sitasi UU
            # (aproksimasi: rujukan eksplisit ke pasal lain dalam dok ini)
            for m in PASAL_REF.finditer(text):
                target_pasal = m.group(1)
                if target_pasal == pasal_no:
                    continue  # self-loop
                # skip bila "Pasal X" ini bagian dari sitasi UU lain
                ctx_start = max(0, m.start() - WINDOW)
                if UU_REF.search(text[ctx_start:m.start()]):
                    continue
                edges.add((src, f"{key}#{target_pasal}", "internal"))
                nodes.add(f"{key}#{target_pasal}")

    payload_out = {
        "version": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "docs": {
            k: {"nomor_uu": d["nomor_uu"], "tahun_uu": d["tahun_uu"],
                "tentang": d.get("tentang", "")}
            for k, d in docs.items()
        },
        "nodes": sorted(nodes),
        "edges": [
            {"from": f, "to": t, "kind": k} for f, t, k in sorted(edges)
        ],
    }
    raw = json.dumps(payload_out, ensure_ascii=False, separators=(",", ":"))
    OUT_FILE.write_text(raw, encoding="utf-8")

    n_int = sum(1 for e in edges if e[2] == "internal")
    n_cross = sum(1 for e in edges if e[2] == "lintas")
    print(
        f"graph.json: {len(nodes)} node, {len(edges)} edge "
        f"(internal={n_int}, lintas={n_cross}), {len(raw)/1024:.0f} KB"
    )


if __name__ == "__main__":
    main()
