import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import type { SaveDimPayload } from '@/lib/api'
import {
  countPendingDims,
  enqueueDim,
  getPendingDims,
  removePendingDim,
  type PendingDim,
} from '@/lib/offlineQueue'

export interface OfflineQueueValue {
  /** Number of captures sitting in IndexedDB awaiting POST. */
  pendingLocal: number
  /** Write a capture to the offline queue (used when the backend is unreachable). */
  enqueue: (payload: SaveDimPayload) => Promise<PendingDim>
  /** Read all queued captures (oldest first). */
  list: () => Promise<PendingDim[]>
  /** Remove an entry after a successful POST. */
  remove: (queueId: string) => Promise<void>
  /** Re-read the count from IndexedDB. */
  refreshQueue: () => Promise<void>
}

const OfflineQueueContext = createContext<OfflineQueueValue | null>(null)

/**
 * Tracks the IndexedDB offline-queue count for the whole app so `SyncStatus`
 * (in the shell) and the Capture page show a consistent pending number.
 */
export function OfflineQueueProvider({ children }: { children: ReactNode }) {
  const [pendingLocal, setPendingLocal] = useState(0)
  const mounted = useRef(true)

  const refreshQueue = useCallback(async () => {
    try {
      const n = await countPendingDims()
      if (mounted.current) setPendingLocal(n)
    } catch {
      // IndexedDB unavailable (private mode) — treat as empty queue.
      if (mounted.current) setPendingLocal(0)
    }
  }, [])

  const enqueue = useCallback(
    async (payload: SaveDimPayload) => {
      const entry = await enqueueDim(payload, new Date().toISOString())
      await refreshQueue()
      return entry
    },
    [refreshQueue],
  )

  const remove = useCallback(
    async (queueId: string) => {
      await removePendingDim(queueId)
      await refreshQueue()
    },
    [refreshQueue],
  )

  const list = useCallback(() => getPendingDims(), [])

  useEffect(() => {
    mounted.current = true
    void refreshQueue()
    return () => {
      mounted.current = false
    }
  }, [refreshQueue])

  const value: OfflineQueueValue = { pendingLocal, enqueue, list, remove, refreshQueue }
  return <OfflineQueueContext.Provider value={value}>{children}</OfflineQueueContext.Provider>
}

/** Full queue API. Throws if used outside the provider. */
export function useOfflineQueue(): OfflineQueueValue {
  const ctx = useContext(OfflineQueueContext)
  if (!ctx) {
    throw new Error('useOfflineQueue must be used within an <OfflineQueueProvider>')
  }
  return ctx
}

/**
 * Safe count accessor for shared components (e.g. SyncStatus) that may render
 * without the provider — returns 0 instead of throwing.
 */
export function useOfflineQueueCount(): number {
  return useContext(OfflineQueueContext)?.pendingLocal ?? 0
}
