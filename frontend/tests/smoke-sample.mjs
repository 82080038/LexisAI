// Smoke test sampel hasil SEBELUM implementasi penuh — membuktikan
// kelayakan: (A) jawaban ekstraktif verbatim (kalimat terbaik per pasal),
// (B) hybrid keyword/metadata boost vs dense-only.
// Memakai debug handle window.__lexis (localhost-only) agar retrieval
// nyata dipanggil langsung tanpa lewat UI chat.
//
// Pakai: node tests/smoke-sample.mjs <url> [profile-dir]
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const URL = process.argv[2] || 'http://localhost:4173/'
const PROFILE = process.argv[3] || '/tmp/lexisai-sample-profile'

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
})
const page = ctx.pages()[0] || (await ctx.newPage())
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)))

const report = { ok: true, demoA: null, demoB: [], notes: [] }

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  // SW precache menyajikan bundle lama — unregister + reload (pola e2e-llm)
  await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((r) => r.unregister()))
  })
  await page.reload({ waitUntil: 'domcontentloaded' })

  await page.waitForFunction(
    () => window.__lexis?.getIndex?.()?.chunks?.length > 0,
    undefined,
    { timeout: 300000 },
  )
  const n = await page.evaluate(
    () => window.__lexis.getIndex().chunks.length,
  )
  report.notes.push(`korpus siap: ${n} chunk`)

  // ---------- DEMO A: jawaban ekstraktif verbatim ----------
  report.demoA = await page.evaluate(async () => {
    const { getIndex, embedQuery, topK, expandWithGraph } = window.__lexis
    const idx = getIndex()
    const query = 'Apa sanksi pidana bagi pelaku korupsi?'
    const qv = await embedQuery(query)

    const dot = (a, b) => {
      let s = 0
      for (let i = 0; i < a.length; i++) s += a[i] * b[i]
      return s
    }
    // Splitter sadar format hukum: item ayat (n), sub-item huruf, kalimat.
    function splitSentences(t) {
      const byAyat = t.split(/(?=\(\d+\)\s)/)
      const out = []
      for (const a of byAyat) {
        for (const s of a.split(/(?<=[.!?])\s+(?=["'(\da-zA-ZÀ-Þ])/)) {
          const x = s.trim()
          if (x.length >= 60 && x.length <= 800) out.push(x)
        }
      }
      return out.length ? out : [t.slice(0, 800)]
    }

    const hits = topK(idx, qv, 5)
    const sources = expandWithGraph(idx, hits, 3)
    const extractive = []
    for (const h of hits.slice(0, 3)) {
      const sents = splitSentences(h.text)
      const scored = []
      for (const s of sents) {
        scored.push({ s, score: dot(await embedQuery(s), qv) })
      }
      scored.sort((a, b) => b.score - a.score)
      extractive.push({
        citation: h.citation,
        chunkScore: +h.score.toFixed(3),
        best: scored.slice(0, 2).map((x) => ({
          score: +x.score.toFixed(3),
          s: x.s.length > 340 ? x.s.slice(0, 340) + '…' : x.s,
        })),
      })
    }
    return {
      query,
      sources: sources.map((s) => ({
        citation: s.citation,
        score: +s.score.toFixed(3),
        expanded: !!s.expanded,
      })),
      extractive,
      sampleText: hits[0].text.slice(0, 1500),
    }
  })

  // ---------- DEMO B: hybrid keyword/metadata boost ----------
  const queriesB = [
    'sanksi Pasal 2 UU 31 Tahun 1999',
    'pasal 340 pembunuhan berencana',
    'Pasal 27 UU ITE pencemaran nama baik',
  ]
  for (const query of queriesB) {
    report.demoB.push(
      await page.evaluate(async (q) => {
        const { getIndex, embedQuery, topK } = window.__lexis
        const idx = getIndex()
        const qv = await embedQuery(q)
        const fmt = (hits) =>
          hits.map((h) => ({ citation: h.citation, score: +h.score.toFixed(3) }))
        return {
          query: q,
          dense: fmt(topK(idx, qv, 5)),        // tanpa queryText = murni dense
          hybrid: fmt(topK(idx, qv, 5, q)),    // jalur produksi (hybrid boost)
        }
      }, query),
    )
  }
} catch (e) {
  report.ok = false
  report.errors = errors
  report.notes.push(`FATAL: ${e.message}`)
}

// simpan teks pasal teratas untuk demo C (Ollama di luar browser)
if (report.demoA?.sampleText)
  writeFileSync('/tmp/sample-pasal.txt', report.demoA.sampleText)

console.log(JSON.stringify(report, null, 2))
await ctx.close()
