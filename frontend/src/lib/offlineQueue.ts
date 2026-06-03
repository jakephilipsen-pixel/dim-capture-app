import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import type { SaveDimPayload } from '@/lib/api'

/**
 * IndexedDB offline queue for dim captures.
 *
 * When the backend is unreachable a capture is written here instead of lost.
 * `useSync` drains the queue (POST /api/dims) once connectivity returns and
 * removes each entry on HTTP success. One store, keyed by a local UUID.
 */

export interface PendingDim extends SaveDimPayload {
  /** Local primary key (not the backend dim id). */
  queueId: string
  /** ISO timestamp the capture was queued. */
  queuedAt: string
}

interface DimCaptureDB extends DBSchema {
  pendingDims: {
    key: string
    value: PendingDim
  }
}

const DB_NAME = 'dim-capture'
const DB_VERSION = 1
const STORE = 'pendingDims'

let dbPromise: Promise<IDBPDatabase<DimCaptureDB>> | null = null

function getDb(): Promise<IDBPDatabase<DimCaptureDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DimCaptureDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'queueId' })
        }
      },
    })
  }
  return dbPromise
}

function makeQueueId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for environments without crypto.randomUUID.
  return `q-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
}

/** Append a capture to the queue. Returns the stored entry (with queueId). */
export async function enqueueDim(payload: SaveDimPayload, queuedAt: string): Promise<PendingDim> {
  const entry: PendingDim = { ...payload, queueId: makeQueueId(), queuedAt }
  const db = await getDb()
  await db.put(STORE, entry)
  return entry
}

/** All queued captures, oldest first. */
export async function getPendingDims(): Promise<PendingDim[]> {
  const db = await getDb()
  const all = await db.getAll(STORE)
  return all.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
}

/** Number of captures awaiting sync. */
export async function countPendingDims(): Promise<number> {
  const db = await getDb()
  return db.count(STORE)
}

/** Remove a single entry by its local queue id (call after a successful POST). */
export async function removePendingDim(queueId: string): Promise<void> {
  const db = await getDb()
  await db.delete(STORE, queueId)
}

/** Wipe the queue (used by tests; not part of the normal flow). */
export async function clearQueue(): Promise<void> {
  const db = await getDb()
  await db.clear(STORE)
}
