// Embedding query di browser — model & hasil setara ingestion
// (all-MiniLM-L6-v2, mean-pooling + normalisasi), via ONNX WASM.

// Lazy import: transformers.js (ONNX runtime) hanya diunduh saat
// query pertama — tidak membebani bundle awal.
let embedderPromise = null

export function getEmbedder(onProgress) {
  if (!embedderPromise) {
    embedderPromise = import('@xenova/transformers').then(
      ({ pipeline, env }) => {
        // Model diunduh sekali dari CDN HuggingFace lalu di-cache browser.
        env.allowLocalModels = false
        return pipeline(
          'feature-extraction',
          'Xenova/all-MiniLM-L6-v2',
          {
            quantized: true,
            progress_callback: (p) => {
              if (p.status === 'progress' && p.total) {
                onProgress?.({
                  file: p.file,
                  loaded: p.loaded,
                  total: p.total,
                })
              }
            },
          },
        )
      },
    )
  }
  return embedderPromise
}

/** Kembalikan vektor Float32Array ter-normalisasi L2 untuk satu query. */
export async function embedQuery(text, onProgress) {
  const fn = await getEmbedder(onProgress)
  const out = await fn(text, { pooling: 'mean', normalize: true })
  return new Float32Array(out.data)
}
