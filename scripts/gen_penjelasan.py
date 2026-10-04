"""Generate `penjelasan` (ringkasan bahasa awam) per pasal via Ollama lokal.

Pola CanLII: LLM dipakai SEKALI saat build — user runtime hanya membaca
field teks. Output: frontend/public/data/penjelasan.json berupa peta
node "uu-<nomor>-<tahun>#<pasal>" -> string penjelasan.

- Resumable: node yang sudah ada di output dilewati — aman di-restart.
- Paralel: ThreadPoolExecutor (default 2 worker; VRAM 4GB cukup untuk
  2 request qwen2.5:3b konkuren). Tambah worker via --workers.
- Pasal dari bagian PENJELASAN dilewati (meta-komentar, bukan norma).

Pakai: venv/bin/python scripts/gen_penjelasan.py [--workers 2]
"""

import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "frontend" / "public" / "data"
OLLAMA_PORT = 11434
MODEL = "qwen2.5:3b-instruct"
MAX_PASAL_CHARS = 2500  # potong pasal super-panjang agar prefill cepat

PROMPT = """Tulis penjelasan 1-2 kalimat dalam Bahasa Indonesia awam untuk pasal \
undang-undang berikut. Fokus pada inti aturan dan sanksi/larangan/kewajiban \
utamanya. Jangan mengutip mentah, jangan menambah opini, jangan pakai pengantar.

UU No. {nomor} Tahun {tahun} ({tentang})
Pasal {pasal}:
{text}

PENJELASAN:"""


def collect_pasal():
    """Kumpulkan teks per node pasal dari file ekspor uu-*.json."""
    nodes = {}  # node -> {nomor, tahun, tentang, pasal, text}
    for f in sorted(DATA_DIR.glob("uu-*.json")):
        d = json.loads(f.read_text())
        for c in d["chunks"]:
            bab = (c.get("bab") or "").upper()
            if "PENJELASAN" in bab:
                continue
            node = f"uu-{d['nomor_uu']}-{d['tahun_uu']}#{c['pasal']}"
            if node not in nodes:
                nodes[node] = {
                    "nomor": d["nomor_uu"],
                    "tahun": d["tahun_uu"],
                    "tentang": d["tentang"],
                    "pasal": c["pasal"],
                    "parts": [],
                }
            ayat = f"({c['ayat']}) {c['text']}" if c.get("ayat") else c["text"]
            nodes[node]["parts"].append(ayat)
    for n in nodes.values():
        n["text"] = " ".join(n.pop("parts"))[:MAX_PASAL_CHARS]
    return nodes


def gen_one(node, meta, port):
    prompt = PROMPT.format(
        nomor=meta["nomor"], tahun=meta["tahun"],
        tentang=meta["tentang"], pasal=meta["pasal"], text=meta["text"],
    )
    body = json.dumps({
        "model": MODEL, "prompt": prompt, "stream": False,
        "options": {"temperature": 0.2, "num_predict": 160},
    }).encode()
    req = urllib.request.Request(
        f"http://localhost:{port}/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    resp = json.load(urllib.request.urlopen(req, timeout=300))
    text = resp["response"].strip()
    # buang pengantar tak diinginkan & batasi panjang
    if text.lower().startswith("penjelasan"):
        text = text.split(":", 1)[-1].strip()
    return node, text[:600]


def argval(flag, default=None):
    return (
        sys.argv[sys.argv.index(flag) + 1]
        if flag in sys.argv
        else default
    )


def main():
    workers = int(argval("--workers", 2))
    port = int(argval("--port", OLLAMA_PORT))
    # --shard i/n: hanya proses node dengan hash % n == i — dua GPU bisa
    # bekerja paralel tanpa saling menimpa (output per-shard).
    shard = argval("--shard")
    si, sn = (int(x) for x in shard.split("/")) if shard else (0, 1)
    out = DATA_DIR / (f"penjelasan.s{si}.json" if sn > 1 else "penjelasan.json")

    nodes = collect_pasal()
    if sn > 1:
        nodes = {k: v for k, v in nodes.items() if hash(k) % sn == si}
    done = json.loads(out.read_text()) if out.exists() else {}
    todo = {k: v for k, v in nodes.items() if k not in done}
    print(f"shard {si}/{sn} :{port} | {len(nodes)} pasal | "
          f"{len(done)} selesai | {len(todo)} tersisa | {workers} worker",
          flush=True)
    if not todo:
        return

    failed, completed = [], 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(gen_one, k, v, port): k for k, v in todo.items()}
        for fut in as_completed(futs):
            node = futs[fut]
            try:
                node, text = fut.result()
                if len(text) < 15:
                    raise ValueError(f"output terlalu pendek: {text!r}")
                done[node] = text
            except Exception as e:  # satu pasal gagal tak menghentikan batch
                failed.append((node, str(e)[:120]))
            completed += 1
            if completed % 50 == 0 or completed == len(todo):
                rate = completed / (time.time() - t0)
                eta = (len(todo) - completed) / max(rate, 0.01)
                out.write_text(json.dumps(done, ensure_ascii=False, indent=0))
                print(f"{completed}/{len(todo)} | {rate:.2f}/dtk | "
                      f"ETA {eta/60:.0f}mnt | gagal {len(failed)}", flush=True)

    out.write_text(json.dumps(done, ensure_ascii=False, indent=0))
    print(f"SELESAI: {len(done)} penjelasan | {len(failed)} gagal", flush=True)
    for n, e in failed[:10]:
        print(f"  GAGAL {n}: {e}")


if __name__ == "__main__":
    main()
