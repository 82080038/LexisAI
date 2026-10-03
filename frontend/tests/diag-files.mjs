// Deteksi file .onnx yang diminta transformers.js untuk berbagai
// kombinasi opsi — bail sebelum unduh penuh (cek via progress event / fetch URL).
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext()).newPage()

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('textarea:not([disabled])', { timeout: 120000 })

const candidates = [
  { model: 'onnx-community/Qwen2.5-0.5B-Instruct', opts: { dtype: 'q4', model_file_name: 'model' } },
  { model: 'onnx-community/Qwen2.5-0.5B-Instruct', opts: { dtype: 'q4f16', model_file_name: 'model' } },
  { model: 'onnx-community/Qwen2.5-0.5B-Instruct', opts: { dtype: 'int8', model_file_name: 'model' } },
  { model: 'Xenova/TinyLlama-1.1B-Chat-v1.0', opts: { quantized: true } },
]

for (const c of candidates) {
  const res = await page.evaluate(async ({ model, opts }) => {
    const { pipeline, env } = await import(
      'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2'
    )
    env.allowLocalModels = false
    const seen = []
    try {
      await Promise.race([
        pipeline('text-generation', model, {
          ...opts,
          progress_callback: (p) => {
            if (p.file) seen.push(p.file)
          },
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout-15s')), 15000)),
      ])
      return { model, opts, status: 'loaded', seen }
    } catch (e) {
      return { model, opts, status: 'fail', err: String(e.message || e).slice(0, 220), seen }
    }
  }, c)
  console.log(JSON.stringify(res, null, 1))
}
await browser.close()
