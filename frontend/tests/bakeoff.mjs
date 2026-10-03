// Bake-off model CPU: prompt hukum Indonesia identik ke tiap kandidat,
// bandingkan kualitas output (kesesuaian konteks + bahasa + sitasi).
// Tiap model dapat konteks browser SENDIRI — model 1B-class perlu ~1-1.6GB
// heap WASM; muat dua model di satu page -> OOM/error numerik onnxruntime.
import { chromium } from 'playwright'

// Prompt tetap: konteks pasal tipikor asli + pertanyaan user
const CONTEXT = `[UU No. 31 Tahun 1999, Pasal 2 ayat (1)]
Setiap orang yang secara melawan hukum melakukan perbuatan memperkaya diri sendiri atau orang lain atau suatu korporasi yang dapat merugikan keuangan negara atau perekonomian negara, dipidana dengan pidana penjara seumur hidup atau pidana penjara paling singkat 4 (empat) tahun dan paling lama 20 (dua puluh) tahun dan denda paling sedikit Rp.200.000.000,00 (dua ratus juta rupiah) dan paling banyak Rp.1.000.000.000,00 (satu miliar rupiah).`
const QUESTION = 'Berapa hukuman minimal untuk pidana korupsi?'
const SYSTEM =
  'Anda asisten hukum Indonesia. Jawab HANYA dari konteks, sebutkan pasal sumbernya, pakai Bahasa Indonesia formal, akhiri dengan disclaimer singkat.'

const MODELS = [
  // gemma q8 FAIL 11525720 — coba q4 (file ada, q8 mungkin issue onnxruntime)
  { model: 'onnx-community/gemma-3-1b-it-ONNX', dtype: 'q4' },
  // q8 halusinasi — coba q4 (file lebih kecil, kualitas serupa)
  { model: 'onnx-community/Qwen2.5-1.5B-Instruct', dtype: 'q4' },
  { model: 'onnx-community/Llama-3.2-1B-Instruct-ONNX', dtype: 'q8' },
]

for (const { model, dtype } of MODELS) {
  const ctx = await chromium.launchPersistentContext(
    '/tmp/lexisai-e2e-profile',
    { headless: true },
  )
  const page = ctx.pages()[0] || (await ctx.newPage())
  page.on('response', (r) => {
    if (r.status() === 404) console.log('[404]', r.url().slice(-60))
  })
  await page.goto('about:blank')
  const res = await page.evaluate(
    async ({ model, dtype, CONTEXT, QUESTION, SYSTEM }) => {
      try {
        const { pipeline, env, TextStreamer } = await import(
          'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3'
        )
        env.allowLocalModels = false
        const gen = await pipeline('text-generation', model, {
          dtype,
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
        return {
          ok: false,
          err: `${e.name || ''} ${e.message || e}`.slice(0, 400),
          stack: String(e.stack || '').slice(0, 400),
        }
      }
    },
    { model, dtype, CONTEXT, QUESTION, SYSTEM },
  )
  console.log(`\n===== ${model} (dtype ${dtype}) =====`)
  if (res.ok) {
    console.log(`waktu: ${res.ms}ms`)
    console.log(res.text)
  } else {
    console.log('FAIL:', res.err)
    console.log(res.stack)
  }
  await ctx.close()
}
