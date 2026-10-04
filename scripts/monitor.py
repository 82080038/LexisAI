"""Dashboard monitoring generasi penjelasan — stdlib saja.

Jalankan: python3 scripts/monitor.py  ->  http://localhost:8899
Auto-refresh tiap 15 detik. Menampilkan progress per-shard, statistik
GPU (nvidia-smi), dan sampel penjelasan terbaru.
"""

import html
import json
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "frontend" / "public" / "data"
LOGS = [("/tmp/gen-s0.log", "shard 0 · GPU-1 :11434"),
        ("/tmp/gen-s1.log", "shard 1 · GPU-0 :11435")]
SHARDS = [DATA / "penjelasan.s0.json", DATA / "penjelasan.s1.json"]
PORT = 8899
TOTAL = 6584


def gpu_stats():
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5).stdout.strip()
        rows = []
        for line in out.splitlines():
            i, name, util, mem, tot, temp, pw = [x.strip() for x in line.split(",")]
            rows.append((i, name, util, mem, tot, temp, pw))
        return rows
    except Exception as e:
        return [("?", "nvidia-smi error", "-", "-", "-", "-", str(e)[:40])]


def read_shard(p):
    try:
        return json.loads(p.read_text())
    except Exception:
        return {}


def page():
    shards = [read_shard(p) for p in SHARDS]
    done = sum(len(s) for s in shards)
    pct = done / TOTAL * 100

    log_html = ""
    for path, label in LOGS:
        try:
            lines = Path(path).read_text().strip().splitlines()[-4:]
        except Exception:
            lines = ["(log belum ada)"]
        log_html += (f"<h3>{html.escape(label)}</h3><pre>"
                     + html.escape("\n".join(lines)) + "</pre>")

    gpu_rows = "".join(
        f"<tr><td>{i}</td><td>{html.escape(n)}</td><td class=num>{u}%</td>"
        f"<td class=num>{m}/{t} MiB</td><td class=num>{tp}°C</td><td class=num>{pw}W</td></tr>"
        for i, n, u, m, t, tp, pw in gpu_stats())

    samples = ""
    for si, s in enumerate(shards):
        items = list(s.items())[-4:]
        samples += f"<h3>shard {si} — sampel terbaru</h3>"
        for node, txt in reversed(items):
            samples += (f"<div class=card><b>{html.escape(node)}</b>"
                        f"<p>{html.escape(txt)}</p></div>")

    return f"""<!doctype html><html lang=id><head><meta charset=utf-8>
<meta http-equiv=refresh content=15>
<title>LexisAI — Monitor Generasi</title>
<style>
body{{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;
margin:0;padding:24px;max-width:900px;margin:auto}}
h1{{font-size:20px}} h2{{font-size:15px;color:#8b949e;text-transform:uppercase;
letter-spacing:.05em}} h3{{font-size:13px;color:#8b949e;margin:16px 0 4px}}
.bar{{background:#21262d;border-radius:8px;height:22px;overflow:hidden}}
.fill{{background:linear-gradient(90deg,#d4a017,#f0c040);height:100%;
width:{pct:.1f}%;transition:width .5s}}
.big{{font-size:32px;font-weight:700;color:#f0c040}}
pre{{background:#161b22;padding:10px;border-radius:8px;font-size:12px;
overflow-x:auto;margin:0}}
table{{border-collapse:collapse;font-size:13px}}
td,th{{padding:4px 12px;text-align:left}} .num{{text-align:right;font-family:monospace}}
.card{{background:#161b22;border-left:3px solid #d4a017;padding:8px 12px;
margin:6px 0;border-radius:0 8px 8px 0;font-size:13px}}
.card p{{margin:4px 0 0;color:#adbac7}}
.grid{{display:grid;grid-template-columns:1fr 1fr;gap:24px}}
</style></head><body>
<h1>LexisAI — Generasi Penjelasan Pasal</h1>
<p><span class=big>{done}</span> / {TOTAL} pasal &nbsp;({pct:.1f}%)
&nbsp;·&nbsp; {time.strftime('%H:%M:%S')}</p>
<div class=bar><div class=fill></div></div>
<h2>Log per-shard</h2>{log_html}
<h2>GPU</h2>
<table><tr><th>#</th><th>Nama</th><th>Util</th><th>VRAM</th><th>Suhu</th><th>Daya</th></tr>
{gpu_rows}</table>
<h2>Sampel Penjelasan Terbaru</h2>
<div class=grid>{samples}</div>
<p style=color:#6e7681;font-size:11px>refresh tiap 15 detik ·
di-serve python http.server (scripts/monitor.py)</p>
</body></html>"""


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = page().encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):  # senyap
        pass


if __name__ == "__main__":
    print(f"monitor -> http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
