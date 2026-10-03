"""Agen LegalTextCleaner: pembersih teks hasil ekstraksi PDF/OCR.

Menghapus watermark, header/footer berulang, nomor halaman, dan memperbaiki
typo hasil OCR tanpa mengubah teks undang-undang murni.
"""

import re

from src.config import load_prompt
from src.llm import get_llm_client, get_llm_model


class LegalTextCleaner:
    def __init__(self, use_llm: bool = False):
        self.prompt_template = load_prompt("cleaner_prompt.txt")
        self.use_llm = use_llm
        self.client = get_llm_client() if use_llm else None

    def clean(self, raw_text: str) -> str:
        """Bersihkan teks mentah dari artefak PDF/OCR."""
        text = raw_text
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
            # Fragmen nomor di tepi halaman: "68...", "Pasal 69..."
            r"(?m)^\s*Pasal\s+\d+[A-Za-z]?\.{2,}\s*$",
            r"(?m)^\s*\d+\.{2,}\s*$",
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
    def _fix_ocr_artifacts(text: str) -> str:
        # Perbaikan umum hasil OCR pada penanda struktur hukum
        text = re.sub(r"\bPasa[1l]\b|\bPasaI\b", "Pasal", text)
        text = re.sub(r"\bAya[7t]\b", "Ayat", text)
        text = re.sub(r"dan/atau{2,}", "dan/atau", text)
        return text

    @staticmethod
    def _normalize_whitespace(text: str) -> str:
        text = re.sub(r"[ \t]+", " ", text)
        return re.sub(r"\n{3,}", "\n\n", text).strip()
