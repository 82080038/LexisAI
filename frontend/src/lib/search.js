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
