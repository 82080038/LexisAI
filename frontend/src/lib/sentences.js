// Ekstraksi kalimat relevan dari teks pasal — pola "strict quote-only"
// (private-doc-chat): jawaban berupa kalimat verbatim terbaik, anti-
// halusinasi by construction karena bukan hasil generasi.

/**
 * Split teks pasal menjadi unit kalimat sadar format hukum:
 * - item ayat "(n)" dan sub-item "a." dipertahankan sebagai unit
 * - batas kalimat: .!? diikuti spasi + huruf/kurung
 * - fragmen terlalu pendek digabung ke unit sebelumnya
 */
export function splitSentences(text) {
  const units = []
  // Pisah dulu pada penanda ayat "(1)" — tiap ayat jadi konteks mandiri
  for (const ayat of text.split(/(?=\(\d+\)\s)/)) {
    // Di dalam ayat, pisah sub-item huruf ("a. ...") agar tiap butir
    // bisa dinilai terpisah — sanksi sering tercantum sebagai sub-item.
    const parts = []
    let buf = ''
    for (const seg of ayat.split(/(?<=[;.:?!])\s+(?=[a-z]\.\s)/)) {
      buf = buf ? `${buf} ${seg}` : seg
      if (/^[a-z]\.\s/.test(seg.trimStart()) || buf === seg) parts.push(buf), (buf = '')
    }
    if (buf) parts.push(buf)

    for (const part of parts.length ? parts : [ayat]) {
      for (const s of part.split(/(?<=[.!?])\s+(?=["'(\da-zA-ZÀ-Þ])/)) {
        const x = s.trim()
        if (!x) continue
        if (x.length < 60 && units.length) {
          units[units.length - 1] += ` ${x}` // gabung fragmen pendek
        } else if (x.length >= 60) {
          units.push(x)
        }
      }
    }
  }
  return units
}

/**
 * Pilih kalimat paling relevan dengan query dari teks pasal.
 * sentVecs: hasil embedBatch atas units; queryVec: vektor query.
 * Kembalikan array {s, score} terurut menurun, dibatasi max.
 */
export function rankSentences(units, sentVecs, queryVec, max = 2) {
  const scored = units.map((s, i) => {
    const v = sentVecs[i]
    let dot = 0
    for (let j = 0; j < v.length; j++) dot += v[j] * queryVec[j]
    return { s, score: dot }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, max)
}
