// Pencarian cosine similarity top-k atas index di memori.
// Index.vectors sudah L2-normalized; query dinormalisasi saat embed,
// jadi cukup dot product.

export function topK(index, queryVec, k = 5) {
  const { vectors, chunks, dim } = index
  const n = chunks.length
  const scores = new Float32Array(n)
  for (let r = 0; r < n; r++) {
    const base = r * dim
    let s = 0
    for (let j = 0; j < dim; j++) s += vectors[base + j] * queryVec[j]
    scores[r] = s
  }

  // partial sort untuk top-k (k kecil -> tidak perlu sort penuh)
  const idx = new Uint32Array(n)
  for (let i = 0; i < n; i++) idx[i] = i
  const top = Array.from(idx).sort((a, b) => scores[b] - scores[a]).slice(0, k)

  return top.map((i) => ({
    ...chunks[i],
    score: scores[i],
    distance: 1 - scores[i],
  }))
}
