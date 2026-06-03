import { useCallback, useEffect, useState } from 'react'
import { Cloud, Pencil, RefreshCw } from 'lucide-react'

import { DimForm } from '@/components/DimForm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useProgressContext } from '@/context/ProgressContext'
import { api, type DimWithSku, type SkuDetail } from '@/lib/api'

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

export default function Review() {
  const { progress, refresh: refreshProgress } = useProgressContext()
  const [dims, setDims] = useState<DimWithSku[]>([])
  const [selected, setSelected] = useState<DimWithSku | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    api
      .getDims()
      .then((all) => {
        if (!active) return
        const sorted = [...all].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))
        setDims(sorted.slice(0, 10))
      })
      .catch(() => {
        // Backend unreachable — leave list as-is.
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  const reload = useCallback(() => {
    setReloadKey((k) => k + 1)
    void refreshProgress()
  }, [refreshProgress])

  async function syncNow() {
    setSyncing(true)
    try {
      await api.syncToCC()
    } catch {
      // Surface nothing fatal; the count simply won't drop.
    } finally {
      setSyncing(false)
      reload()
    }
  }

  function editSku(dim: DimWithSku): SkuDetail {
    return {
      id: dim.skuId,
      barcode: dim.sku.barcode,
      name: dim.sku.name,
      hasDims: true,
      ccDimsCaptured: false,
      source: 'db',
    }
  }

  const pending = progress?.pendingSync ?? 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Review</h1>
        <div className="flex items-center gap-2">
          <Badge variant={pending > 0 ? 'default' : 'success'} className="gap-1">
            {pending > 0 ? <RefreshCw className="size-3" /> : <Cloud className="size-3" />}
            {pending > 0 ? `${pending} pending` : 'all synced'}
          </Badge>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11"
            onClick={syncNow}
            disabled={syncing || pending === 0}
          >
            <RefreshCw className={syncing ? 'size-4 animate-spin' : 'size-4'} />
            Sync Now
          </Button>
        </div>
      </div>

      <ul className="space-y-2" aria-label="Recent captures">
        {dims.map((d) => (
          <li key={d.id}>
            <Card className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{d.sku.name}</p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {d.lengthMm}×{d.widthMm}×{d.heightMm} mm · {d.weightKg} kg
                </p>
                <p className="text-xs text-muted-foreground">
                  {d.measuredBy} · {formatWhen(d.measuredAt)}
                </p>
              </div>
              {d.syncedToCC ? (
                <Cloud className="size-4 shrink-0 text-emerald-600" aria-label="Synced" />
              ) : (
                <RefreshCw className="size-4 shrink-0 text-muted-foreground" aria-label="Pending sync" />
              )}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="min-h-11 min-w-11"
                onClick={() => setSelected(d)}
                aria-label={`Edit ${d.sku.name}`}
              >
                <Pencil className="size-4" />
              </Button>
            </Card>
          </li>
        ))}
        {dims.length === 0 && (
          <li className="px-1 text-sm text-muted-foreground">No captures yet.</li>
        )}
      </ul>

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="bottom">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="leading-snug">{selected.sku.name}</SheetTitle>
                <p className="font-mono text-sm text-muted-foreground">{selected.sku.barcode}</p>
              </SheetHeader>
              <DimForm
                key={selected.id}
                sku={editSku(selected)}
                dimId={selected.id}
                initialDims={{
                  lengthMm: selected.lengthMm,
                  widthMm: selected.widthMm,
                  heightMm: selected.heightMm,
                  weightKg: selected.weightKg,
                }}
                onSaved={() => {
                  setSelected(null)
                  reload()
                }}
              />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
