// LLM lokal di GPU user via WebLLM (MLC). Bobot model diunduh sekali dari
// CDN HuggingFace lalu di-cache — zero biaya server.

import { SYSTEM_PROMPT, buildUserPrompt } from './prompt'

// Lazy import: web-llm (WebGPU runtime) hanya diunduh saat generate pertama.
export const LLM_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'

let worker = null
let enginePromise = null

let gpuChecked = null

/**
 * Cek WebGPU benar-benar bisa dipakai (adapter ada), bukan sekadar API ada.
 * 'gpu' in navigator saja menipu: headless/browser tanpa GPU tetap true.
 */
export async function webgpuAvailable() {
  if (gpuChecked === null) {
    try {
      gpuChecked =
        typeof navigator !== 'undefined' &&
        'gpu' in navigator &&
        !!(await navigator.gpu.requestAdapter())
    } catch {
      gpuChecked = false
    }
  }
  return gpuChecked
}

async function getEngine(onProgress) {
  if (!enginePromise) {
    enginePromise = import('@mlc-ai/web-llm')
      .then(({ CreateWebWorkerMLCEngine }) => {
        worker = new Worker(new URL('../webllm-worker.js', import.meta.url), {
          type: 'module',
        })
        return CreateWebWorkerMLCEngine(worker, LLM_MODEL, {
          initProgressCallback: (report) => {
            onProgress?.({
              text: report.text,
              progress: report.progress,
            })
          },
        })
      })
      .catch((e) => {
        // Jangan cache rejection + matikan worker — retry harus mulai bersih.
        enginePromise = null
        worker?.terminate()
        worker = null
        throw e
      })
  }
  return enginePromise
}

/** Pemuatan model lebih awal (opsional, mis. setelah corpus siap). */
export async function preloadLLM(onProgress) {
  if (!(await webgpuAvailable())) return null
  return getEngine(onProgress)
}

/**
 * Generate jawaban streaming. onToken(accText) dipanggil tiap update.
 * Lempar Error bila WebGPU tidak didukung — caller jatuh ke retrieval-only.
 */
export async function generateAnswer(question, context, onProgress, onToken) {
  const engine = await getEngine(onProgress)
  const user = buildUserPrompt(question, context)

  const completion = await engine.chat.completions.create({
    stream: true,
    temperature: 0.1,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
  })

  let acc = ''
  for await (const chunk of completion) {
    const delta = chunk.choices?.[0]?.delta?.content || ''
    if (delta) {
      acc += delta
      onToken(acc)
    }
  }
  return acc
}
