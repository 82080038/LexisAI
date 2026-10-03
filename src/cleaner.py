"""Agen LegalTextCleaner: pembersih teks hasil ekstraksi PDF/OCR.

Menghapus watermark, header/footer berulang, nomor halaman, dan memperbaiki
typo hasil OCR tanpa mengubah teks undang-undang murni.
"""

import re

from src.config import load_prompt
from src.llm import get_llm_client, get_llm_model

PAGE_MARK = re.compile(r"^\s*<<<PAGE\s+(\d+)>>>\s*$", re.MULTILINE)
# Struktur hukum yang TIDAK BOLEH dihapus walau sering muncul di tepi halaman
# (penanda pasal bisa saja terletak persis di baris pertama/terakhir halaman)
LEGAL_GUARD = re.compile(
    r"^\s*(Pasal|Ayat\s*\(|BAB\b|Bagian\b|Paragraf\b|PENJELASAN|MENIMBANG|MENGINGAT|"
    r"MEMUTUSKAN|Menetapkan|KETENTUAN\s+UMUM|LAMPIRAN)\b"
)
# Kelanjutan kalimat: baris pertama halaman mulai huruf kecil/digit,
# baris terakhir halaman sebelumnya tidak diakhiri tanda baca akhir.
SENT_END = re.compile(r"[.:;!?\"')\]]$")
CONT_START = re.compile(r"^\s*[a-z0-9(\-]")
# Marker struktur telanjang di tepi halaman — JANGAN disambung (biarkan
# _rejoin_split_markers menyatukannya dengan benar sebagai baris sendiri)
BARE_MARK = re.compile(r"^\s*(Pasal|Ayat|BAB|Bagian|Paragraf)\s*$")
MARK_LINE = re.compile(r"^\s*(Pasal|Ayat|BAB|Bagian|Paragraf)\b")


class LegalTextCleaner:
    def __init__(self, use_llm: bool = False):
        self.prompt_template = load_prompt("cleaner_prompt.txt")
        self.use_llm = use_llm
        self.client = get_llm_client() if use_llm else None

    def clean(self, raw_text: str) -> str:
        """Bersihkan teks mentah dari artefak PDF/OCR."""
        # 0. Bersih per-halaman dulu (marker <<<PAGE n>>> dari extract_text):
        #    header/footer/watermark diidentifikasi dari frekuensi lintas
        #    halaman — jauh lebih andal daripada daftar pola statis.
        pages = self._split_pages(raw_text)
        if len(pages) >= 4:
            pages = self._strip_repeating_lines(pages)
            text = self._merge_continuations(pages)
        else:
            text = PAGE_MARK.sub("", raw_text)
        # Selanjutnya pipeline pola statis seperti biasa
        text = self._rejoin_split_markers(text)
        text = self._strip_page_numbers(text)
        text = self._strip_running_headers(text)
        text = self._strip_watermarks(text)
        text = self._fix_ocr_artifacts(text)
        text = self._normalize_whitespace(text)
        if self.use_llm:
            text = self._clean_with_llm(text)
        return text

    @staticmethod
    def _split_pages(text: str) -> list[str]:
        """Pecah teks per halaman berdasarkan marker <<<PAGE n>>>.
        Teks tanpa marker dianggap satu halaman utuh (fallback aman)."""
        parts = PAGE_MARK.split(text)
        # split -> [pre, '1', page1, '2', page2, ...]
        if len(parts) < 3:
            return [text]
        return [parts[i] for i in range(2, len(parts), 2)]

    @staticmethod
    def _mask(line: str) -> str:
        """Normalisasi baris untuk perbandingan: digit->#, spasi rapat."""
        return re.sub(r"\s+", " ", re.sub(r"\d", "#", line.strip()))

    @classmethod
    def _strip_repeating_lines(cls, pages: list[str]) -> list[str]:
        """Buang baris berulang lintas halaman: header (3 baris atas),
        footer (3 baris bawah), dan boilerplate global (watermark dst).
        Ambang: zona >= max(4, 25% halaman); global >= max(6, 40% halaman).
        Baris penanda hukum (Pasal/Ayat/BAB/dst) selalu dipertahankan."""
        n = len(pages)
        zone_thr = max(4, int(n * 0.25))
        glob_thr = max(6, int(n * 0.40))
        zone_count: dict[str, int] = {}
        glob_count: dict[str, int] = {}
        for page in pages:
            lines = [ln for ln in page.split("\n") if ln.strip()]
            if not lines:
                continue
            zone = set(cls._mask(ln) for ln in lines[:3] + lines[-3:])
            seen_global = set(cls._mask(ln) for ln in lines)
            for m in zone:
                zone_count[m] = zone_count.get(m, 0) + 1
            for m in seen_global:
                glob_count[m] = glob_count.get(m, 0) + 1
        repeat_zone = {m for m, c in zone_count.items() if c >= zone_thr}
        repeat_glob = {m for m, c in glob_count.items() if c >= glob_thr}

        cleaned = []
        for page in pages:
            out = []
            lines = page.split("\n")
            nonempty = [i for i, ln in enumerate(lines) if ln.strip()]
            zone_idx = set(nonempty[:3] + nonempty[-3:])
            for i, ln in enumerate(lines):
                if not ln.strip():
                    out.append(ln)
                    continue
                m = cls._mask(ln)
                if LEGAL_GUARD.match(ln):
                    out.append(ln)  # struktur hukum: jangan disentuh
                elif i in zone_idx and m in repeat_zone:
                    continue  # header/footer berulang
                elif m in repeat_glob and i in zone_idx:
                    continue  # boilerplate zona (mis. stempel LN di tepi)
                else:
                    out.append(ln)
            cleaned.append("\n".join(out))
        return cleaned

    @staticmethod
    def _merge_continuations(pages: list[str]) -> str:
        """Sambung kalimat yang terputus antar-halaman: baris terakhir page i
        tanpa tanda baca akhir + baris pertama page i+1 huruf kecil/digit."""
        chunks = []
        for page in pages:
            lines = page.split("\n")
            nonempty = [i for i, ln in enumerate(lines) if ln.strip()]
            if not nonempty:
                continue  # halaman kosong tidak memutus rantai sambungan
            first, last = nonempty[0], nonempty[-1]
            last_line = lines[last].strip()
            join_next = (
                not SENT_END.search(last_line) and not BARE_MARK.match(last_line)
            )
            body = "\n".join(lines[first : last + 1]).strip()
            # join_next disimpan: apakah page ini 'menggantung' ke page berikut
            chunks.append((body, join_next, lines[first].strip()))

        # Merger: pasang halaman berikut dengan spasi bila sambungan kalimat
        text = ""
        prev_join = False
        for body, join_next, first_line in chunks:
            if not body:
                continue
            if (
                prev_join
                and CONT_START.match(first_line)
                and not MARK_LINE.match(first_line)
            ):
                text = text.rstrip() + " " + body
            else:
                text += ("\n" if text else "") + body
            prev_join = join_next
        return text

    @staticmethod
    def _rejoin_split_markers(text: str) -> str:
        # Penanda struktur yang terpotong batas halaman disambung dulu,
        # SEBELUM _strip_page_numbers menghapus baris berisi angka saja.
        # Contoh nyata korpus: "Pasal\n" (akhir halaman) + "68" (halaman baru).
        text = re.sub(
            r"(?m)^\s*Pasal\s*\n\s*(\d+[A-Za-z]?)\s*\n",
            r"Pasal \1\n",
            text,
        )
        text = re.sub(
            r"(?m)^\s*Ayat\s*\n\s*\((\d+[a-z]?)\)",
            r"Ayat (\1)",
            text,
        )
        text = re.sub(
            r"(?m)^\s*(BAB|Bagian|Paragraf)\s*\n\s*([IVXLC0-9]+)\s*\n",
            r"\1 \2\n",
            text,
        )
        return text

    @staticmethod
    def _strip_running_headers(text: str) -> str:
        # Kop/footer berulang tiap halaman & blok tanda tangan — hanya baris
        # standalone (huruf kapital / pola khusus), teks inline tidak tersentuh.
        patterns = [
            # Blok tanda tangan: jabatan + opsi 'ttd.' + nama pejabat CAPS
            r"(?ms)^\s*PRESIDEN\s*REPUBLIK\s*INDONESIA,?\s*\n(?:\s*\n)?(?:\s*ttd\.?\s*\n)?\s*[A-Z][A-Z .,]{3,}\s*$",
            r"(?ms)^\s*SEKRETARIS\s+NEGARA\s*REPUBLIK\s*INDONESIA,?\s*\n(?:\s*\n)?(?:\s*ttd\.?\s*\n)?\s*[A-Z][A-Z .,]{3,}\s*$",
            r"(?ms)^\s*MENTERI\s+[A-Z .,&/]{3,}\s*\n(?:\s*\n)?(?:\s*ttd\.?\s*\n)?\s*[A-Z][A-Z .,]{3,}\s*$",
            # Prefiks sampah OCR di depan kop ('I PRESIDEN', ',PRESIDEN', '||')
            r"(?ms)^\s*[|,Il.:;\-]*\s*PRESIDEN\s*REPUBLIK\s*INDONESIA,?\s*\n(?:\s*\n)?(?:\s*ttd\.?\s*\n)?\s*[A-Z][A-Z .,]{3,}\s*$",
            r"(?ms)^\s*ttd\.?\s*\n(?:\s*\n)?\s*[A-Z][A-Z .,]{3,}\s*$",
            r"(?m)^\s*[,|.:\-\s]*(?:PRESIDEN|REPUBLIK\s*INDONESIA|IN[Dd]ONESIA|INgONESIA)[,.]?\s*$",
            r"(?m)^\s*PRESIDEN\s*REPUBLIK\s*INDONESIA,?\s*$",
            r"(?m)^\s*PRESIDEN\s*$",
            r"(?m)^\s*REPUBLIK\s*INDONESIA\s*$",
            r"(?m)^\s*Disahkan di[^\n]*$",
            r"(?m)^\s*(?:TAMBAHAN\s+)?LEMBARAN\s+NEGARA[^\n]*$",
            r"(?m)^\s*(?:TAMBAHAN\s+)?BERITA\s+NEGARA[^\n]*$",
            r"(?m)^\s*KEMENTERIAN\s+SEKRETARIAT[^\n]*$",
            r"(?m)^\s*SEKRETARIS\s+NEGARA[^\n]*$",
            r"(?m)^\s*(UNDANG-UNDANG|PERATURAN\s+PEMERINTAH|PERATURAN\s+PRESIDEN|PERATURAN\s+MENTERI)\s+REPUBLIK\s*INDONESIA\s*$",
            r"(?m)^\s*NOMOR\s+\d+\s+TAHUN\s+\d+\s*$",
            r"(?m)^\s*TENTANG\s*$",
            r"(?m)^\s*DENGAN RAHMAT TUHAN YANG MAHA ESA\s*$",
            r"(?m)^\s*MEMERINTAHKAN[^\n]*$",
            r"(?m)^\s*AGAR SETIAP ORANG[^\n]*$",
            r"(?m)^\s*SK\s*No\.?\s*[^\n]*$",
            r"(?m)^\s*Salinan\s+sesuai\s+dengan\s+aslinya[^\n]*$",
            r"(?m)^\s*Diundangkan[^\n]*$",
            r"(?m)^\s*Ditetapkan di[^\n]*$",
            r"(?m)^\s*pada tanggal[^\n]*$",
            r"(?m)^\s*ttd\.?\s*$",
            r"(?m)^\s*MENTERI\s+[A-Z\s.,]{3,}$",
            # Penanda yatim hasil potong halaman yang tidak bisa disambung
            r"(?m)^\s*(Pasal|Ayat)\s*$",
            # Fragmen nomor di tepi halaman: "68...", "Pasal 69...",
            # varian elipsis berjarak "Pasal 21 . .", "BABII ..."
            r"(?m)^\s*Pasal\s+\d+[A-Za-z]?(?:\s*\.){2,}\s*$",
            r"(?m)^\s*(?:BAB|Bagian|Paragraf)\s*[IVXLC0-9]+\s*\.{2,}\s*$",
            r"(?m)^\s*\d+(?:\s*\.){2,}\s*$",
            # Glyph romawi yatim hasil OCR: 'I', 'll', 'VII' — bukan teks sah
            r"(?m)^\s*[IVXLC]{1,3}\s*$",
            r"(?m)^\s*[l|!]{1,3}\s*$",
        ]
        for pattern in patterns:
            text = re.sub(pattern, "", text)
        return text

    def _clean_with_llm(self, text: str) -> str:
        """Perbaikan typo/artefak lanjutan via LLM dengan cleaner_prompt."""
        response = self.client.chat.completions.create(
            model=get_llm_model(),
            messages=[
                {
                    "role": "user",
                    "content": self.prompt_template.format(raw_pdf_text=text),
                },
            ],
            temperature=0,
        )
        return response.choices[0].message.content.strip()

    @staticmethod
    def _strip_page_numbers(text: str) -> str:
        # Hapus baris yang hanya berisi nomor halaman
        return re.sub(r"^\s*-?\s*\d+\s*-?\s*$", "", text, flags=re.MULTILINE)

    @staticmethod
    def _strip_watermarks(text: str) -> str:
        # Hapus pola watermark umum JDIH
        patterns = [
            r"(?i)jdih[^\n]*",
            r"(?i)www\.[^\s]+",
            r"(?i)direktorat jenderal peraturan perundang-undangan[^\n]*",
        ]
        for pattern in patterns:
            text = re.sub(pattern, "", text)
        return text

    @staticmethod
    def _roman_to_int(s: str) -> int | None:
        vals = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
        total, prev = 0, 0
        for ch in reversed(s):
            v = vals.get(ch)
            if v is None:
                return None
            total += -v if v < prev else v
            prev = max(prev, v)
        return total if 0 < total < 4000 else None

    _OCR_DIGIT = str.maketrans("OolLISB|", "00111581")

    @classmethod
    def _fix_ocr_artifacts(cls, text: str) -> str:
        # Perbaikan umum hasil OCR pada penanda struktur hukum
        text = re.sub(r"\bPasa[1l]\b|\bPasaI\b", "Pasal", text)
        text = re.sub(r"\bAya[7t]\b", "Ayat", text)
        text = re.sub(r"dan/atau{2,}", "dan/atau", text)
        text = re.sub(r"\bPasal(?=\d)", "Pasal ", text)  # 'Pasal214'

        # Nomor pasal terkorupsi OCR: digit tertukar huruf ('22O','2L9'),
        # digit terpisah spasi ('2 I'), sufiks huruf sah ('21 A' -> '21A').
        def fix_num(m: re.Match) -> str:
            tok = re.sub(r"\s+", "", m.group(1))
            fixed = tok.translate(cls._OCR_DIGIT)
            if re.fullmatch(r"\d+[A-Za-z]?", fixed):
                return f"Pasal {fixed}"
            return m.group(0)

        text = re.sub(
            r"\bPasal\s+([0-9OolLISB|]+(?:\s+[0-9OolLISB|]+)?[A-Za-z]?(?=\s|$))",
            fix_num,
            text,
        )

        # Scan tertentu menulis nomor pasal sebagai ROMAWI ('Pasal XL')
        # — penomoran UU Indonesia kanoniknya arab; normalisasi supaya
        # PASAL_PATTERN & graf rujukan menangkapnya.
        def repl(m: re.Match) -> str:
            n = cls._roman_to_int(m.group(2))
            return f"{m.group(1)}{n}" if n else m.group(0)

        return re.sub(r"(\bPasal\s+)([IVXLCDM]{1,7})\b", repl, text)

    @staticmethod
    def _normalize_whitespace(text: str) -> str:
        text = re.sub(r"[ \t]+", " ", text)
        return re.sub(r"\n{3,}", "\n\n", text).strip()
