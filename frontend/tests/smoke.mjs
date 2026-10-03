// Comprehensive smoke test LexisAI PWA.
// Pakai: node tests/smoke.mjs <url> [--offline]
//   --offline: juga tes reload offline (butuh SW produksi -> vite preview)
import { chromium } from 'playwright'

const URL = process.argv[2] || 'http://localhost:5173/'
const OFFLINE_TEST = process.argv.includes('--offline')
const report = { console: [], errors: [], failed: [], notes: [] }

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
const page = await ctx.newPage()

page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type()))
    report.console.push(`[${m.type()}] ${m.text().slice(0, 300)}`)
})
page.on('pageerror', (e) =>
  report.errors.push(`pageerror: ${e.message.slice(0, 300)}`),
)
page.on('requestfailed', (r) =>
  report.failed.push(
    `${r.method()} ${r.url().slice(0, 120)} -> ${r.failure()?.errorText}`,
  ),
)

try {
  // ---- TEST 1: boot & corpus ----
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  report.notes.push('goto OK')
  await page.waitForSelector('textarea:not([disabled])', { timeout: 120000 })
  report.notes.push('boot ready: textarea enabled')
  const badge = await page.locator('header').innerText()
  report.notes.push(`header: ${badge.replace(/\n/g, ' | ')}`)
  const gpu = await page.evaluate(async () => {
    if (!('gpu' in navigator)) return 'no-api'
    return (await navigator.gpu.requestAdapter()) ? 'adapter' : 'no-adapter'
  })
  report.notes.push(`WebGPU: ${gpu}`)
  const idb = await page.evaluate(async () =>
    (await indexedDB.databases()).map((d) => d.name).join(', '),
  )
  report.notes.push(`indexedDB: ${idb || 'none'}`)
  await page.screenshot({ path: '/tmp/lexisai-boot.png' })

  // ---- TEST 2: query & retrieval ----
  await page.fill('textarea', 'Apa sanksi pidana korupsi?')
  await page.press('textarea', 'Enter')
  report.notes.push('query sent')
  await page
    .waitForFunction(
      () =>
        document.body.innerText.includes('Dasar hukum') ||
        document.body.innerText.includes('Gagal:'),
      { timeout: 180000 },
    )
    .catch(() => report.errors.push('timeout menunggu jawaban'))
  const body = await page.locator('body').innerText()
  const srcMatch = body.match(/dasar hukum \((\d+)\)/i)
  report.notes.push(`sources: ${srcMatch ? srcMatch[1] : 'TIDAK ADA'}`)
  const hasLLM = /lokal · \d/.test(body)
  const hasRetrieval = body.includes('retrieval-only')
  report.notes.push(
    `mode: ${hasLLM ? 'LLM streaming' : hasRetrieval ? 'retrieval-only' : '?'}`,
  )
  if (body.includes('Gagal:'))
    report.errors.push(
      'UI menampilkan Gagal: ' +
        (body.match(/Gagal:.{0,150}/s)?.[0] || '').replace(/\n/g, ' '),
    )
  await page.screenshot({ path: '/tmp/lexisai-answer.png', fullPage: true })

  // ---- TEST 3: expand sitasi ----
  const card = page.locator('button', { hasText: 'UU No.' }).first()
  if (await card.count()) {
    await card.click()
    await page.waitForTimeout(300)
    const expanded = await page
      .locator('.font-serif')
      .last()
      .innerText()
      .catch(() => '')
    report.notes.push(`sitasi expanded: ${expanded.slice(0, 60)}…`)
  } else {
    report.errors.push('kartu sitasi tidak ditemukan')
  }

  // ---- TEST 4: SW & manifest ----
  await page.waitForTimeout(3000)
  const sws = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations()
    return regs.map((r) => r.active?.scriptURL || 'pending').join(', ')
  })
  report.notes.push(`serviceWorker: ${sws || 'tidak ada'}`)
  const manifest = await page.evaluate(async (u) => {
    const res = await fetch(u + 'manifest.webmanifest')
    const m = await res.json()
    return `${m.name} | icons:${m.icons?.length}`
  }, URL)
  report.notes.push(`manifest: ${manifest}`)

  // ---- TEST 5: offline reload (hanya build produksi) ----
  if (OFFLINE_TEST) {
    await ctx.setOffline(true)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('textarea:not([disabled])', { timeout: 60000 })
    const bodyOff = await page.locator('body').innerText()
    report.notes.push(
      `offline reload: ${bodyOff.includes('pasal') ? 'OK dari cache' : 'GAGAL'} | badge: ${bodyOff.includes('offline')}`,
    )
    await page.fill('textarea', 'hak konsumen')
    await page.press('textarea', 'Enter')
    await page
      .waitForFunction(
        () =>
          document.body.innerText.includes('Dasar hukum') ||
          document.body.innerText.includes('Gagal'),
        { timeout: 120000 },
      )
      .catch(() => report.errors.push('offline query timeout'))
    const bodyOff2 = await page.locator('body').innerText()
    report.notes.push(
      `offline query: ${bodyOff2.includes('Dasar hukum') ? 'retrieval OK' : 'gagal/embed-butuh-net'}`,
    )
    await page.screenshot({ path: '/tmp/lexisai-offline.png' })
  }
} catch (e) {
  report.errors.push(`FATAL: ${e.message.slice(0, 400)}`)
  await page.screenshot({ path: '/tmp/lexisai-fatal.png' }).catch(() => {})
}

await browser.close()

console.log('===== NOTES =====')
report.notes.forEach((n) => console.log(' •', n))
console.log('===== CONSOLE warn/err =====')
report.console.forEach((n) => console.log(' !', n))
console.log('===== PAGE ERRORS =====')
report.errors.forEach((n) => console.log(' X', n))
console.log('===== FAILED REQUESTS =====')
report.failed.slice(0, 15).forEach((n) => console.log(' ?', n))
process.exit(report.errors.length ? 1 : 0)
