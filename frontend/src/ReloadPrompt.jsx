import { useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw, X } from 'lucide-react'

// Waktu evaluasi modul ≈ saat aplikasi mulai dimuat.
const BOOT_AT = performance.now()
// Update yang sudah menunggu SEBELUM user sempat berinteraksi dianggap
// "baru masuk" — langsung diterapkan tanpa prompt.
const AUTO_APPLY_MS = 5000
// Interval cek update selama sesi aktif (30 menit).
const CHECK_INTERVAL_MS = 30 * 60 * 1000

// Toast "versi baru tersedia" saat SW menemukan build baru DI TENGAH sesi.
export default function ReloadPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        setInterval(() => registration.update(), CHECK_INTERVAL_MS)
      }
    },
  })
  const applied = useRef(false)

  useEffect(() => {
    const freshVisit = performance.now() - BOOT_AT < AUTO_APPLY_MS
    if (needRefresh && freshVisit && !applied.current) {
      applied.current = true
      updateServiceWorker(true)
    }
  }, [needRefresh, updateServiceWorker])

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
