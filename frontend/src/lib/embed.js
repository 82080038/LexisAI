// Embedding query di browser — model & hasil setara ingestion
// (all-MiniLM-L6-v2, mean-pooling + normalisasi), via ONNX WASM.

// Lazy via shared tjs.js — model embed diunduh sekali dari CDN
// HuggingFace lalu di-cache browser.
import { getTjs } from './tjs'

let embedderPromise = null

export function getEmbedder(onProgress) {
  if (!embedderPromise) {
    embedderPromise = getTjs()
      .then(({ pipeline }) =>
        pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
          dtype: 'q8',
          progress_callback: (p) => {
            if (p.status === 'progress' && p.total) {
              onProgress?.({
                file: p.file,
                loaded: p.loaded,
                total: p.total,
              })
            }
          },
        }),
      )
      .catch((e) => {
        // Jangan cache rejection — error transient (mis. jaringan putus
        // saat unduh model) harus bisa di-retry pada panggilan berikutnya.
        embedderPromise = null
        throw e
      })
  }
  return embedderPromise
}

/** Kembalikan vektor Float32Array ter-normalisasi L2 untuk satu query. */
export async function embedQuery(text, onProgress) {
  const fn = await getEmbedder(onProgress)
  const out = await fn(text, { pooling: 'mean', normalize: true })
  return new Float32Array(out.data)
}

/**
 * Embedding banyak teks sekaligus (batch) — jauh lebih cepat dari loop
 * embedQuery untuk ekstraksi kalimat. Kembalikan array Float32Array.
 */
export async function embedBatch(texts, onProgress) {
  const fn = await getEmbedder(onProgress)
  const out = await fn(texts, { pooling: 'mean', normalize: true })
  const dim = out.dims[out.dims.length - 1]
  const flat = out.data instanceof Float32Array ? out.data : new Float32Array(out.data)
  return texts.map((_, i) => flat.slice(i * dim, (i + 1) * dim))
}
