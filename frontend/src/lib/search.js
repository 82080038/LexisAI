// Pencarian cosine similarity top-k atas index di memori.
// Index.vectors sudah L2-normalized; query dinormalisasi saat embed,
// jadi cukup dot product.
//
// Hybrid boost (pola Lexis+ AI checkpoint-1): rujukan eksplisit di query
// ("Pasal 2", "UU 31 Tahun 1999", alias dokumen seperti "UU ITE"/"KUHP")
// diberi skor tambahan. Penting: boost pasal di-SCOPE ke dokumen yang
// dirujuk — boost pasal global membanjiri top-k dengan "Pasal N" acak
// dari dokumen lain (terbukti di tests/smoke-sample.mjs).

import { SYNONYMS, stemVariants, INTENTS, SUPERSEDED } from './lexicon'

// Alias umum -> regex yang dicocokkan ke metadata `tentang` dokumen.
// Kata bagian frasa yang terlalu umum untuk jadi term grup — df-nya
// besar sehingga meracuni union-df; cocoknya sebagai frasa utuh saja.
const GENERIC_PARTS = new Set([
  'sama', 'jenis', 'lain', 'orang', 'dengan', 'kepada', 'dalam',
  'untuk', 'perkara', 'kata', 'segala', 'hal', 'yang', 'suatu',
])

const DOC_ALIASES = [
  // 'kuhp' netral -> kedua kodifikasi (tentang 'kuhp' & 'hukum pidana')
  [/\bkuhp\b|kitab undang.{0,5}undang hukum pidana/i, /hukum pidana|\bkuhp\b/i],
  // versi LAMA dirujuk eksplisit -> hanya dokumen lama yang di-scope
  [/\bkuhp\s+lama\b|wetboek|\bwvs\b|kuhp\s+1946/i, /kuhp lama|wetboek/i],
  [/\bkuhap\b|hukum acara pidana/i, /acara pidana/i],
  [/\bkuh\s?per(data)?\b/i, /perdata/i],
  [/\bite\b|transaksi elektronik/i, /informasi dan transaksi elektronik/i],
  [/\b(tipikor|korupsi|korup)\b/i, /korupsi/i],
  [/\bumkm\b/i, /usaha mikro/i],
  [/\b(cipta\s?kerja|omnibus)\b/i, /cipta kerja/i],
  [/\bperlindungan anak\b/i, /perlindungan anak/i],
  [/\bkdrt\b|kekerasan dalam rumah tangga/i, /rumah tangga/i],
  [/\btpks\b|kekerasan seksual/i, /kekerasan seksual/i],
]

// Kata umum yang tak layak jadi pencocok topik `tentang`.
const STOPWORDS = new Set(
  ('apa itu yang dan atau ke dari dalam pada untuk dengan adalah ini ' +
    'atas bawah serta juga dapat bisa tidak bukan tentang berapa bagaimana ' +
    'mengapa kapan siapa pasal uu undang nomor tahun ayat hukum pidana ' +
    'sanksi aturan peraturan pengaturan jelaskan maksud arti pengertian ' +
    'ketentuan mengatur diatur bagi terhadap oleh orang setiap mana saat')
    .split(' '),
)

/**
 * Parse rujukan eksplisit dari query: nomor pasal, nomor+tahun UU,
 * alias dokumen, dan kata topik yang mungkin ada di metadata `tentang`.
 */
function parseRefs(q) {
  const lc = ` ${q.toLowerCase()} `
  const mP = lc.match(/\bpasal\s+(\d+[a-z]?)\b/)
  const mU = lc.match(
    /\b(?:uu|undang[\s-]?undang)\s*(?:no\.?\s*|nomor\s*)?(\d+)\s*(?:tahun\s*(\d{4}))?/,
  )
  const aliasRes = []
  for (const [qRe, tRe] of DOC_ALIASES) if (qRe.test(lc)) aliasRes.push(tRe)
  // user menyebut versi lama secara eksplisit ("kuhp lama", "wvs")
  const lamaAlias = /\blama\b|wetboek|\bwvs\b|\b1946\b/.test(lc)
  const words = lc
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const sig = (w) => w.length > 3 && !STOPWORDS.has(w)
  // Ekspansi kamus digrup per KONSEP: kata query + sinonim + kandidat
  // dasar berimbuhan dalam SATU grup — chunk dinilai sekali per konsep
  // (bukan per varian), jadi "cabul" & "percabulan" tak menumpuk.
  const termGroups = []
  const phrases = []
  const sigWords = words.filter(sig)
  for (const w of sigWords) {
    const members = new Set([w, ...stemVariants(w)])
    for (const s of SYNONYMS[w] || []) {
      if (s.includes(' ')) {
        phrases.push(s)
        for (const part of s.split(' ')) {
          if (sig(part) && !GENERIC_PARTS.has(part)) members.add(part)
        }
      } else members.add(s)
    }
    termGroups.push([...members])
  }
  // Kunci sinonim multi-kata ("sesama jenis") dicari lewat bigram —
  // grup baru berisi komponen sinonimnya ("kelamin" — kata langka).
  for (let i = 0; i + 1 < words.length; i++) {
    const key = `${words[i]} ${words[i + 1]}`
    const members = new Set()
    for (const s of SYNONYMS[key] || []) {
      if (s.includes(' ')) {
        phrases.push(s)
        for (const part of s.split(' ')) {
          if (sig(part) && !GENERIC_PARTS.has(part)) members.add(part)
        }
      } else members.add(s)
    }
    if (members.size) termGroups.push([...members])
    // bigram berurutan non-stop — frasa multi-kata ("pelecehan seksual")
    // adalah bukti leksikal jauh lebih kuat dari kata tunggal
    if (sig(words[i]) && sig(words[i + 1])) phrases.push(key)
  }
  // Intent: konteks bentuk pertanyaan -> penanda normatif di teks.
  const intents = INTENTS.filter(([re]) => re.test(lc)).map(
    ([, markers, w]) => ({ markers, w }),
  )
  return {
    pasal: mP?.[1] ?? null,
    uu: mU?.[1] ?? null,
    tahun: mU?.[2] ?? null,
    aliasRes,
    lamaAlias,
    topicWords: sigWords, // kata asli — hanya untuk boost metadata `tentang`
    termGroups,
    phrases,
    intents,
  }
}

/**
 * Skor tambahan untuk satu chunk berdasar rujukan di query.
 * Doc-scope: kalau query menyebut dokumen tertentu (UU n/t atau alias),
 * boost pasal hanya berlaku penuh di dalam dokumen itu — mencegah
 * "Pasal N" dokumen lain ikut terangkat.
 */
function boostFor(chunk, refs) {
  const { pasal, uu, tahun, aliasRes, topicWords } = refs
  let b = 0
  const docMatch =
    (uu &&
      String(chunk.nomor_uu) === uu &&
      (!tahun || String(chunk.tahun_uu) === tahun)) ||
    aliasRes.some((re) => re.test(chunk.tentang || ''))

  if (docMatch) b += uu ? 0.2 : 0.15

  const pasalMatch = pasal && String(chunk.pasal) === pasal
  if (pasalMatch) {
    if (docMatch) b += 0.35
    else if (uu || aliasRes.length) b += 0.05
    else b += 0.3
  }

  // UU yang sudah dicabut penuh diturunkan — jawaban utama harus
  // hukum yang berlaku. Pengecualian: user merujuk dokumen lama
  // secara EKSPLISIT (UU n/t persis, atau alias 'lama'/'wvs').
  const supKey = `${chunk.nomor_uu}-${chunk.tahun_uu}`
  if (SUPERSEDED[supKey]) {
    const explicitOld =
      (uu && String(chunk.nomor_uu) === uu && tahun === String(chunk.tahun_uu)) ||
      (refs.lamaAlias && /lama|wetboek/i.test(chunk.tentang || ''))
    if (!explicitOld) b -= 0.3
  }

  // Demote chunk PENJELASAN saat user merujuk pasal eksplisit —
  // mereka minta norma, bukan meta-komentar.
  if (pasal && /PENJELASAN/i.test(chunk.bab || '')) b -= 0.15

  // Topik `tentang`: kata signifikan di query yang muncul di nama
  // dokumen (menolong query konseptual seperti "sanksi korupsi").
  const tentang = (chunk.tentang || '').toLowerCase()
  for (const w of topicWords) {
    if (tentang.includes(w)) {
      b += 0.08
      break // satu kata cukup — jangan ditumpuk
    }
  }
  return b
}

/**
 * Bobot IDF kuadratik untuk satu term: kata yang muncul di >5% korpus
 * dianggap umum dan tidak berharga (0); kata langka mendekati bobot
 * maksimum ~0.5 — cukup untuk mengangkat chunk tepat di atas noise
 * dense (~0.6) tanpa pernah menenggelamkan rujukan eksplisit.
 */
function idfWeight(df, n) {
  if (!df || df > n * 0.05) return 0
  const x = Math.log(n / df) / Math.log(n)
  return 0.5 * x * x
}

/**
 * Boost leksikal atas ISI chunk (BM25-lite): satu pass menghitung df
 * dan mask kecocokan semua term+frasa; skor kemudian dihitung per
 * chunk. Teks lowercase di-cache di index._lc (satu kali, ~20MB).
 * Chunk PENJELASAN dipotong 50% — norma harus mengalahkan meta-komentar.
 */
function buildLexBoost(index, refs) {
  const { chunks } = index
  const n = chunks.length
  const groups = refs.termGroups.slice(0, 32)
  const phrases = refs.phrases.slice(0, 32)
  const intents = refs.intents || []
  if (!groups.length && !phrases.length && !intents.length) return null
  if (!index._lc) index._lc = chunks.map((c) => c.text.toLowerCase())
  const lc = index._lc

  // Satu pass: df grup (union member) + df frasa + mask kecocokan.
  const gdf = new Int32Array(groups.length)
  const pdf = new Int32Array(phrases.length)
  const gm = new Uint32Array(n)
  const pm = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    const t = lc[i]
    for (let j = 0; j < groups.length; j++) {
      for (const term of groups[j]) {
        if (t.includes(term)) {
          gm[i] |= 1 << j
          gdf[j]++
          break // grup dinilai SEKALI per konsep — varian tak menumpuk
        }
      }
    }
    for (let j = 0; j < phrases.length; j++) {
      if (t.includes(phrases[j])) {
        pm[i] |= 1 << j
        pdf[j]++
      }
    }
  }
  const wg = groups.map((_, j) => idfWeight(gdf[j], n))
  // Frasa diskalakan IDF (×1.4, cap 0.7): frasa df=1 ("sesama kelamin")
  // adalah bukti paling kuat yang ada — jauh di atas term tunggal.
  const wp = phrases.map((_, j) => Math.min(0.7, 1.4 * idfWeight(pdf[j], n)))
  // Penanda intent dinilai flat — umum secara disengaja, tapi bukti
  // konteks: chunk yang memuat "dipidana/denda" saat user bertanya
  // "hukuman" lebih menjawab ketimbang yang tidak.
  const intentHits = new Uint8Array(n)
  for (const { markers } of intents) {
    for (let i = 0; i < n; i++) {
      for (const mk of markers) {
        if (lc[i].includes(mk)) {
          intentHits[i] = 1
          break
        }
      }
    }
  }
  const intentW = intents.length ? intents[0].w : 0
  return (i) => {
    let b = intentHits[i] ? intentW : 0
    let m = gm[i]
    while (m) {
      const j = 31 - Math.clz32(m)
      b += wg[j]
      m &= m - 1
    }
    m = pm[i]
    while (m) {
      const j = 31 - Math.clz32(m)
      b += wp[j]
      m &= m - 1
    }
    if (b && /PENJELASAN/i.test(chunks[i].bab || '')) b *= 0.5
    return b
  }
}

export function topK(index, queryVec, k = 5, queryText = '') {
  const { vectors, chunks, dim } = index
  const n = chunks.length
  const refs = queryText ? parseRefs(queryText) : null
  const lex = refs ? buildLexBoost(index, refs) : null
  const scores = new Float32Array(n)
  for (let r = 0; r < n; r++) {
    const base = r * dim
    let s = 0
    for (let j = 0; j < dim; j++) s += vectors[base + j] * queryVec[j]
    scores[r] =
      s + (refs ? boostFor(chunks[r], refs) : 0) + (lex ? lex(r) : 0)
  }

  // partial sort untuk top-k (k kecil -> tidak perlu sort penuh)
  const idx = new Uint32Array(n)
  for (let i = 0; i < n; i++) idx[i] = i
  const top = Array.from(idx).sort((a, b) => scores[b] - scores[a]).slice(0, k)

  return top.map((i) => ({
    ...chunks[i],
    score: scores[i],
    distance: 1 - scores[i],
    // bukti leksikal mentah — dipakai UI untuk caveat bila kosong
    lexScore: lex ? lex(i) : 0,
  }))
}

/**
 * Perluas hasil top-k via graf rujukan: pasal yang dirujuk/merujuk ke
 * hit terbaik ikut masuk konteks (bukan pengganti hasil vektor).
 * Maks `maxExtra` chunk tambahan, ditandai `expanded: true`.
 */
export function expandWithGraph(index, hits, maxExtra = 3) {
  const graph = index.graph
  if (!graph?.out || hits.length === 0) return hits

  const seen = new Set(hits.map((h) => h.node))
  const extra = []
  for (const h of hits) {
    if (extra.length >= maxExtra) break
    for (const tgt of graph.out[h.node] || []) {
      if (extra.length >= maxExtra) break
      if (seen.has(tgt)) continue
      const ci = graph.byNode[tgt]
      if (ci === undefined) continue // node doc-level (tanpa #pasal) / tidak ada di korpus
      seen.add(tgt)
      extra.push({
        ...index.chunks[ci],
        score: h.score * 0.85, // diturunkan agar selalu di bawah hit asli
        distance: 1 - h.score * 0.85,
        expanded: true,
      })
    }
  }
  return [...hits, ...extra]
}
