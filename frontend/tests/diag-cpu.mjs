// Diagnosa tier CPU: load pipeline + generate nyata (verifikasi end-to-end)
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext()).newPage()
page.on('response', (r) => {
  if (r.status() === 404) console.log('[404]', r.url().slice(0, 160))
})

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('textarea:not([disabled])', { timeout: 120000 })
console.log('boot OK, memuat model CPU (~512MB unduhan pertama)…')

const res = await page.evaluate(async () => {
  const ser = (e) =>
    JSON.stringify(e, Object.getOwnPropertyNames(e || {})).slice(0, 600)
  try {
    const { pipeline, env, TextStreamer } = await import(
      'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3'
    )
    env.allowLocalModels = false
    const gen = await pipeline(
      'text-generation',
      'onnx-community/Qwen2.5-0.5B-Instruct',
      { dtype: 'q4', device: 'wasm' },
    )
    let acc = ''
    const streamer = new TextStreamer(gen.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (t) => (acc += t),
    })
    const t0 = performance.now()
    await gen(
      [
        { role: 'system', content: 'Anda asisten hukum Indonesia.' },
        { role: 'user', content: 'Apa itu korupsi? Jawab satu kalimat.' },
      ],
      {
        max_new_tokens: 48,
        do_sample: false,
        streamer,
        return_full_text: false,
      },
    )
    const ms = Math.round(performance.now() - t0)
    return `OK ${ms}ms -> ${acc.slice(0, 300)}`
  } catch (e) {
    return 'FAIL: ' + ser(e)
  }
})
console.log('RESULT:', res)
await browser.close()
