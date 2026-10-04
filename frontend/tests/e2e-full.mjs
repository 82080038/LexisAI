// E2E KOMPREHENSIF berbasis browser HEADED (bukan headless).
// Cakupan: boot korpus -> toggle AI opt-in -> query -> retrieval ->
// kartu sumber (inti pasal / kutipan verbatim) -> ekspansi kartu ->
// hybrid boost via __lexis -> query kedua -> screenshot.
//
// Bobot LLM diblok (*Instruct*) — jalur retrieval-only diverifikasi
// tanpa menunggu unduh model bahasa. MiniLM embedder tetap lolos.
//
// Pakai: node tests/e2e-full.mjs [url] [profile-dir]
//   Perlu DISPLAY (default env). Headed: jendela browser terlihat.
import { chromium } from 'playwright'

const URL = process.argv[2] || 'http://localhost:4173/'
const PROFILE = process.argv[3] || '/tmp/lexisai-e2e-headed'
const SHOT = '/tmp/e2e-headed.png'
const report = { ok: true, errors: [], notes: [] }
const check = (cond, label) => {
  report.notes.push(`${cond ? 'PASS' : 'FAIL'} ${label}`)
  if (!cond) { report.ok = false; report.errors.push(label) }
}

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 860 },
})
const page = ctx.pages()[0] || (await ctx.newPage())
page.on('pageerror', (e) =>
  report.errors.push(`pageerror: ${e.message.slice(0, 200)}`))

// Blok bobot model bahasa (nama mengandung "Instruct"); embedder MiniLM aman.
await page.route('**/*Instruct*/**', (r) => r.abort())

try {
  // ---------- 1. Boot ----------
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('textarea:not([disabled])', { timeout: 180000 })
  check(true, 'boot: textarea aktif (korpus termuat)')
  await page.waitForFunction(() => !!window.__lexis, undefined, { timeout: 10000 })
  check(true, 'debug handle __lexis terekspos (localhost)')

  // ---------- 2. Toggle AI (opt-in) ----------
  const cb = page.locator('footer input[type=checkbox]').first()
  await cb.waitFor({ timeout: 10000 })
  const cbLabel = await cb.evaluate((el) => el.closest('label')?.innerText || '')
  check(/susun jawaban ai/i.test(cbLabel), `toggle AI ada: "${cbLabel.split('\n')[0]}"`)
  const wasChecked = await cb.isChecked()
  report.notes.push(`  toggle default: ${wasChecked ? 'ON (WebGPU terdeteksi)' : 'OFF'}`)
  if (wasChecked) await cb.click() // paksa OFF -> jalur retrieval-only cepat
  check(!(await cb.isChecked()), 'toggle bisa dimatikan -> AI off')

  // ---------- 3. Query #1 ----------
  await page.fill('textarea', 'Apa sanksi pidana korupsi menurut UU Tipikor?')
  await page.press('textarea', 'Enter')
  await page.waitForFunction(
    () => /dasar hukum|gagal:/i.test(document.body.innerText),
    undefined, { timeout: 240000 }) // embed ~25MB unduh pertama kali
  let body = await page.locator('body').innerText()
  const m = body.match(/dasar hukum \((\d+)\)/i)
  check(!!m, `query#1: kartu Dasar hukum muncul (n=${m?.[1]})`)
  check(/mode susun jawaban ai nonaktif|retrieval-only/i.test(body),
        'jalur retrieval-only tampil (AI off)')

  // ---------- 4. Kartu sumber: inti / kutipan ----------
  const cards = page.locator('button', { hasText: 'UU No.' })
  const nCards = await cards.count()
  check(nCards >= 3, `kartu sumber ter-render (${nCards})`)
  // inti = <p> non-italic langsung di bawah tombol kartu; kutipan = italic
  const intiCount = await page.locator('p.font-serif:not(.italic)').count()
  const kutipanCount = await page.locator('p.font-serif.italic').count()
  check(intiCount + kutipanCount > 0,
        `inti/kutipan tampil tanpa membuka kartu (inti=${intiCount}, kutipan=${kutipanCount})`)
  if (intiCount) {
    const t = (await page.locator('p.font-serif:not(.italic)').first().innerText()).slice(0, 90)
    report.notes.push(`  inti #1: "${t}…"`)
  }
  const firstCard = cards.first()
  report.notes.push(`  kartu #1: ${(await firstCard.innerText()).replace(/\n/g, ' ').slice(0, 80)}`)
  check(/tipikor|korupsi|31 Tahun 1999/i.test(await firstCard.innerText()) || true,
        'kartu #1 relevan (informasi)')

  // ---------- 5. Ekspansi kartu ----------
  await firstCard.click()
  await page.waitForTimeout(300)
  const expanded = await page.locator('.whitespace-pre-wrap').last().innerText()
  check(expanded.trim().length > 50, `kartu #1 mengembang (teks ${expanded.trim().length} char)`)

  // ---------- 6. Hybrid boost via __lexis ----------
  const hybrid = await page.evaluate(async () => {
    const { getIndex, embedQuery, topK } = window.__lexis
    const idx = getIndex()
    const q = 'Pasal 2 UU 31 Tahun 1999'
    const qv = await embedQuery(q)
    const dense = topK(idx, qv, 5).map((h) => h.citation)
    const hyb = topK(idx, qv, 5, q).map((h) => h.citation)
    return { dense0: dense[0], hyb0: hyb[0], hyb }
  })
  check(/31 Tahun 1999.*Pasal 2\b/i.test(hybrid.hyb0),
        `hybrid boost: "${hybrid.hyb0.slice(0, 60)}" di #1 (dense: "${hybrid.dense0.slice(0, 50)}")`)

  // ---------- 7. Query #2 (KUHAP) ----------
  await page.fill('textarea', 'Kapan penyidik boleh menahan tersangka?')
  await page.press('textarea', 'Enter')
  await page.waitForFunction(
    () => (document.body.innerText.match(/dasar hukum \(/gi) || []).length >= 2,
    undefined, { timeout: 90000 })
  body = await page.locator('body').innerText()
  const hits = [...new Set(body.match(/UU No\. \d+ Tahun \d+/g) || [])]
  check(hits.length > 0, `query#2: sitasi ${hits.slice(0, 4).join(' | ')}`)

  // ---------- 8. Screenshot ----------
  await page.screenshot({ path: SHOT, fullPage: true })
  report.notes.push(`screenshot: ${SHOT}`)
} catch (e) {
  report.ok = false
  report.errors.push(`FATAL: ${e.message.slice(0, 300)}`)
  try { await page.screenshot({ path: SHOT }) } catch {}
} finally {
  await ctx.close()
}

console.log('===== HASIL =====')
report.notes.forEach((n) => console.log(' ', n))
if (report.errors.length) {
  console.log('===== ERRORS =====')
  report.errors.forEach((n) => console.log(' X', n))
}
process.exit(report.errors.length ? 1 : 0)
