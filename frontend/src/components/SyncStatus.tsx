import { Cloud, CloudOff, RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { useOfflineQueueCount } from '@/context/OfflineQueueContext'
import { useProgressContext } from '@/context/ProgressContext'
import { cn } from '@/lib/utils'

export interface SyncStatusProps {
  className?: string
}

/**
 * Pending-sync badge. Combines the backend's `pendingSync` (dims not yet pushed
 * to CC) with the local IndexedDB offline-queue count (captures not yet POSTed).
 * `useOfflineQueueCount` returns 0 when no `OfflineQueueProvider` is mounted, so
 * this component still renders correctly in the bare shell. States:
 *   - loading first fetch          → spinner
 *   - backend unreachable, queue 0 → "offline"
 *   - backend unreachable, queue>0 → "{n} queued"
 *   - nothing pending              → "synced"
 *   - something pending            → "{n} to sync"
 */
export function SyncStatus({ className }: SyncStatusProps) {
  const { progress, loading, error } = useProgressContext()
  const queued = useOfflineQueueCount()
  const backendPending = progress?.pendingSync ?? 0
  const totalPending = backendPending + queued

  if (loading && !progress && queued === 0) {
    return (
      <Badge variant="secondary" className={cn('gap-1', className)}>
        <RefreshCw className="size-3 animate-spin" />
        <span>…</span>
      </Badge>
    )
  }

  if (error || !progress) {
    return (
      <Badge variant="secondary" className={cn('gap-1', className)}>
        <CloudOff className="size-3" />
        <span>{queued > 0 ? `${queued} queued` : 'offline'}</span>
      </Badge>
    )
  }

  if (totalPending === 0) {
    return (
      <Badge variant="success" className={cn('gap-1', className)}>
        <Cloud className="size-3" />
        <span>synced</span>
      </Badge>
    )
  }

  return (
    <Badge variant="default" className={cn('gap-1', className)}>
      <RefreshCw className="size-3" />
      <span>{totalPending} to sync</span>
    </Badge>
  )
}
