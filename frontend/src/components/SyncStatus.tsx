import { Cloud, CloudOff, RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { useProgressContext } from '@/context/ProgressContext'
import { cn } from '@/lib/utils'

export interface SyncStatusProps {
  className?: string
}

/**
 * Pending-sync badge. Reads live `pendingSync` from the progress context
 * (sourced from `GET /api/progress`). Three states:
 *   - backend unreachable → muted "offline"
 *   - pendingSync === 0   → green "synced"
 *   - pendingSync > 0     → primary "{n} to sync"
 */
export function SyncStatus({ className }: SyncStatusProps) {
  const { progress, loading, error } = useProgressContext()

  if (loading && !progress) {
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
        <span>offline</span>
      </Badge>
    )
  }

  if (progress.pendingSync === 0) {
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
      <span>{progress.pendingSync} to sync</span>
    </Badge>
  )
}
