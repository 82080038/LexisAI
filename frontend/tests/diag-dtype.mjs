// Cek dtype -> file .onnx yang di-resolve transformers.js v3 (tanpa unduh penuh)
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext()).newPage()
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('textarea:not([disabled])', { timeout: 120000 })

for (const dtype of ['q8', 'int8', 'q4']) {
  const res = await page.evaluate(async (dt) => {
    const { pipeline, env } = await import(
      'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3'
    )
    env.allowLocalModels = false
    const seen = []
    try {
      await Promise.race([
        pipeline('text-generation', 'onnx-community/Qwen2.5-0.5B-Instruct', {
          dtype: dt,
          device: 'wasm',
          progress_callback: (p) => p.file && seen.push(p.file),
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000)),
      ])
      return { dt, status: 'loaded', seen }
    } catch (e) {
      return { dt, status: 'cut', err: String(e).slice(0, 150), seen: [...new Set(seen)] }
    }
  }, dtype)
  console.log(dtype, '->', JSON.stringify(res.seen), res.status, res.err || '')
}
await browser.close()
