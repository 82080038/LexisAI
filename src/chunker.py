"""Agen LegalChunkingAgent: pemotong dokumen per pasal utuh.

Memotong teks undang-undang secara sekuensial berdasarkan batasan
pasal/ayat dan menyematkan metadata peraturan pada setiap chunk.
Pasal yang melebihi 800 kata dipotong per ayat dengan identitas
pasal tetap dicantumkan di awal potongan.
"""

import re
from dataclasses import dataclass, field

from src.config import load_prompt
from src.llm import get_llm_client, get_llm_model

PASAL_PATTERN = re.compile(r"^\s*Pasal\s+(\d+[A-Za-z]?)\s*$", re.MULTILINE)
AYAT_PATTERN = re.compile(r"^\s*\(\d+\)", re.MULTILINE)
CHUNK_BOUNDARY = "===CHUNK_BOUNDARY==="
MAX_WORDS_PER_CHUNK = 800

# Penanda struktur di atas pasal — dua layout: judul inline atau baris berikut.
STRUCT_MARK = re.compile(
    r"^\s*(BAB|Bagian|Paragraf)\s+([IVXLCDMivxlcdm0-9)(.\-]+)[ \t]*([^\n]*)\n(?:\s*([^\n]+)\n)?"
    r"|^\s*(PENJELASAN)[ \t]*([^\n]*)\n(?:\s*([^\n]+)\n)?",
    re.MULTILINE,
)
# Versi strip: hapus baris penanda + (opsional) baris judul CAPS dari isi chunk.
STRUCT_STRIP = re.compile(
    r"(?m)^\s*(?:BAB|Bagian|Paragraf)\s+[IVXLCDMivxlcdm0-9)(.\-]+[^\n]*\n"
    r"(?:\s*[A-Z][A-Z0-9\s.,()\-/]{2,80}\n)?"
)
ORPHAN_MARK = re.compile(r"(?m)^\s*(?:Pasal|Ayat|BAB|Bagian|Paragraf)\s*$")


@dataclass
class LegalChunk:
    text: str
    pasal: str
    metadata: dict = field(default_factory=dict)


class LegalChunkingAgent:
    def __init__(self, use_llm: bool = False):
        self.prompt_template = load_prompt("chunker_prompt.txt")
        self.use_llm = use_llm
        self.client = get_llm_client() if use_llm else None

    def chunk(
        self,
        clean_text: str,
        nomor_uu: str = "",
        tahun_uu: str = "",
        tentang: str = "",
    ) -> list[LegalChunk]:
        """Potong teks bersih menjadi chunk per pasal (atau per ayat jika >800 kata)."""
        if self.use_llm:
            return self._chunk_with_llm(clean_text)
        return self._chunk_by_regex(clean_text, nomor_uu, tahun_uu, tentang)

    def _chunk_by_regex(
        self, text: str, nomor_uu: str, tahun_uu: str, tentang: str
    ) -> list[LegalChunk]:
        matches = list(PASAL_PATTERN.finditer(text))
        chunks: list[LegalChunk] = []

        # Posisi penanda struktur -> metadata bab per pasal
        struct_marks = self._scan_structure(text)

        for i, match in enumerate(matches):
            start = match.start()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            pasal_no = match.group(1)
            body = text[start:end]
            # Buang penanda struktur (BAB/Bagian/Paragraf + judul) dari isi
            # dan penanda yatim hasil potong halaman yang tersisa.
            body = STRUCT_STRIP.sub("", body)
            body = ORPHAN_MARK.sub("", body).strip()
            if not body:
                continue

            meta = {"nomor_uu": nomor_uu, "tahun_uu": tahun_uu,
                    "tentang": tentang, "pasal": pasal_no}
            bab = self._bab_at(struct_marks, start)
            if bab:
                meta["bab"] = bab
            chunks.extend(self._split_long_pasal(body, pasal_no, meta))

        # TODO: tangani dokumen tanpa penanda "Pasal" (konsiderans, penjelasan,
        # lampiran) sebagai chunk tersendiri
        return chunks

    @staticmethod
    def _scan_structure(text: str) -> list[tuple[int, str]]:
        """Kumpulkan (posisi, label) penanda BAB/Bagian/Paragraf berurutan."""
        marks = []
        for m in STRUCT_MARK.finditer(text):
            if m.group(5):  # bagian PENJELASAN (tanpa nomor romawi)
                marks.append((m.start(), "PENJELASAN"))
                continue
            else:
                label = f"{m.group(1)} {m.group(2)}"
                title = (m.group(3) or m.group(4) or "").strip()
            if title and len(title) <= 80 and title == title.upper():
                label += f" {title}"
            marks.append((m.start(), label))
        marks.sort(key=lambda x: x[0])
        # dedup posisi (pattern kadang overlap layout inline vs dua-baris)
        dedup = []
        for pos, label in marks:
            if dedup and abs(pos - dedup[-1][0]) < 200:
                if len(label) > len(dedup[-1][1]):
                    dedup[-1] = (pos, label)
                continue
            dedup.append((pos, label))
        return dedup

    @staticmethod
    def _bab_at(struct_marks: list, pos: int) -> str | None:
        """BAB/Bagian/Paragraf terakhir yang muncul SEBELUM posisi pasal."""
        bab = None
        for m_pos, label in struct_marks:
            if m_pos < pos:
                bab = label
            else:
                break
        return bab

    @staticmethod
    def _split_long_pasal(
        body: str, pasal_no: str, meta: dict
    ) -> list[LegalChunk]:
        """Pasal >800 kata dipotong per ayat, identitas pasal disematkan di awal."""
        if len(body.split()) <= MAX_WORDS_PER_CHUNK:
            return [LegalChunk(text=body, pasal=pasal_no, metadata=dict(meta))]

        ayat_starts = [m.start() for m in AYAT_PATTERN.finditer(body)]
        if not ayat_starts:
            return [LegalChunk(text=body, pasal=pasal_no, metadata=dict(meta))]

        header = body[: ayat_starts[0]].strip()
        chunks = []
        for j, s in enumerate(ayat_starts):
            e = ayat_starts[j + 1] if j + 1 < len(ayat_starts) else len(body)
            ayat_text = body[s:e].strip()
            chunks.append(
                LegalChunk(
                    text=f"{header}\n{ayat_text}",
                    pasal=pasal_no,
                    metadata={**meta, "ayat": j + 1},
                )
            )
        return chunks

    def _chunk_with_llm(self, text: str) -> list[LegalChunk]:
        """Pemotongan via LLM; parse output ===CHUNK_BOUNDARY=== + header metadata."""
        response = self.client.chat.completions.create(
            model=get_llm_model(),
            messages=[
                {
                    "role": "user",
                    "content": self.prompt_template.format(cleaned_law_text=text),
                },
            ],
            temperature=0,
        )
        raw = response.choices[0].message.content

        chunks = []
        for block in raw.split(CHUNK_BOUNDARY):
            block = block.strip()
            if not block:
                continue
            meta, body = self._parse_metadata_header(block)
            chunks.append(
                LegalChunk(text=body, pasal=meta.get("pasal", ""), metadata=meta)
            )
        return chunks

    @staticmethod
    def _parse_metadata_header(block: str) -> tuple[dict, str]:
        """Ekstrak blok '---\\nSumber: ...\\nStruktur: ...\\n---' dari awal chunk."""
        meta: dict = {}
        m = re.match(r"^-{3,}\s*\n(.*?)\n-{3,}\s*\n(.*)$", block, flags=re.DOTALL)
        if not m:
            return meta, block

        header, body = m.group(1), m.group(2).strip()
        for line in header.splitlines():
            key, _, value = line.partition(":")
            value = value.strip()
            if key.strip() == "Sumber":
                meta["sumber"] = value
            elif key.strip() == "Struktur":
                meta["struktur"] = value
                pm = re.search(r"Pasal\s+(\S+)", value)
                if pm:
                    meta["pasal"] = pm.group(1)
        return meta, body
