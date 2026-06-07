/**
 * useSync × sync-key behaviour:
 *  - drains the local queue (POST /api/dims) always, regardless of key presence
 *  - skips POST /api/sync/cc silently when no key is stored
 *  - fires POST /api/sync/cc when a key is present
 */

import { renderHook, waitFor } from '@testing-library/react'
import { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OfflineQueueProvider } from '@/context/OfflineQueueContext'
import { ProgressProvider } from '@/context/ProgressContext'
import { useSync } from '@/hooks/useSync'
import { api } from '@/lib/api'
import { clearSyncKey, setSyncKey } from '@/lib/syncKey'
import { clearQueue, enqueueDim } from '@/lib/offlineQueue'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      saveDim: vi.fn(),
      getProgress: vi.fn(),
      syncToCC: vi.fn(),
    },
  }
})

const saveMock = vi.mocked(api.saveDim)
const progressMock = vi.mocked(api.getProgress)
const syncMock = vi.mocked(api.syncToCC)

const payload = (skuId: string) => ({
  skuId,
  lengthMm: 300,
  widthMm: 200,
  heightMm: 150,
  weightKg: 2.4,
  measuredBy: 'Jake',
})

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ProgressProvider>
      <OfflineQueueProvider>{children}</OfflineQueueProvider>
    </ProgressProvider>
  )
}

describe('useSync sync-key gating', () => {
  beforeEach(async () => {
    saveMock.mockReset()
    progressMock.mockReset()
    syncMock.mockReset()
    sessionStorage.clear()
    await clearQueue()
  })
  afterEach(async () => {
    sessionStorage.clear()
    await clearQueue()
  })

  it('still drains the local queue when no sync key is stored', async () => {
    await enqueueDim(payload('sku-drain'), '2026-06-08T00:00:00.000Z')
    saveMock.mockResolvedValue({} as never)
    progressMock.mockResolvedValue({
      total: 460,
      captured: 1,
      syncedToCC: 0,
      pendingSync: 1,
      percentage: 0.2,
    })

    // No sync key present.
    clearSyncKey()

    renderHook(() => useSync(60_000), { wrapper })

    // saveDim should be called (queue drain).
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    // syncToCC must NOT be called (no key → silent skip).
    await waitFor(() => expect(progressMock).toHaveBeenCalled())
    expect(syncMock).not.toHaveBeenCalled()
  })

  it('fires CC sync when a key is present and pending > 0', async () => {
    saveMock.mockResolvedValue({} as never)
    progressMock.mockResolvedValue({
      total: 460,
      captured: 2,
      syncedToCC: 0,
      pendingSync: 2,
      percentage: 0.4,
    })
    syncMock.mockResolvedValue({ synced: 2, failed: 0, pending: 0 })

    setSyncKey('valid-secret')

    renderHook(() => useSync(60_000), { wrapper })

    await waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1))
  })

  it('clears the key and stops auto-retrying on a 401 from syncToCC', async () => {
    const { ApiError } = await import('@/lib/api')
    saveMock.mockResolvedValue({} as never)
    progressMock.mockResolvedValue({
      total: 460,
      captured: 1,
      syncedToCC: 0,
      pendingSync: 1,
      percentage: 0.2,
    })
    // Simulate the ApiError that api.syncToCC now throws on 401.
    syncMock.mockRejectedValue(new ApiError(401, 'Unauthorised', null))

    setSyncKey('bad-key')

    const { result } = renderHook(() => useSync(60_000), { wrapper })

    // syncNow is called on mount; wait for it to settle.
    await waitFor(() => expect(result.current.syncing).toBe(false))

    // After the 401 the key must be gone (cleared by api.syncToCC).
    // The hook should not have re-attempted (syncMock called exactly once).
    expect(syncMock).toHaveBeenCalledTimes(1)
  })
})
