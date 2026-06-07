import { useCallback, useEffect, useState } from 'react'
import { Cloud, Pencil, RefreshCw } from 'lucide-react'

import { DimForm } from '@/components/DimForm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useProgressContext } from '@/context/ProgressContext'
import { ApiError, api, type DimWithSku, type SkuDetail } from '@/lib/api'
import { clearSyncKey, getSyncKey, setSyncKey } from '@/lib/syncKey'

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

  // Sync-key prompt state.
  const [promptOpen, setPromptOpen] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [keyError, setKeyError] = useState('')

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

  /** Attempt the CC sync, handling 401 by prompting the operator. */
  async function runSync(wasAuthorised = false) {
    setSyncing(true)
    let succeeded = false
    try {
      await api.syncToCC()
      succeeded = true
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Key missing (pre-check path) or rejected (real 401 from backend).
        // api.syncToCC already called clearSyncKey() on a real 401; for the
        // pre-check path (no key) it threw without hitting the network.
        clearSyncKey()
        setKeyDraft('')
        // Show "rejected" only when the operator just entered a key (wasAuthorised).
        setKeyError(wasAuthorised ? 'Sync key rejected — re-enter.' : '')
        setPromptOpen(true)
        setSyncing(false)
        return
      }
      // Surface nothing fatal for other errors; the count simply won't drop.
    } finally {
      setSyncing(false)
    }
    if (succeeded) reload()
  }

  /** Called by the Sync Now button. */
  function syncNow() {
    if (getSyncKey() === null) {
      // No key stored — open prompt first.
      setKeyDraft('')
      setKeyError('')
      setPromptOpen(true)
      return
    }
    void runSync()
  }

  /** Called when the operator submits the prompt. */
  async function onAuthorise() {
    const trimmed = keyDraft.trim()
    if (!trimmed) {
      setKeyError('Enter the sync key.')
      return
    }
    setSyncKey(trimmed)
    setPromptOpen(false)
    setKeyError('')
    await runSync(/* wasAuthorised */ true)
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

      {/* Sync-key prompt dialog */}
      <Dialog open={promptOpen} onOpenChange={(open) => !open && setPromptOpen(false)}>
        <DialogContent aria-describedby="sync-key-desc">
          <DialogHeader>
            <DialogTitle>Authorise CC sync</DialogTitle>
            <DialogDescription id="sync-key-desc">
              Enter the sync key to push captured dims to CartonCloud. The key
              is held for this browser session only.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label htmlFor="sync-key-input" className="text-sm font-medium">
              Sync key
            </label>
            <Input
              id="sync-key-input"
              type="password"
              autoComplete="off"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onAuthorise()
              }}
              placeholder="Enter sync key"
            />
            {keyError && (
              <p className="text-sm text-destructive" role="alert">
                {keyError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPromptOpen(false)
                setKeyDraft('')
                setKeyError('')
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void onAuthorise()}>
              Authorise &amp; Sync
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
