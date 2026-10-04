// E2E cepat untuk rantai retrieval penuh: boot -> embed query (MiniLM, ~25MB)
// -> topK cosine -> ekspansi graf -> render jawaban + kartu sitasi.
// Bobot LLM diblok agar generateAnswer* gagal cepat -> jalur retrieval-only
// tetap membuktikan retrieval + rendering sitasi bekerja ujung-ke-ujung.
//
// Pakai: node tests/e2e-retrieval.mjs <url> [profile-dir]
import { chromium } from 'playwright'

const URL = process.argv[2] || 'http://localhost:4173/'
const PROFILE = process.argv[3] || '/tmp/lexisai-e2e-retrieval'
const report = { errors: [], notes: [] }
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
})
const page = ctx.pages()[0] || (await ctx.newPage())
page.on('pageerror', (e) =>
  report.errors.push(`pageerror: ${e.message.slice(0, 200)}`),
)

// Blok hanya bobot ONNX LLM (Qwen) — config/tokenizer & embedder MiniLM
// tetap lolos; pipeline text-generation gagal cepat -> retrieval-only.
await page.route('**/Qwen2.5-0.5B-Instruct/resolve/main/onnx/**', (r) => r.abort())

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('textarea:not([disabled])', { timeout: 120000 })
  report.notes.push('boot ready')

  // -- query #1: tipikor (UU 31/1999 diharapkan di hasil atas) --
  await page.fill('textarea', 'Apa sanksi pidana korupsi?')
  await page.press('textarea', 'Enter')
  await page.waitForFunction(
    () =>
      /dasar hukum|gagal:/i.test(document.body.innerText),
    undefined,
    { timeout: 180000 }, // embed ~25MB unduh pertama + retrieval
  )
  let body = await page.locator('body').innerText()
  const m = body.match(/dasar hukum \((\d+)\)/i)
  report.notes.push(`sources: ${m ? m[1] : 'TIDAK ADA'}`)
  if (!m) throw new Error('tidak ada kartu Dasar hukum')
  if (body.includes('retrieval-only')) report.notes.push('mode: retrieval-only (LLM diblok — sesuai desain)')

  // Ekspansi graf: badge "rujukan" muncul bila pasal dirujuk ikut masuk
  const rujukan = (body.match(/rujukan/gi) || []).length
  report.notes.push(`badge rujukan (graph expansion): ${rujukan}`)

  // Kartu sitasi pertama menyebut UU tipikor?
  const card = page.locator('button', { hasText: 'UU No.' }).first()
  await card.click()
  await page.waitForTimeout(300)
  const cardTxt = await page.locator('.font-serif').last().innerText()
  report.notes.push(`sitasi #1: ${(await card.innerText()).replace(/\n/g, ' ').slice(0, 90)}`)
  report.notes.push(`isi pasal: ${cardTxt.slice(0, 80)}…`)
  if (!cardTxt.trim()) report.errors.push('kartu sitasi kosong')

  // -- query #2: KUHAP (UU 8/1981) — memastikan retrieval bukan fluke --
  await page.fill('textarea', 'Kapan penyidik boleh menahan tersangka?')
  await page.press('textarea', 'Enter')
  await page.waitForFunction(
    () =>
      (document.body.innerText.match(/dasar hukum \(/gi) || []).length >= 2,
    undefined,
    { timeout: 90000 },
  )
  body = await page.locator('body').innerText()
  const hits = body.match(/UU No\. \d+ Tahun \d+/g) || []
  report.notes.push(`query#2 sitasi: ${[...new Set(hits)].slice(0, 5).join(' | ')}`)
} catch (e) {
  report.errors.push(`FATAL: ${e.message.slice(0, 300)}`)
} finally {
  await ctx.close()
}

console.log('===== NOTES =====')
report.notes.forEach((n) => console.log(' •', n))
console.log('===== ERRORS =====')
report.errors.forEach((n) => console.log(' X', n))
process.exit(report.errors.length ? 1 : 0)
