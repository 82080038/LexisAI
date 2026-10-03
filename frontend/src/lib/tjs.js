// Shared lazy import transformers.js v3 dari CDN jsDelivr.
// @huggingface/transformers = penerus @xenova/transformers (API sama,
// onnxruntime-web lebih baru — wajib untuk model onnx-community).
// Satu promise untuk semua pemakai (embedder + LLM CPU) — diunduh
// hanya saat pertama dibutuhkan, lolos dari bundling Vite.

const TRANSFORMERS_URL =
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3'

let tjsPromise = null

export function getTjs() {
  if (!tjsPromise) {
    tjsPromise = import(/* @vite-ignore */ TRANSFORMERS_URL).then((mod) => {
      mod.env.allowLocalModels = false
      return mod
    })
  }
  return tjsPromise
}
