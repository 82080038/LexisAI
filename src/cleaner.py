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
        text = self._strip_page_numbers(text)
        text = self._strip_watermarks(text)
        text = self._fix_ocr_artifacts(text)
        text = self._normalize_whitespace(text)
        if self.use_llm:
            text = self._clean_with_llm(text)
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
