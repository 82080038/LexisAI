"""`inti` pasal via EKSTRAKSI deterministik — bukan LLM.

Tujuan UX-nya hanya teks inti yang terbaca di kartu sumber; kalimat kunci
verbatim dari pasal itu sendiri lebih akurat (nol halusinasi) dan gratis.
Mengisi SEMUA node yang belum punya entri LLM di file output — hasil
generasi LLM yang sudah ada dipertahankan sebagai polish.

Strategi per node (kumpulan ayat satu pasal):
  1. Skor tiap unit ayat: marker normatif berbobot (dipidana/denda/
     dilarang/wajib/berhak/kewajiban) — sanksi adalah yang paling dicari.
  2. Ambil unit skor tertinggi; fallback ayat pertama bila tak ada marker.
  3. Potong rapi ke <=~280 karakter di batas kata.

Output: merge ke frontend/public/data/penjelasan.json (+ tiap shard
penjelasan.s<i>.json bila ada, agar job LLM resume tidak menimpa).

Pakai: venv/bin/python scripts/gen_inti_extractive.py
"""

import json
import re
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "frontend" / "public" / "data"
MAIN = DATA_DIR / "penjelasan.json"
SHARDS = sorted(DATA_DIR.glob("penjelasan.s*.json"))
MAX_LEN = 280

# marker normatif -> bobot; sanksi/ancaman dinilai paling informatif
MARKERS = [
    (re.compile(r"\bdipidana\b", re.I), 10),
    (re.compile(r"\bdenda\b", re.I), 8),
    (re.compile(r"\bdilarang\b", re.I), 7),
    (re.compile(r"\bwajib\b", re.I), 6),
    (re.compile(r"\bdikenakan\b", re.I), 5),
    (re.compile(r"\bberhak\b", re.I), 4),
    (re.compile(r"\bkewajiban\b", re.I), 3),
    (re.compile(r"\bhak\b", re.I), 1),
]


def potong(s):
    s = " ".join(s.split())
    if len(s) <= MAX_LEN:
        return s
    return s[: MAX_LEN].rsplit(" ", 1)[0].rstrip(",;:(") + "…"


def inti_ekstraktif(parts):
    """Pilih ayat paling informatif dari satu pasal."""
    best, best_score = parts[0], -1
    for i, p in enumerate(parts):
        score = sum(w for _, w in
                    ((re.search(pat, p), w) for pat, w in MARKERS) if _)
        score -= i * 0.1  # tie-break: ayat lebih awal didahulukan
        if score > best_score:
            best, best_score = p, score
    return potong(best)


def main():
    # kumpulkan pasal per node (sama seperti gen_penjelasan.collect_pasal)
    nodes = {}
    for f in sorted(DATA_DIR.glob("uu-*.json")):
        d = json.loads(f.read_text())
        for c in d["chunks"]:
            if "PENJELASAN" in (c.get("bab") or "").upper():
                continue
            node = f"uu-{d['nomor_uu']}-{d['tahun_uu']}#{c['pasal']}"
            ayat = f"({c['ayat']}) {c['text']}" if c.get("ayat") else c["text"]
            nodes.setdefault(node, []).append(ayat)

    # entri yang sudah ada (LLM) dipertahankan
    done = {}
    for p in [MAIN, *SHARDS]:
        if p.exists():
            done.update(json.loads(p.read_text()))

    baru, total = {}, 0
    for node, parts in nodes.items():
        total += 1
        if node not in done:
            baru[node] = inti_ekstraktif(parts)

    merged = {**done, **baru}
    MAIN.write_text(json.dumps(merged, ensure_ascii=False, indent=0))
    print(f"{total} pasal | {len(done)} LLM dipertahankan | "
          f"{len(baru)} inti ekstraktif baru -> {MAIN.name}")


if __name__ == "__main__":
    main()
