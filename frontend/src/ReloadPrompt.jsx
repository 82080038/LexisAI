import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw, X } from 'lucide-react'

// Toast "versi baru tersedia" saat service worker menemukan build baru.
export default function ReloadPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-gold-500/40 bg-ink-800 px-4 py-2.5 shadow-2xl">
      <span className="text-sm text-slate-200">Versi baru tersedia.</span>
      <button
        onClick={() => updateServiceWorker(true)}
        className="flex items-center gap-1.5 rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-ink-950 hover:bg-gold-400"
      >
        <RefreshCw size={12} /> Muat ulang
      </button>
      <button
        onClick={() => setNeedRefresh(false)}
        className="text-slate-500 hover:text-slate-300"
        aria-label="Tutup"
      >
        <X size={15} />
      </button>
    </div>
  )
}
