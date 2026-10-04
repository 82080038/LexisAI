// E2E generasi LLM nyata di browser: boot -> query -> unduh bobot CPU
// (Qwen2.5-0.5B ~550MB) -> token pertama -> jawaban lengkap + meta label.
// LAMBAT di headless: unduh bisa ~30mnt, generate ~0.3-1 tok/s — jalankan
// di background dan pantau.
//
// Pakai: node tests/e2e-llm.mjs <url> [profile-dir]
import { chromium } from 'playwright'

const URL = process.argv[2] || 'http://localhost:4173/'
const PROFILE = process.argv[3] || '/tmp/lexisai-e2e-profile'
const report = { errors: [], notes: [] }
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
})
const page = ctx.pages()[0] || (await ctx.newPage())
page.on('crash', () => report.errors.push('PAGE CRASH'))
page.on('pageerror', (e) =>
  report.errors.push(`pageerror: ${e.message.slice(0, 200)}`),
)

const t0 = Date.now()
const stamp = () => `${((Date.now() - t0) / 60000).toFixed(1)}mnt`

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  // SW precache (registerType 'prompt') menyajikan bundle LAMA di profil
  // persisten — unregister + reload agar selalu mengeksekusi build terbaru.
  await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((r) => r.unregister()))
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('textarea:not([disabled])', { timeout: 240000 })
  report.notes.push(`boot ready (${stamp()})`)

  await page.fill('textarea', 'Apa sanksi pidana korupsi?')
  await page.press('textarea', 'Enter')
  report.notes.push('query sent — menunggu token pertama…')

  // Token pertama -> pesan assistant + kartu 'dasar hukum (N)' muncul.
  // waitForFunction berjalan DI DALAM page — tetap menunggu walau main
  // thread sibuk init session ONNX (bisa puluhan detik-menit di headless).
  const firstToken = await page
    .waitForFunction(
      () => /dasar hukum \(|gagal:/i.test(document.body.innerText),
      undefined,
      { timeout: 2700000 }, // 45mnt: unduh + init session + prefill
    )
    .then(() => true)
    .catch(() => false)
  if (!firstToken) throw new Error('token pertama tidak muncul dalam 45 menit')
  report.notes.push(`TOKEN PERTAMA (${stamp()})`)

  // Jawaban lengkap -> meta 'lokal · X ms' muncul di bawah gelembung.
  const done = await page
    .waitForFunction(
      () => /lokal · [\d.,]+ ms|retrieval-only/i.test(document.body.innerText),
      undefined,
      { timeout: 1500000 }, // +25mnt untuk sisa generate (WASM lambat)
    )
    .then(() => true)
    .catch(() => false)

  const body = await page.locator('body').innerText()
  const meta = body.match(/lokal · [\d.,]+ ms|retrieval-only/i)?.[0]
  if (done) {
    report.notes.push(`JAWABAN LENGKAP (${stamp()}) meta: ${meta}`)
    // Cuplikan awal jawaban untuk cek koherensi
    const bubble = await page.locator('.answer-body').last().innerText()
    report.notes.push(`jawaban: ${bubble.slice(0, 200)}…`)
    const m = body.match(/dasar hukum \((\d+)\)/i)
    report.notes.push(`sources: ${m ? m[1] : '?'}`)
  } else {
    const bubble = await page
      .locator('.answer-body')
      .last()
      .innerText()
      .catch(() => '')
    report.notes.push(
      `generate masih berjalan setelah token pertama — cuplikan: ${bubble.slice(0, 150)}…`,
    )
    report.errors.push('generate tidak selesai dalam batas waktu tambahan')
  }
} catch (e) {
  report.errors.push(`FATAL: ${e.message.slice(0, 300)}`)
} finally {
  await page.screenshot({ path: '/tmp/lexisai-llm.png' }).catch(() => {})
  await ctx.close()
}

console.log('===== NOTES =====')
report.notes.forEach((n) => console.log(' •', n))
console.log('===== ERRORS =====')
report.errors.forEach((n) => console.log(' X', n))
process.exit(report.errors.length ? 1 : 0)
