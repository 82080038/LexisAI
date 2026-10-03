import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  Cpu,
  Database,
  DownloadCloud,
  Loader2,
  Scale,
  Send,
  Sparkles,
  WifiOff,
} from 'lucide-react'
import { loadCorpus, loadFromCacheOnly, getIndex } from './lib/corpus'
import { embedQuery } from './lib/embed'
import { topK } from './lib/search'
import { generateAnswer, webgpuAvailable, LLM_MODEL } from './lib/llm'
import ReloadPrompt from './ReloadPrompt'

const SUGGESTIONS = [
  'Apa sanksi pidana korupsi menurut UU Tipikor?',
  'Bagaimana syarat perkawinan menurut UU No. 1 Tahun 1974?',
  'Apa itu asas ultimum remedium dalam hukum pajak?',
  'Hak konsumen apa saja yang diatur UU Perlindungan Konsumen?',
]

/* ---------- renderer markdown-lite ---------- */
function renderInline(text, keyPrefix) {
  // **bold** dan *italic* minimal
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return parts.map((p, i) => {
    const k = `${keyPrefix}-${i}`
    if (p.startsWith('**') && p.endsWith('**'))
      return <strong key={k}>{p.slice(2, -2)}</strong>
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2)
      return <em key={k}>{p.slice(1, -1)}</em>
    return <span key={k}>{p}</span>
  })
}

function AnswerBody({ text }) {
  const blocks = []
  const lines = text.split('\n')
  let para = []
  let list = []

  const flush = () => {
    if (para.length) {
      blocks.push(
        <p key={blocks.length}>{renderInline(para.join(' '), `p${blocks.length}`)}</p>,
      )
      para = []
    }
    if (list.length) {
      const items = list
      blocks.push(
        <ul key={blocks.length}>
          {items.map((li, i) => (
            <li key={i}>{renderInline(li, `li${blocks.length}-${i}`)}</li>
          ))}
        </ul>,
      )
      list = []
    }
  }

  for (const line of lines) {
    const t = line.trim()
    if (!t) {
      flush()
      continue
    }
    if (/^[-*•]\s+/.test(t)) {
      para.length && flush()
      list.push(t.replace(/^[-*•]\s+/, ''))
    } else if (/^\d+[.)]\s+/.test(t)) {
      para.length && flush()
      list.push(t.replace(/^\d+[.)]\s+/, ''))
    } else {
      list.length && flush()
      para.push(t)
    }
  }
  flush()
  return <div className="answer-body text-[15px]">{blocks}</div>
}

/* ---------- kartu sumber / sitasi ---------- */
function SourceCard({ source, index }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800/60 text-xs">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-ink-800"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gold-500/15 font-mono text-[10px] font-semibold text-gold-400">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-slate-200">
          {source.citation}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="border-t border-ink-700 px-3 py-2">
          {source.tentang && (
            <p className="mb-1 italic text-slate-400">tentang: {source.tentang}</p>
          )}
          <p className="whitespace-pre-wrap font-serif leading-relaxed text-slate-300">
            {source.text}
          </p>
        </div>
      )}
    </div>
  )
}

/* ---------- gelembung pesan ---------- */
function Message({ msg }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-gold-500 px-4 py-2.5 text-[15px] font-medium text-ink-950 shadow-lg shadow-gold-500/10">
          {msg.content}
        </div>
      </div>
    )
  }
  return (
    <div className="flex gap-3">
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-800 ring-1 ring-ink-700">
        <Scale size={16} className="text-gold-400" />
      </div>
      <div className="min-w-0 max-w-[85%] space-y-3">
        <div className="rounded-2xl rounded-tl-sm bg-ink-800 px-4 py-3 ring-1 ring-ink-700">
          {msg.error ? (
            <div className="flex items-start gap-2 text-amber-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p className="text-sm">{msg.content}</p>
            </div>
          ) : (
            <AnswerBody text={msg.content} />
          )}
          {msg.meta && (
            <p className="mt-2 border-t border-ink-700 pt-2 text-[11px] text-slate-500">
              {msg.meta}
            </p>
          )}
        </div>
        {msg.sources?.length > 0 && (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <BookOpen size={12} /> Dasar hukum ({msg.sources.length})
            </p>
            {msg.sources.map((s, i) => (
              <SourceCard key={i} source={s} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- progress bar ---------- */
function Progress({ label, pct }) {
  return (
    <div className="w-full max-w-md">
      <div className="mb-1.5 flex items-center justify-between text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <DownloadCloud size={13} className="text-gold-400" /> {label}
        </span>
        {pct != null && <span>{Math.round(pct * 100)}%</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
        <div
          className="h-full rounded-full bg-gold-500 transition-all duration-300"
          style={{ width: `${(pct ?? 0) * 100}%` }}
        />
      </div>
    </div>
  )
}

/* ---------- aplikasi utama ---------- */
export default function App() {
  const [boot, setBoot] = useState({ phase: 'init', label: 'Menyiapkan…', pct: 0 })
  const [corpusInfo, setCorpusInfo] = useState(null) // {chunks, version}
  const [offline, setOffline] = useState(false)
  // null = belum dicek; true/false = hasil requestAdapter()
  const [hasWebGPU, setHasWebGPU] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusLine, setStatusLine] = useState(null) // status proses per-tanyaan
  const bottomRef = useRef(null)
  const taRef = useRef(null)
  const streamingIdx = useRef(-1)

  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {})
    webgpuAvailable().then(setHasWebGPU)

    loadCorpus((p) => {
      setBoot({
        phase: p.phase,
        label: p.label,
        pct: p.total ? p.done / p.total : undefined,
      })
    })
      .then((idx) => {
        setCorpusInfo({ chunks: idx.chunks.length, version: idx.version })
        setBoot({ phase: 'ready' })
      })
      .catch(async () => {
        // Offline / server data tak terjangkau -> pakai cache IndexedDB
        const idx = await loadFromCacheOnly()
        if (idx) {
          setOffline(true)
          setCorpusInfo({ chunks: idx.chunks.length, version: idx.version })
          setBoot({ phase: 'ready' })
        } else {
          setBoot({
            phase: 'error',
            label: 'Korpus belum tersedia & tidak ada cache lokal.',
          })
        }
      })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, statusLine])

  function buildContext(sources) {
    return sources.map((s) => `[${s.citation}]\n${s.text}`).join('\n\n---\n\n')
  }

  function buildRetrievalOnlyAnswer(sources, reason) {
    return (
      `${reason} Berikut pasal paling relevan (lihat kartu Dasar hukum di bawah):\n\n` +
      sources.map((s, i) => `${i + 1}. **${s.citation}**`).join('\n')
    )
  }

  async function ask(question) {
    const q = question.trim()
    const idx = getIndex()
    if (!q || loading || !idx) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: q }])
    setLoading(true)
    try {
      // 1. Embedding query di browser (model ~25MB sekali unduh)
      setStatusLine({ icon: 'embed', text: 'Memuat model embedding…' })
      const qv = await embedQuery(q, (p) =>
        setStatusLine({
          icon: 'embed',
          text: `Unduh model embedding ${p.file || ''}…`,
          pct: p.total ? p.loaded / p.total : undefined,
        }),
      )

      // 2. Retrieval top-k di memori
      setStatusLine({ icon: 'search', text: 'Menelusuri pasal…' })
      const sources = topK(idx, qv, 5)

      // 3. Generasi jawaban — fallback ke retrieval-only bila LLM
      //    gagal apa pun sebabnya (tanpa WebGPU, adapter, OOM, dll)
      let llmErr = null
      if (hasWebGPU === true) {
        streamingIdx.current = -1
        let first = true
        const t0 = performance.now()
        try {
          const final = await generateAnswer(
            q,
            buildContext(sources),
            (p) =>
              setStatusLine({
                icon: 'llm',
                text: p.text?.startsWith('Loading')
                  ? 'Unduh bobot LLM…'
                  : `Menyiapkan LLM… ${p.text || ''}`,
                pct: p.progress,
              }),
            (acc) => {
              if (first) {
                first = false
                setStatusLine(null)
                setMessages((m) => {
                  streamingIdx.current = m.length
                  return [...m, { role: 'assistant', content: acc, sources }]
                })
              } else {
                setMessages((m) => {
                  const copy = [...m]
                  copy[streamingIdx.current] = {
                    ...copy[streamingIdx.current],
                    content: acc,
                  }
                  return copy
                })
              }
            },
          )
          const ms = Math.round(performance.now() - t0)
          setMessages((m) => {
            const copy = [...m]
            copy[streamingIdx.current] = {
              ...copy[streamingIdx.current],
              content: final,
              meta: `${LLM_MODEL} · lokal · ${ms.toLocaleString('id-ID')} ms`,
            }
            return copy
          })
          return
        } catch (e) {
          llmErr = e?.message ?? String(e)
          // hapus gelembung streaming setengah jadi (bila ada)
          if (streamingIdx.current >= 0) {
            setMessages((m) => m.filter((_, i) => i !== streamingIdx.current))
            streamingIdx.current = -1
          }
        }
      }

      const reason =
        llmErr != null
          ? `LLM lokal gagal dimuat (${llmErr}).`
          : hasWebGPU === null
            ? 'Browser ini tidak mendukung WebGPU, jadi jawaban tidak dapat dirangkum LLM lokal.'
            : 'WebGPU tidak tersedia di browser ini, jadi jawaban tidak dapat dirangkum LLM lokal.'
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: buildRetrievalOnlyAnswer(sources, reason),
          sources,
          meta: 'retrieval-only',
        },
      ])
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: `Gagal: ${e?.message ?? String(e)}`,
          error: true,
        },
      ])
    } finally {
      setStatusLine(null)
      setLoading(false)
      taRef.current?.focus()
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      ask(input)
    }
  }

  const ready = boot.phase === 'ready'
  const empty = messages.length === 0

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      {/* header */}
      <header className="flex items-center justify-between border-b border-ink-800 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-gold-400 to-gold-500 shadow-lg shadow-gold-500/20">
            <Scale size={18} className="text-ink-950" strokeWidth={2.4} />
          </div>
          <div>
            <h1 className="font-serif text-lg font-bold leading-tight text-slate-100">
              LexisAI
            </h1>
            <p className="text-[11px] text-slate-500">
              Asisten Hukum Indonesia · 100% di perangkat Anda
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {offline && (
            <span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-400 ring-1 ring-amber-500/30">
              <WifiOff size={11} /> offline
            </span>
          )}
          {corpusInfo && (
            <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400 ring-1 ring-emerald-500/30">
              <Database size={11} />
              {corpusInfo.chunks.toLocaleString('id-ID')} pasal
            </div>
          )}
          {hasWebGPU === false && (
            <span className="flex items-center gap-1.5 rounded-full bg-ink-800 px-2.5 py-1 text-[11px] font-medium text-slate-400 ring-1 ring-ink-700">
              <Cpu size={11} /> LLM tak tersedia
            </span>
          )}
        </div>
      </header>

      {/* area chat */}
      <main className="scroll-thin flex-1 space-y-5 overflow-y-auto px-5 py-6">
        {!ready ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 pb-10 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-400 to-gold-500 shadow-2xl shadow-gold-500/20">
              {boot.phase === 'error' ? (
                <AlertTriangle size={30} className="text-ink-950" />
              ) : (
                <Loader2 size={30} className="animate-spin text-ink-950" />
              )}
            </div>
            <div>
              <h2 className="font-serif text-xl font-bold text-slate-100">
                Menyiapkan korpus hukum…
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
                Data disimpan di perangkat Anda. Kunjungan berikutnya
                langsung siap pakai — bahkan offline.
              </p>
            </div>
            <Progress label={boot.label} pct={boot.pct} />
          </div>
        ) : empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 pb-10 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-400 to-gold-500 shadow-2xl shadow-gold-500/20">
              <Scale size={30} className="text-ink-950" />
            </div>
            <div>
              <h2 className="font-serif text-2xl font-bold text-slate-100">
                Tanyakan hukum, jawab dengan dasar.
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-400">
                Jawaban diambil dari <strong className="text-gold-400">52 dokumen UU</strong> dan
                diolah <strong className="text-gold-400">sepenuhnya di perangkat Anda</strong> —
                tanpa server, tanpa data keluar.
              </p>
            </div>
            <div className="grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="rounded-xl border border-ink-700 bg-ink-800/50 px-3.5 py-3 text-left text-[13px] leading-snug text-slate-300 transition hover:border-gold-500/50 hover:bg-ink-800 hover:text-slate-100"
                >
                  <Sparkles size={13} className="mb-1.5 text-gold-400" />
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <Message key={i} msg={m} />
            ))}
            {(loading || statusLine) && (
              <div className="flex gap-3">
                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-800 ring-1 ring-ink-700">
                  <Scale size={16} className="text-gold-400" />
                </div>
                <div className="min-w-0 max-w-[75%] space-y-1.5">
                  {statusLine ? (
                    <Progress label={statusLine.text} pct={statusLine.pct} />
                  ) : (
                    <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-ink-800 px-4 py-3 ring-1 ring-ink-700">
                      <Loader2 size={15} className="animate-spin text-gold-400" />
                      <span className="text-sm text-slate-400">Menjawab…</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </main>

      {/* input */}
      <footer className="border-t border-ink-800 px-5 pb-5 pt-3">
        <div className="flex items-end gap-2 rounded-2xl border border-ink-700 bg-ink-800/70 p-2 ring-gold-500/30 transition focus-within:ring-2">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            disabled={!ready}
            placeholder={
              ready
                ? 'Tulis pertanyaan hukum Anda… (Enter kirim, Shift+Enter baris baru)'
                : 'Menunggu korpus siap…'
            }
            className="scroll-thin max-h-36 flex-1 resize-none bg-transparent px-2.5 py-2 text-[15px] text-slate-100 placeholder:text-slate-500 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={() => ask(input)}
            disabled={loading || !input.trim() || !ready}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-500 text-ink-950 shadow-lg shadow-gold-500/20 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <Send size={17} strokeWidth={2.4} />
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-slate-600">
          Diproses 100% di perangkat Anda · Jawaban LexisAI bukan nasihat hukum.
        </p>
      </footer>
      <ReloadPrompt />
    </div>
  )
}
