/**
 * Sync-key store backed by sessionStorage.
 *
 * The operator enters the CC sync secret once per browser session via the
 * Review page prompt. It is held here for the lifetime of the tab and sent
 * as `X-Sync-Key` on POST /api/sync/cc calls only. Closing the tab clears it
 * — re-authorisation is required next session (deliberate human-approval gate).
 *
 * POST /api/dims (capture/queue drain) is UNGATED and must never receive the
 * key — this store is only consumed by api.syncToCC().
 */

const STORAGE_KEY = 'dca.syncKey'

/**
 * Returns the stored sync key, or null if not yet entered this session.
 * Safe to call in environments where sessionStorage is unavailable (SSR, test
 * runners that don't expose the Web Storage API).
 */
export function getSyncKey(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * Stores the sync key for this browser session.
 */
export function setSyncKey(value: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, value)
  } catch {
    // sessionStorage unavailable — key simply won't persist.
  }
}

/**
 * Removes the stored sync key, e.g. after a 401 from the backend.
 */
export function clearSyncKey(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
}
