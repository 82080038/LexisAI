"""Koreksi kata hasil OCR tingkat token, berbasis kamus Hunspell id_ID.

Strategi berlapis, presisi diutamakan (token tak dikenal saja yang disentuh):
1. Peta terkurasi (OCR_FIX) — salah-OCR frekuensi tinggi hasil audit korpus.
2. Kata terbalik hasil scan mirror ('gnay' -> 'yang').
3. Aturan glif/digit OCR ('sar€rna'->'sarana', 'dirnaksud'->'dimaksud').
4. Jarak-edit-1 kandidat TUNGGAL + saran harus kata kamus sah.
5. Token ganda tanpa spasi ('cukupjelas' -> 'cukup jelas').
6. Rejoin huruf terpisah ('d alim' -> 'dalam').

Guard: akronim semua-kapital dan token campur-kapital (KppS) tidak disentuh
aturan generik — hanya huruf-kecil murni / Kapital murni (+ peta terkurasi).
Semua pengecekan kamus di-batch via `hunspell -a` (maks 3 panggilan/teks).
"""

import re
import subprocess

LEGAL_TERMS = {
    # bentuk hukum/indonesia sah yang tak ada di hunspell
    "perundang", "undangan", "dipidana", "masing", "dugaan", "perpanjangan",
    "terjadinya", "diberhentikan", "sistemik", "diputus", "berakhirnya",
    "pelunasan", "dipersamakan", "pidananya", "terafiliasi", "terintegrasi",
    "matinya", "pembudi", "didakwakan", "trustee", "pascatambang", "terutang",
    "permusyawaratan", "diminta", "dikonsultasikan", "kepesertaan",
    "merekomendasikan", "dikoordinasikan", "dipersyaratkan", "dipekerjakan",
    "dilampiri", "dilikuidasi", "keterdapatannya", "berisiko", "termohon",
    "pemohon", "tersangka", "terdakwa", "terduga", "penuntut", "perkara",
    "pertanggungjawaban", "perkosaan", "tertuang", "dikategorikan",
    "terselenggaranya", "didaftar", "berwawasan", "dananya", "modalnya",
    "pelintas", "karboksilat", "advokatnya", "masuknya", "dimintakan",
    "dikemas", "dikehendaki", "diumumkan", "didasarkan", "permen",
    "sekurang", "diancamkan", "dilakukan", "dipergunakan", "perdagangkan",
    "perbankan", "perasuransian", "pengelolaan", "keterjangkauan",
    "didaftarkan", "diklasifikasikan", "pengoperasian", "dipertanyakan",
    "disempurnakan", "disebabkan", "dikaitkan", "dikecualikan",
    "dipertanggungjawabkan", "persengketaan", "penyandang", "dikurangkan",
    "sahamnya", "dipalsu", "kolegium", "manapun", "beralihnya",
    "apapun", "berserta", "permufakatan", "lambatnya", "selambat",
    "selambatnya", "pautnya", "menyitanya", "memperberat", "tama",
    "berdaerah", "reglement", "daripadanya", "terpaut", "berpaut",
    "kaitnya", "berkait", "sitasit", "penyitaan", "menyita",
    "disita", "penyita", "tersita", "penyitanya", "mutatis", "mutandis",
    "perbarengan", "dirusak", "dirusaki", "merusak", "tempatkan",
    "uniter",
    # inggris yang lazim di UU
    "out", "trade", "world", "netting", "international", "divisional",
    "organization", "convention", "pasca",
    # nama daerah/istilah (token lowercase)
    "jakarta", "papua", "jawa", "sulawesi", "riau", "jambi", "bengkulu",
    "gorontalo", "halmahera", "nias", "barito", "buton", "konawe",
    "mongondow", "bolaang", "ogan", "april", "pancasila", "batubara",
    "staatsblad", "officio", "hoc", "sine", "idem", "adhoc",
}

OCR_FIX = {
    "unhrk": "untuk", "unttrk": "untuk", "unttik": "untuk", "uuk": "untuk",
    "repubuk": "republik", "repuelik": "republik", "nepublik": "republik",
    "nepuelik": "republik", "repijblik": "republik", "epublik": "republik",
    "epubl": "republik", "pubuk": "republik", "repueuk": "republik",
    "refublik": "republik", "nepubuk": "republik", "republtk": "republik",
    "indonesi": "indonesia", "ndonesia": "indonesia", "indone sia": "indonesia",
    "fresiden": "presiden", "presioen": "presiden", "esiden": "presiden",
    "inoonesia": "indonesia", "tndonesia": "indonesia", "donesia": "indonesia",
    "penghihrngan": "penghilangan", "rekapihrlasi": "rekapitulasi",
    "dimalsud": "dimaksud", "dirnaksud": "dimaksud", "malsud": "maksud",
    "sslagaimana": "sebagaimana", "verilikasi": "verifikasi",
    "verifrkasi": "verifikasi", "pertanggungiawaban": "pertanggungjawaban",
    "kabupatenlkota": "kabupaten/kota", "danlatau": "dan/atau",
    "abupaten": "kabupaten", "lhbupaten": "kabupaten", "ikbupaten": "kabupaten",
    "ihbupaten": "kabupaten", "igbupaten": "kabupaten", "gbupaten": "kabupaten",
    "bupaten": "kabupaten", "blik": "bilik", "bagran": "bagian",
    "hurufa": "huruf a", "hurufb": "huruf b", "hurufc": "huruf c",
    "hurufd": "huruf d", "hurufe": "huruf e", "huruff": "huruf f",
    "hurufg": "huruf g", "hurrf": "huruf", "huruh": "huruf",
    "uata": "atau", "ataun": "atau", "pasa": "pasal", "pasd": "pasal",
    "tqiuh": "tujuh", "tqjuh": "tujuh", "tqiun": "tujuh", "hatian": "harian",
    "sertilikat": "sertifikat", "pemagangan": "pemasangan", "puhrsan": "putusan",
    "didanakan": "didanai", "dalarn": "dalam", "ukupjelas": "cukup jelas",
    "pemyataan": "pernyataan", "agensia": "agensi", "jumlatr": "jumlah",
    "yangberlaku": "yang berlaku", "hanrs": "harus", "hanis": "harus",
    "keiadi": "kejadian", "sahr": "sah", "naryat": "rakyat", "ratyat": "rakyat",
    "rakyaf": "rakyat", "pelanstaran": "pelantaran",
    "enindaklanjutf": "menindaklanjuti", "sdg": "sedang",
    # kata terbalik hasil scan mirror (frekuensi tinggi -> eksplisit)
    "gnay": "yang", "nagned": "dengan", "aisenodni": "indonesia",
    "anamiagabes": "sebagaimana", "nakukalid": "dilakukan",
    "naanitnarakek": "kekarantinaan", "tikaynep": "penyakit",
    "ysng": "yang", "ysag": "yang", "gany": "yang", "sng": "yang",
    "nagrep": "perang", "nadem": "medan", "lirma": "lima",
    "rat<yat": "rakyat", "pemeriksana": "pemeriksaan",
}

# glif/digit OCR -> kandidat huruf (diuji per posisi, hasil harus di kamus)
GLYPH_CAND = {
    "€": ["e", "a", "o"], "£": ["e"], "¥": ["y"], "§": ["s"], "†": ["t"],
    "‡": ["t"], "¶": ["p"], "©": ["c"], "®": ["r"], "<": ["k", "c"],
    ">": ["j"], "|": ["l", "i"], "ℓ": ["l"], "0": ["o"], "1": ["l", "i"],
    "4": ["a"], "5": ["s"], "6": ["g", "b"], "7": ["t"], "8": ["b"],
    "9": ["g"], "3": ["e"],
}
# pasangan huruf khas-salah-OCR -> kandidat pengganti (hasil harus di kamus)
PAIR_CAND = {"rn": ["m", "n"], "cl": ["d"], "vv": ["w"], "lh": ["k"],
             "iL": ["il"], "tl": ["t"], "hn": ["m"], "nh": ["m"]}

TOKEN_RE = re.compile(r"[A-Za-zÀ-ÿ€£§†‡¶©®<>|ℓ¥]+")
ROMAN_RE = re.compile(r"^[ivxlcdm]+$")
PLAIN_RE = re.compile(r"^[a-zà-ÿ]+$")          # huruf kecil murni
CAP_RE = re.compile(r"^[A-ZÀ-Þ][a-zà-ÿ]+$")    # Kapital murni

_SPLIT_HEAD = re.compile(r"(?<![\w/.-])([a-zA-ZÀ-ÿ])\s+([a-zà-ÿ]{3,})(?![\w/-])")
_SPLIT_TAIL = re.compile(r"(?<![\w/-])([a-zà-ÿ]{3,})\s+([a-zA-ZÀ-ÿ])(?![\w.-])")


def _lev1(a: str, b: str) -> bool:
    """Jarak edit tepat 1 (substitusi/insersi/delesi tunggal)."""
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    if len(a) > len(b):
        a, b = b, a
    i = j = diff = 0
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            i += 1
            j += 1
        else:
            diff += 1
            j += 1
            if diff > 1:
                return False
    return True


def _match_case(src: str, fix: str) -> str:
    if src.isupper():
        return fix.upper()
    if src[:1].isupper():
        return fix.capitalize()
    return fix


class OCRWordFixer:
    """Perbaiki token salah-OCR terhadap kamus hunspell id_ID (batch)."""

    def __init__(self, lang: str = "id_ID"):
        self.lang = lang
        self._spell: dict[str, bool] = {}
        self._sugg: dict[str, list[str]] = {}
        self.changed = 0

    # -- kamus (batch) --------------------------------------------------------
    def _ensure_spell(self, words: set[str]) -> None:
        """`hunspell -l`: spell saja — kata salah diecho, kata benar tidak.
        Aman & cepat utk verifikasi massal (kandidat varian)."""
        todo = {w for w in words if w not in self._spell}
        if not todo:
            return
        proc = subprocess.run(
            ["hunspell", "-l", "-d", self.lang],
            input="\n".join(todo), capture_output=True, text=True,
        )
        wrong = {ln.strip() for ln in proc.stdout.splitlines() if ln.strip()}
        for w in todo:
            self._spell[w] = w not in wrong

    def _ensure_sugg(self, words: set[str]) -> None:
        """`hunspell -a` utk SARAN — hanya dipanggil pada kata yang sudah
        terbukti salah. Output '& word ...'/'# word' menyematkan nama kata
        sehingga dapat dipetakan balik secara unambiguous.
        (CATATAN: untuk kata BENAR hunspell -a mengeluarkan '*' telanjang
        tanpa nama — tidak bisa dipetakan; jangan pakai -a utk spell-check.)"""
        todo = [w for w in words if w not in self._sugg]
        if not todo:
            return
        proc = subprocess.run(
            ["hunspell", "-a", "-d", self.lang],
            input="\n".join(todo), capture_output=True, text=True,
        )
        for line in proc.stdout.splitlines():
            m = re.match(r"^& (\S+) \d+ \d+: (.*)$", line)
            if m:
                self._sugg[m.group(1)] = [
                    s.strip() for s in m.group(2).split(",") if s.strip()
                ]
                continue
            m = re.match(r"^[#!?] (\S+)", line)
            if m:
                self._sugg[m.group(1)] = []

    def _ensure(self, words: set[str]) -> None:
        """Spell-check + saran untuk token ASLI (bukan kandidat):
        -l utk benar/salah, lalu -a hanya pada yang salah."""
        self._ensure_spell(words)
        wrong = {w for w in words if self._spell.get(w) is False}
        self._ensure_sugg(wrong)

    def _known(self, word: str) -> bool:
        """Hanya baca cache — _ensure harus dipanggil dulu utk kata tsb."""
        lw = word.lower()
        if lw in LEGAL_TERMS or ROMAN_RE.match(lw):
            return True
        return bool(
            self._spell.get(lw)
            or self._spell.get(word)
            or self._spell.get(lw.capitalize())
        )

    # -- generasi kandidat -----------------------------------------------------
    @staticmethod
    def _variants(tok: str) -> set[str]:
        """Semua kandidat perbaikan token (belum diverifikasi kamus)."""
        out: set[str] = {tok[::-1]}
        for i, ch in enumerate(tok):
            for cand in GLYPH_CAND.get(ch, []):
                out.add(tok[:i] + cand + tok[i + 1:])
        for i in range(len(tok) - 1):
            for cand in PAIR_CAND.get(tok[i:i + 2], []):
                out.add(tok[:i] + cand + tok[i + 2:])
        if len(tok) >= 9:  # split dua kata: separuh minimal 4 huruf
            for i in range(4, len(tok) - 3):
                out.add(tok[:i])
                out.add(tok[i:])
        return out

    def _pick(self, tok: str) -> str | None:
        """Pilih perbaikan terbaik untuk token tak-dikenal (cache only)."""
        low = tok.lower()
        if low in OCR_FIX:
            return OCR_FIX[low]
        if not (PLAIN_RE.match(tok) or CAP_RE.match(tok)):
            return None  # kapital campur/akronim -> peta terkurasi saja
        # kata terbalik: satu-satunya aturan generik utk token pendek
        if len(low) >= 4 and self._known(low[::-1]):
            return low[::-1]
        if len(low) < 5:
            return None
        # jarak-edit-1 tunggal + saran harus kata sah (edit minimal dulu)
        sugg = {
            s.lower()
            for s in self._sugg.get(low, [])
            if " " not in s and "-" not in s and _lev1(low, s.lower())
            and self._known(s.lower())
        }
        if len(sugg) == 1:
            return sugg.pop()
        # glif & pasangan
        for i, ch in enumerate(low):
            for cand in GLYPH_CAND.get(ch, []):
                t = low[:i] + cand + low[i + 1:]
                if self._known(t):
                    return t
        for i in range(len(low) - 1):
            for cand in PAIR_CAND.get(low[i:i + 2], []):
                t = low[:i] + cand + low[i + 2:]
                if self._known(t):
                    return t
        # token ganda tanpa spasi
        if len(low) >= 9:
            for i in range(4, len(low) - 3):
                if self._known(low[:i]) and self._known(low[i:]):
                    return low[:i] + " " + low[i:]
        return None

    # -- titik masuk -----------------------------------------------------------
    def fix_text(self, text: str) -> str:
        self.changed = 0
        uniq = set(TOKEN_RE.findall(text))
        # fase 1: cek token + kandidat merge rejoin dalam 1 batch
        head_c = {m.group(1) + m.group(2) for m in _SPLIT_HEAD.finditer(text)}
        tail_c = {m.group(1) + m.group(2) for m in _SPLIT_TAIL.finditer(text)}
        self._ensure(
            set(uniq)
            | {w.lower() for w in uniq}
            | {w.lower().capitalize() for w in uniq}
        )
        self._ensure_spell({c.lower() for c in head_c | tail_c})

        # rejoin huruf terpisah (iteratif utk kasus 'pertan ggun gj awabkan')
        def rj_head(m: re.Match) -> str:
            merged = (m.group(1) + m.group(2)).lower()
            if not self._known(m.group(2)) and self._known(merged):
                self.changed += 1
                return m.group(1) + m.group(2)
            return m.group(0)

        def rj_tail(m: re.Match) -> str:
            merged = (m.group(1) + m.group(2)).lower()
            if not self._known(m.group(1)) and self._known(merged):
                self.changed += 1
                return m.group(1) + m.group(2)
            return m.group(0)

        prev = None
        while prev != text:
            prev = text
            text = _SPLIT_HEAD.sub(rj_head, text)
            text = _SPLIT_TAIL.sub(rj_tail, text)

        # fase 2: token tak dikenal -> kumpulkan varian + saran, batch sekali
        uniq = set(TOKEN_RE.findall(text))
        self._ensure(set(uniq) | {w.lower() for w in uniq})
        unknown = [
            t for t in uniq
            if len(t) >= 3 and not self._known(t)
            and (
                t.lower() in OCR_FIX  # kurasi berlaku utk semua bentuk/kapital
                or not t.isupper()  # akronim: hanya kurasi, tanpa aturan generik
                and (PLAIN_RE.match(t) or CAP_RE.match(t))
            )
        ]
        cand: set[str] = set()
        for t in unknown:
            low = t.lower()
            cand |= self._variants(low)
            for s in self._sugg.get(low, []):
                if " " not in s and "-" not in s:
                    cand.add(s.lower())
        self._ensure_spell(cand)
        rep: dict[str, str] = {}
        for t in unknown:
            fix = self._pick(t)
            if fix and fix != t:
                rep[t] = _match_case(t, fix)
        self.changed += len(rep)
        if rep:
            pat = re.compile(
                r"\b(" + "|".join(
                    re.escape(k) for k in sorted(rep, key=len, reverse=True)
                ) + r")\b"
            )
            text = pat.sub(lambda m: rep[m.group(1)], text)
        return text
