import { lazy, Suspense, useRef, useState } from 'react'
import { ScanLine, Search } from 'lucide-react'

import { DimForm, type SaveOutcome } from '@/components/DimForm'
import { RecentCaptures } from '@/components/RecentCaptures'
import { SkuCard } from '@/components/SkuCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useProgressContext } from '@/context/ProgressContext'
import { useBarcode } from '@/hooks/useBarcode'
import { useSku } from '@/hooks/useSku'
import { playBeep, vibrate } from '@/lib/feedback'
import { cn } from '@/lib/utils'

// ZXing is heavy (~500 kB); load the scanner only when the camera is opened.
const BarcodeScanner = lazy(() =>
  import('@/components/BarcodeScanner').then((m) => ({ default: m.BarcodeScanner })),
)

export default function Capture() {
  const [query, setQuery] = useState('')
  const [flash, setFlash] = useState<SaveOutcome | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const barcodeInputRef = useRef<HTMLInputElement>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { refresh } = useProgressContext()
  const { scanning, openScanner, closeScanner, handleScan } = useBarcode()
  const { sku, loading, notFound, error } = useSku(query)

  function onScanned(code: string) {
    handleScan(code)
    setQuery(code)
  }

  function handleSaved(outcome: SaveOutcome) {
    playBeep()
    vibrate()
    setFlash(outcome)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 1500)

    setQuery('') // clears SkuCard + DimForm (sku becomes null)
    setReloadKey((k) => k + 1)
    void refresh()
    barcodeInputRef.current?.focus()
  }

  return (
    <div className="space-y-5">
      {flash && (
        <div
          role="status"
          className={cn(
            'rounded-lg px-4 py-3 text-center text-sm font-semibold text-white',
            'animate-[fade-in_150ms_ease-out]',
            flash === 'saved' ? 'bg-emerald-600' : 'bg-amber-600',
          )}
        >
          {flash === 'saved' ? 'Saved! Scan next item.' : 'Queued offline — will sync when online.'}
        </div>
      )}

      {/* Scan + search */}
      <div className="space-y-3">
        {scanning ? (
          <Suspense
            fallback={
              <div className="flex aspect-[4/3] w-full items-center justify-center rounded-xl border bg-muted text-sm text-muted-foreground">
                Loading camera…
              </div>
            }
          >
            <BarcodeScanner onScan={onScanned} onClose={closeScanner} />
          </Suspense>
        ) : (
          <Button
            type="button"
            size="lg"
            className="min-h-12 w-full gap-2 text-base"
            onClick={openScanner}
          >
            <ScanLine className="size-5" />
            Scan Barcode
          </Button>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={barcodeInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search barcode or SKU name"
            inputMode="search"
            autoComplete="off"
            className="min-h-11 pl-9"
            aria-label="Search barcode or SKU name"
          />
        </div>
      </div>

      {/* Lookup result */}
      {loading && <p className="px-1 text-sm text-muted-foreground">Looking up…</p>}
      {notFound && !loading && (
        <p role="alert" className="px-1 text-sm text-destructive">
          SKU not found for “{query.trim()}”.
        </p>
      )}
      {error && !loading && (
        <p role="alert" className="px-1 text-sm text-destructive">
          {error}
        </p>
      )}

      {sku && !loading && (
        <div className="space-y-4">
          <SkuCard sku={sku} />
          <DimForm sku={sku} onSaved={handleSaved} />
        </div>
      )}

      {/* Recent captures */}
      <section className="space-y-2 pt-2">
        <h2 className="px-1 text-sm font-semibold text-muted-foreground">Recent captures</h2>
        <RecentCaptures reloadKey={reloadKey} />
      </section>
    </div>
  )
}
