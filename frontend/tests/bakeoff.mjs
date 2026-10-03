// Bake-off model CPU: prompt hukum Indonesia identik ke tiap kandidat,
// bandingkan kualitas output (kesesuaian konteks + bahasa + sitasi).
import { chromium } from 'playwright'

const ctx = await chromium.launchPersistentContext('/tmp/lexisai-e2e-profile', {
  headless: true,
})
const page = ctx.pages()[0] || (await ctx.newPage())
page.on('response', (r) => {
  if (r.status() === 404) console.log('[404]', r.url().slice(-60))
})

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('textarea:not([disabled])', { timeout: 120000 })
console.log('boot OK')

// Prompt tetap: konteks pasal tipikor asli + pertanyaan user
const CONTEXT = `[UU No. 31 Tahun 1999, Pasal 2 ayat (1)]
Setiap orang yang secara melawan hukum melakukan perbuatan memperkaya diri sendiri atau orang lain atau suatu korporasi yang dapat merugikan keuangan negara atau perekonomian negara, dipidana dengan pidana penjara seumur hidup atau pidana penjara paling singkat 4 (empat) tahun dan paling lama 20 (dua puluh) tahun dan denda paling sedikit Rp.200.000.000,00 (dua ratus juta rupiah) dan paling banyak Rp.1.000.000.000,00 (satu miliar rupiah).`
const QUESTION = 'Berapa hukuman minimal untuk pidana korupsi?'
const SYSTEM =
  'Anda asisten hukum Indonesia. Jawab HANYA dari konteks, sebutkan pasal sumbernya, pakai Bahasa Indonesia formal, akhiri dengan disclaimer singkat.'

const MODELS = [
  'onnx-community/gemma-3-1b-it-ONNX',
  'onnx-community/Qwen2.5-1.5B-Instruct',
]

for (const model of MODELS) {
  const res = await page.evaluate(
    async ({ model, CONTEXT, QUESTION, SYSTEM }) => {
      const ser = (e) => String(e?.message || e).slice(0, 300)
      try {
        const { pipeline, env, TextStreamer } = await import(
          'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3'
        )
        env.allowLocalModels = false
        const gen = await pipeline('text-generation', model, {
          dtype: 'q8',
          device: 'wasm',
        })
        let acc = ''
        const streamer = new TextStreamer(gen.tokenizer, {
          skip_prompt: true,
          skip_special_tokens: true,
          callback_function: (t) => (acc += t),
        })
        const t0 = performance.now()
        await gen(
          [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: `KONTEKS:\n${CONTEXT}\n\nPERTANYAAN:\n${QUESTION}` },
          ],
          {
            max_new_tokens: 150,
            do_sample: false,
            streamer,
            return_full_text: false,
          },
        )
        return { ok: true, ms: Math.round(performance.now() - t0), text: acc }
      } catch (e) {
        return { ok: false, err: ser(e) }
      }
    },
    { model, CONTEXT, QUESTION, SYSTEM },
  )
  console.log(`\n===== ${model} =====`)
  if (res.ok) {
    console.log(`waktu: ${res.ms}ms`)
    console.log(res.text)
  } else {
    console.log('FAIL:', res.err)
  }
}
await ctx.close()
