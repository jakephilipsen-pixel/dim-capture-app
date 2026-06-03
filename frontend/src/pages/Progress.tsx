import { useEffect, useMemo, useState } from 'react'
import { Check } from 'lucide-react'

import { DimForm } from '@/components/DimForm'
import { ProgressBar } from '@/components/ProgressBar'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useProgressContext } from '@/context/ProgressContext'
import { api, type DimWithSku, type SkuDetail, type SkuSummary } from '@/lib/api'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'captured' | 'missing'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'captured', label: 'Captured' },
  { key: 'missing', label: 'Missing' },
]

export default function Progress() {
  const { refresh: refreshProgress } = useProgressContext()
  const [skus, setSkus] = useState<SkuSummary[]>([])
  const [total, setTotal] = useState(0)
  const [captured, setCaptured] = useState(0)
  const [dimsBySku, setDimsBySku] = useState<Map<string, DimWithSku>>(new Map())
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<SkuSummary | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    Promise.all([api.getSkus(), api.getDims().catch(() => [] as DimWithSku[])])
      .then(([list, dims]) => {
        if (!active) return
        setSkus(list.skus)
        setTotal(list.total)
        setCaptured(list.captured)
        setDimsBySku(new Map(dims.map((d) => [d.skuId, d])))
      })
      .catch(() => {
        // Backend unreachable — leave lists empty.
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return skus.filter((s) => {
      if (filter === 'captured' && !s.hasDims) return false
      if (filter === 'missing' && s.hasDims) return false
      if (q && !s.name.toLowerCase().includes(q) && !s.barcode.toLowerCase().includes(q)) {
        return false
      }
      return true
    })
  }, [skus, filter, search])

  const selectedDim = selected ? dimsBySku.get(selected.id) : undefined
  const selectedSku: SkuDetail | null = selected
    ? { ...selected, ccDimsCaptured: false, source: 'db' }
    : null

  function handleSaved() {
    setSelected(null)
    setReloadKey((k) => k + 1)
    void refreshProgress()
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold">Progress</h1>
          <span className="text-sm tabular-nums text-muted-foreground">
            {captured}/{total} · {total - captured} missing
          </span>
        </div>
        <ProgressBar captured={captured} total={total} />
      </div>

      {/* Filter tabs */}
      <div className="inline-flex w-full overflow-hidden rounded-md border">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              'min-h-11 flex-1 text-sm font-medium transition-colors',
              filter === f.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-secondary',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or barcode"
        inputMode="search"
        className="min-h-11"
        aria-label="Search SKUs"
      />

      <ul className="space-y-2" aria-label="SKU list">
        {visible.map((s) => (
          <li key={s.id} className="[content-visibility:auto] [contain-intrinsic-size:auto_56px]">
            <button
              type="button"
              onClick={() => setSelected(s)}
              className="flex min-h-14 w-full items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:bg-secondary/60"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{s.barcode}</p>
              </div>
              {s.hasDims ? (
                <Badge variant="success" className="gap-1">
                  <Check className="size-3" /> Captured
                </Badge>
              ) : (
                <Badge variant="secondary">Missing</Badge>
              )}
            </button>
          </li>
        ))}
        {visible.length === 0 && (
          <li className="px-1 text-sm text-muted-foreground">No SKUs match.</li>
        )}
      </ul>

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="bottom">
          {selectedSku && (
            <>
              <SheetHeader>
                <SheetTitle className="leading-snug">{selectedSku.name}</SheetTitle>
                <p className="font-mono text-sm text-muted-foreground">{selectedSku.barcode}</p>
              </SheetHeader>
              <DimForm
                key={selectedSku.id}
                sku={selectedSku}
                {...(selectedDim
                  ? {
                      dimId: selectedDim.id,
                      initialDims: {
                        lengthMm: selectedDim.lengthMm,
                        widthMm: selectedDim.widthMm,
                        heightMm: selectedDim.heightMm,
                        weightKg: selectedDim.weightKg,
                      },
                    }
                  : {})}
                onSaved={handleSaved}
              />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
