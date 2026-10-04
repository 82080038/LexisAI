// Kamus linguistik untuk retrieval — bukan LLM.
// Tiga lapisan: (1) sinonim hukum↔awam agar pertanyaan sehari-hari
// menemukan istilah resmi undang-undang; (2) pengupas imbuhan ringan
// agar bentuk berimbuhan (percabulan, persetubuhan) ketemu kata dasar
// pertanyaan; (3) peta INTENT pertanyaan -> penanda normatif di teks
// pasal ("hukuman" -> dipidana/denda) sehingga konteks pertanyaan ikut
// memilah, bukan hanya kata kunci.

// ---- 1. Sinonim: kata awam -> padanan yang muncul di teks UU ----
// Kunci dan nilai saling memperluas dua arah; dipakai saat parse query.
export const SYNONYMS = {
  hukuman: ['pidana', 'denda', 'sanksi', 'penjara', 'kurungan'],
  sanksi: ['pidana', 'denda'],
  cabul: ['asusila', 'kesusilaan', 'percabulan', 'pencabulan', 'mesum'],
  persetubuhan: ['setubuh', 'bersetubuh', 'zina', 'perzinaan', 'senggama'],
  'sesama jenis': ['sesama kelamin', 'sama jenis', 'sejenis'],
  gay: ['sesama kelamin', 'sama jenis'],
  lesbian: ['sesama kelamin', 'sama jenis'],
  lgbt: ['sesama kelamin', 'sama jenis'],
  perkosaan: ['pemerkosaan', 'rudapaksa', 'kekerasan seksual'],
  kekerasan: ['kekerasan seksual', 'perbuatan kekerasan', 'memaksa'],
  bunuh: ['pembunuhan', 'membunuh', 'menghilangkan nyawa'],
  curi: ['pencurian', 'mencuri'],
  korupsi: ['tipikor', 'melawan hukum', 'memperkaya diri', 'suap'],
  suap: ['penyuapan', 'gratifikasi', 'hadiah'],
  menyuap: ['penyuapan', 'suap'],
  narkoba: ['narkotika', 'psikotropika'],
  tahan: ['penahanan', 'ditahan', 'tahanan', 'rutan', 'penangkapan'],
  tangkap: ['penangkapan', 'ditangkap'],
  cerai: ['perceraian', 'talak', 'gugat cerai'],
  kawin: ['perkawinan', 'nikah', 'menikah'],
  nikah: ['perkawinan', 'menikah'],
  waris: ['ahli waris', 'pewaris', 'pewarisan'],
  pengacara: ['advokat', 'kuasa hukum', 'penasihat hukum'],
  jaksa: ['penuntut umum', 'penuntut'],
  polisi: ['kepolisian', 'penyidik', 'polri'],
  saksi: ['kesaksian', 'alat bukti', 'keterangan saksi'],
  terdakwa: ['tersangka', 'terdakwa'],
  tanah: ['pertanahan', 'agraria', 'hak atas tanah'],
  pajak: ['perpajakan', 'ketentuan umum perpajakan', 'wajib pajak'],
  utang: ['piutang', 'kewajiban pembayaran', 'pailit', 'pkpu'],
  pailit: ['kepailitan', 'pkpu'],
  buruh: ['pekerja', 'ketenagakerjaan', 'tenaga kerja'],
  kerja: ['pekerja', 'ketenagakerjaan'],
  phk: ['pemecatan', 'pemutusan hubungan kerja', 'pesangon'],
  pesangon: ['pemutusan hubungan kerja', 'uang pesangon'],
  konsumen: ['perlindungan konsumen', 'pelaku usaha'],
  anak: ['di bawah umur', 'belum dewasa', 'perlindungan anak'],
  remaja: ['di bawah umur', 'belum dewasa', 'anak'],
  kekerasan_rumah_tangga: ['kdrt', 'dalam rumah tangga'],
  lingkungan: ['pencemaran', 'lingkungan hidup', 'perusakan'],
  merek: ['hak merek', 'kekayaan intelektual'],
  hakcipta: ['hak cipta', 'ciptaan', 'kekayaan intelektual'],
  ktp: ['kartu tanda penduduk', 'administrasi kependudukan'],
  pajak_kendaraan: ['bea balik nama', 'kendaraan bermotor'],
  tilang: ['pelanggaran lalu lintas', 'lalu lintas'],
  bea: ['beacukai', 'pabean', 'cukai'],
  impor: ['pabean', 'bea masuk'],
  ekspor: ['pabean', 'bea keluar'],
  teroris: ['terorisme', 'tindak pidana terorisme'],
  judi: ['perjudian', 'lotre', 'taruhan'],
  zina: ['perzinaan', 'persetubuhan'],
  mesum: ['asusila', 'kesusilaan', 'cabul'],
}

// ---- 2. Stem imbuhan ringan ----
// Bukan Sastrawi penuh — cukup untuk bentuk jamak hukum:
// per-…-an, peN-…-an, ke-…-an, di-…-kan, meN-, ber-, ter-, se-, -kan/-an/-i.
// Menghasilkan KANDIDAT bentuk (bisa >1) — dipakai sebagai OR pada matching.
const PREF = [
  /^(meng|meny|men|mem|me)/, /^(peng|peny|pen|pem|pe)/,
  /^(ber|be|bel)/, /^(ter|te|tel)/, /^(di|ke|per|pel)/,
  // 'se-' sengaja dibuang: se+sama -> 'sama' (kata generik, df ~1051)
  // yang meracuni union-df grup sinonim.
]

function stripSuf(w) {
  const out = []
  let x = w.replace(/(nya|lah|kah|pun)$/i, '')
  if (x !== w) out.push(x)
  const y = x.replace(/(kan|an|i)$/i, '')
  if (y.length >= 4 && y !== x) out.push(y)
  return out
}

/** Kandidat bentuk dasar untuk SATU kata (maks 2 lapis awalan). */
export function stemVariants(word) {
  const variants = new Set([word])
  const suf = stripSuf(word)
  for (const s of [word, ...suf]) {
    for (const re of PREF) {
      const m = s.match(re)
      if (m && s.length - m[0].length >= 4) {
        const root = s.slice(m[0].length)
        variants.add(root)
        // pemulihan huruf yang terluluh (meny+etubuh -> setubuh,
        // mem+ukul -> pukul, meng+irim -> kirim, pen+ulis -> tulis)
        if (/^meny/.test(s)) variants.add(`s${root}`)
        if (/^mem|^pem/.test(s)) variants.add(`p${root}`)
        if (/^meng|^peng/.test(s)) variants.add(`k${root}`)
        if (/^men|^pen/.test(s)) variants.add(`t${root}`)
        for (const ss of stripSuf(root)) variants.add(ss)
      }
    }
  }
  return [...variants].filter((v) => v.length >= 4)
}

// ---- 4. Status supersedensi: UU yang sudah DICABUT penuh ----
// Key `${nomor_uu}-${tahun_uu}` -> label pengganti. Hanya pasangan
// dicabut-penuh (bukan diubah/amandemen bertingkat) per SUMBER.md.
// Chunk lama tetap dapat dicari (riwayat/peralihan) tapi diturunkan
// rankingnya dan diberi badge di UI — jawaban utama harus hukum berlaku.
export const SUPERSEDED = {
  '1-1946': 'UU No. 1 Tahun 2023', // KUHP lama (WvS) -> KUHP baru
  '8-1981': 'UU No. 20 Tahun 2025', // KUHAP lama -> KUHAP baru
  '36-2009': 'UU No. 17 Tahun 2023', // Kesehatan lama -> omnibus kesehatan
  '6-2018': 'UU No. 17 Tahun 2023', // Pedoman kesehatan -> idem
}

// ---- 3. Intent pertanyaan -> penanda normatif di teks pasal ----
// Regex pada query -> kata penanda + bobot flat (bukan IDF — penanda
// ini umum secara disengaja, tapi tetap jadi bukti konteks kuat).
export const INTENTS = [
  [/hukum|sanksi|ancaman|dihukum|konsekuensi|akibat/i,
    ['dipidana', 'denda', 'penjara', 'kurungan'], 0.16],
  [/apa itu|definisi|maksud|pengertian|arti/i,
    ['yang dimaksud', 'adalah'], 0.12],
  [/boleh|dapatkah|bolehkah|diperbolehkan|sah/i,
    ['dapat', 'boleh', 'diperbolehkan'], 0.12],
  [/dilarang|larangan|terlarang|ilegal|haram/i,
    ['dilarang', 'tidak boleh'], 0.16],
  [/syarat|prasyarat|ketentuan|prosedur|tata cara|cara/i,
    ['syarat', 'ketentuan', 'tata cara'], 0.10],
  [/kapan|bilamana|kondisi|keadaan/i,
    ['dalam hal', 'apabila'], 0.10],
  [/siapa|pelaku|subjek|pihak/i,
    ['setiap orang', 'pelaku'], 0.10],
]
