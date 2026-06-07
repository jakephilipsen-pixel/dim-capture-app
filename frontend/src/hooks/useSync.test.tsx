import { renderHook, waitFor } from '@testing-library/react'
import { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OfflineQueueProvider } from '@/context/OfflineQueueContext'
import { ProgressProvider } from '@/context/ProgressContext'
import { useSync } from '@/hooks/useSync'
import { api } from '@/lib/api'
import { clearQueue, countPendingDims, enqueueDim } from '@/lib/offlineQueue'
import { clearSyncKey, setSyncKey } from '@/lib/syncKey'

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

describe('useSync', () => {
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

  it('drains the offline queue to POST /api/dims, then triggers CC sync', async () => {
    // A sync key must be present for the CC-sync step to fire.
    setSyncKey('test-secret')
    await enqueueDim(payload('sku-1'), '2026-06-03T00:00:00.000Z')
    await enqueueDim(payload('sku-2'), '2026-06-03T00:00:01.000Z')
    saveMock.mockResolvedValue({} as never)
    progressMock.mockResolvedValue({
      total: 460,
      captured: 2,
      syncedToCC: 0,
      pendingSync: 2,
      percentage: 0.4,
    })
    syncMock.mockResolvedValue({ synced: 2, failed: 0, pending: 0 })

    renderHook(() => useSync(60_000), { wrapper })

    // mount → syncNow(): two POSTs, queue emptied, CC sync fired.
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2))
    expect(saveMock).toHaveBeenCalledWith(payload('sku-1'))
    expect(saveMock).toHaveBeenCalledWith(payload('sku-2'))
    await waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1))
    expect(await countPendingDims()).toBe(0)
    clearSyncKey()
  })

  it('does not trigger CC sync when nothing is pending', async () => {
    progressMock.mockResolvedValue({
      total: 460,
      captured: 0,
      syncedToCC: 0,
      pendingSync: 0,
      percentage: 0,
    })

    renderHook(() => useSync(60_000), { wrapper })

    await waitFor(() => expect(progressMock).toHaveBeenCalled())
    expect(syncMock).not.toHaveBeenCalled()
  })
})
