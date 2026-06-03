import { useEffect, useState } from 'react'
import { Cloud, RefreshCw } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { api, type DimWithSku } from '@/lib/api'

export interface RecentCapturesProps {
  /** Bump to force a reload (the Capture page increments this after each save). */
  reloadKey?: number
}

/** Last 10 persisted captures with a sync-status icon. Offline-queued captures
 *  are not shown here — their count lives in the SyncStatus badge. */
export function RecentCaptures({ reloadKey = 0 }: RecentCapturesProps) {
  const [dims, setDims] = useState<DimWithSku[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    api
      .getDims()
      .then((all) => {
        if (active) setDims(all.slice(0, 10))
      })
      .catch(() => {
        // Backend unreachable — leave the list as-is (offline).
      })
      .finally(() => {
        if (active) setLoaded(true)
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  if (loaded && dims.length === 0) {
    return (
      <p className="px-1 text-sm text-muted-foreground">No captures yet. Scan an item to begin.</p>
    )
  }

  return (
    <ul className="space-y-2" aria-label="Recent captures">
      {dims.map((d) => (
        <li key={d.id}>
          <Card className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{d.sku.name}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {d.lengthMm}×{d.widthMm}×{d.heightMm} mm · {d.weightKg} kg
              </p>
            </div>
            {d.syncedToCC ? (
              <Cloud className="size-4 shrink-0 text-emerald-600" aria-label="Synced to CartonCloud" />
            ) : (
              <RefreshCw className="size-4 shrink-0 text-muted-foreground" aria-label="Pending sync" />
            )}
          </Card>
        </li>
      ))}
    </ul>
  )
}
