import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, api } from '@/lib/api'
import { useOfflineQueue } from '@/context/OfflineQueueContext'
import { useProgressContext } from '@/context/ProgressContext'

export interface UseSyncResult {
  online: boolean
  syncing: boolean
  /** Captures still queued locally in IndexedDB. */
  pendingLocal: number
  /** Manually trigger a sync (also runs on `online` event + every `pollMs`). */
  syncNow: () => Promise<void>
}

/**
 * Background sync manager. Mounted once (via <SyncManager/> in App). It:
 *   1. drains the IndexedDB offline queue → POST /api/dims (removing each on success)
 *   2. triggers POST /api/sync/cc when the backend reports pending dims
 * Runs on mount, on the browser `online` event, and every `pollMs` (default 30s).
 */
export function useSync(pollMs = 30_000): UseSyncResult {
  const { refresh } = useProgressContext()
  const { pendingLocal, list, remove, refreshQueue } = useOfflineQueue()
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const [syncing, setSyncing] = useState(false)
  const busy = useRef(false)

  const syncNow = useCallback(async () => {
    if (busy.current) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    busy.current = true
    setSyncing(true)
    try {
      // 1. Drain the local offline queue.
      const pending = await list()
      for (const entry of pending) {
        const { queueId, queuedAt, ...payload } = entry
        void queuedAt
        try {
          await api.saveDim(payload)
          await remove(queueId)
        } catch (err) {
          // Backend unreachable again — stop; retry on the next tick.
          if (err instanceof ApiError && err.status === 0) break
          // Permanent error (e.g. 422/404): leave it queued and move on.
        }
      }

      // 2. Push backend-side unsynced dims to CartonCloud.
      try {
        const progress = await api.getProgress()
        if (progress.pendingSync > 0) await api.syncToCC()
      } catch {
        // Progress/sync unreachable — next tick will retry.
      }
    } finally {
      await refreshQueue()
      await refresh()
      busy.current = false
      setSyncing(false)
    }
  }, [list, remove, refreshQueue, refresh])

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true)
      void syncNow()
    }
    const handleOffline = () => setOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    void syncNow()
    const id = setInterval(() => void syncNow(), pollMs)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearInterval(id)
    }
  }, [syncNow, pollMs])

  return { online, syncing, pendingLocal, syncNow }
}
