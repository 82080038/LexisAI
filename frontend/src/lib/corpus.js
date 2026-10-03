// Loader korpus: unduh manifest + file per-UU, delta-update via sha256,
// simpan di IndexedDB, bangun index vektor di memori.

import { idbGet, idbSet, idbGetAllKeys, idbDelete } from './db'

// Basis URL korpus: default file statis di app; produksi bisa arahkan ke
// HuggingFace Datasets (mis. https://huggingface.co/datasets/<user>/<repo>/resolve/main/)
export const CORPUS_BASE =
  import.meta.env.VITE_CORPUS_BASE?.replace(/\/$/, '') || '/data'

let index = null // {vectors: Float32Array (N*dim, L2-normalized), chunks: [...], dim, version}

function b64ToInt8(b64) {
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return new Int8Array(u8.buffer)
}

async function fetchManifest() {
  const res = await fetch(`${CORPUS_BASE}/manifest.json`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`manifest.json: HTTP ${res.status}`)
  return res.json()
}

async function fetchDocFile(doc) {
  const res = await fetch(`${CORPUS_BASE}/${doc.file}`)
  if (!res.ok) throw new Error(`${doc.file}: HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  if (hex !== doc.sha256)
    throw new Error(`${doc.file}: sha256 tidak cocok (unduhan korup?)`)
  return JSON.parse(new TextDecoder().decode(buf))
}

/**
 * Muat korpus ke memori. onProgress({phase, done, total, label}).
 * Hanya mengunduh file yang sha256-nya berubah (delta update per-UU).
 */
export async function loadCorpus(onProgress = () => {}) {
  onProgress({ phase: 'manifest', label: 'Memeriksa versi korpus…' })
  const manifest = await fetchManifest()
  const want = new Map(manifest.docs.map((d) => [d.key, d]))

  // Buang dokumen yang sudah tidak ada di manifest (UU dihapus dari korpus)
  const cachedKeys = await idbGetAllKeys('docs')
  let removed = 0
  for (const k of cachedKeys) {
    if (!want.has(k)) {
      await idbDelete('docs', k)
      removed++
    }
  }

  // Tentukan file yang perlu diunduh: belum ada atau sha256 beda
  const toFetch = []
  for (const doc of manifest.docs) {
    const cached = await idbGet('docs', doc.key)
    if (!cached || cached.sha256 !== doc.sha256) toFetch.push(doc)
  }
  const totalBytes = toFetch.reduce((a, d) => a + d.bytes, 0)
  let doneBytes = 0

  for (const doc of toFetch) {
    onProgress({
      phase: 'download',
      label: `Unduh ${doc.key}…`,
      done: doneBytes,
      total: totalBytes,
    })
    const payload = await fetchDocFile(doc)
    await idbSet('docs', doc.key, { sha256: doc.sha256, payload })
    doneBytes += doc.bytes
    onProgress({
      phase: 'download',
      label: `Unduh ${doc.key}…`,
      done: doneBytes,
      total: totalBytes,
    })
  }

  // Bangun index vektor di memori dari cache (offline-friendly)
  onProgress({ phase: 'build', label: 'Membangun index pencarian…' })
  const dim = manifest.dim
  const chunks = []
  const vecs = []
  let n = 0
  for (const doc of manifest.docs) {
    const cached = await idbGet('docs', doc.key)
    if (!cached) throw new Error(`${doc.key} hilang dari cache`)
    const { payload } = cached
    const raw = b64ToInt8(payload.vec_b64)
    const scale = payload.vec_scale
    for (const c of payload.chunks) {
      const citation = `UU No. ${payload.nomor_uu} Tahun ${payload.tahun_uu}` +
        (c.bab ? `, ${c.bab}` : '') +
        `, Pasal ${c.pasal}` +
        (c.ayat ? ` ayat (${c.ayat})` : '')
      chunks.push({
        citation,
        pasal: c.pasal,
        ayat: c.ayat,
        bab: c.bab,
        text: c.text,
        tentang: payload.tentang,
        nomor_uu: payload.nomor_uu,
        tahun_uu: payload.tahun_uu,
      })
    }
    // dequantize + normalisasi L2 per baris
    const f32 = new Float32Array(raw.length)
    for (let r = 0; r < payload.chunks.length; r++) {
      let norm = 0
      const base = r * dim
      for (let j = 0; j < dim; j++) {
        const v = raw[base + j] * scale
        f32[base + j] = v
        norm += v * v
      }
      norm = Math.sqrt(norm) || 1
      for (let j = 0; j < dim; j++) f32[base + j] /= norm
    }
    vecs.push(f32)
    n += payload.chunks.length
  }

  const vectors = new Float32Array(n * dim)
  let off = 0
  for (const f32 of vecs) {
    vectors.set(f32, off)
    off += f32.length
  }

  index = { vectors, chunks, dim, version: manifest.version }
  await idbSet('meta', 'corpus_version', manifest.version)
  onProgress({
    phase: 'ready',
    label: `${n.toLocaleString('id-ID')} pasal siap`,
    removed,
    downloaded: toFetch.length,
  })
  return index
}

export function getIndex() {
  return index
}

/** Hitung ulang index dari cache tanpa jaringan (mode offline penuh). */
export async function loadFromCacheOnly() {
  const version = await idbGet('meta', 'corpus_version')
  const keys = await idbGetAllKeys('docs')
  if (!version || keys.length === 0) return null
  // Bangun ulang tanpa manifest: pakai urutan key tersimpan
  const dim = 384
  const chunks = []
  const vecs = []
  let n = 0
  for (const k of keys.sort()) {
    const cached = await idbGet('docs', k)
    if (!cached) continue
    const { payload } = cached
    const raw = b64ToInt8(payload.vec_b64)
    const f32 = new Float32Array(raw.length)
    for (let r = 0; r < payload.chunks.length; r++) {
      let norm = 0
      const base = r * dim
      for (let j = 0; j < dim; j++) {
        const v = raw[base + j] * payload.vec_scale
        f32[base + j] = v
        norm += v * v
      }
      norm = Math.sqrt(norm) || 1
      for (let j = 0; j < dim; j++) f32[base + j] /= norm
    }
    for (const c of payload.chunks) {
      chunks.push({
        citation: `UU No. ${payload.nomor_uu} Tahun ${payload.tahun_uu}` +
          (c.bab ? `, ${c.bab}` : '') +
          `, Pasal ${c.pasal}` +
          (c.ayat ? ` ayat (${c.ayat})` : ''),
        pasal: c.pasal,
        ayat: c.ayat,
        bab: c.bab,
        text: c.text,
        tentang: payload.tentang,
        nomor_uu: payload.nomor_uu,
        tahun_uu: payload.tahun_uu,
      })
    }
    vecs.push(f32)
    n += payload.chunks.length
  }
  const vectors = new Float32Array(n * dim)
  let off = 0
  for (const f32 of vecs) {
    vectors.set(f32, off)
    off += f32.length
  }
  index = { vectors, chunks, dim, version }
  return index
}
