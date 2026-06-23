import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Review from '@/pages/Review'
import { OfflineQueueProvider } from '@/context/OfflineQueueContext'
import { ProgressProvider } from '@/context/ProgressContext'
import { api, type DimWithSku } from '@/lib/api'
import { clearQueue } from '@/lib/offlineQueue'
import { clearSyncKey, setSyncKey } from '@/lib/syncKey'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      getDims: vi.fn(),
      getProgress: vi.fn(),
      syncToCC: vi.fn(),
      updateDim: vi.fn(),
    },
  }
})

const dimsMock = vi.mocked(api.getDims)
const progressMock = vi.mocked(api.getProgress)
const syncMock = vi.mocked(api.syncToCC)
const updateMock = vi.mocked(api.updateDim)

const DIM: DimWithSku = {
  id: 10,
  skuId: 'cc-1',
  lengthMm: 300,
  widthMm: 200,
  heightMm: 150,
  weightKg: 2.4,
  measuredBy: 'Jake',
  measuredAt: '2026-06-03T00:00:00.000Z',
  syncedToCC: false,
  syncedAt: null,
  notes: null,
  productType: null,
  photoPath: null,
  sku: { name: 'Alpha', barcode: 'b1' },
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ProgressProvider>
      <OfflineQueueProvider>{children}</OfflineQueueProvider>
    </ProgressProvider>
  )
}

describe('Review page', () => {
  beforeEach(async () => {
    dimsMock.mockResolvedValue([DIM])
    progressMock.mockResolvedValue({
      total: 3,
      captured: 1,
      syncedToCC: 0,
      pendingSync: 1,
      percentage: 33,
    })
    syncMock.mockReset().mockResolvedValue({ synced: 1, failed: 0, pending: 0 })
    updateMock.mockReset().mockResolvedValue({} as never)
    localStorage.setItem('dim-capture-measuredBy', 'Jake')
    // Provide a sync key so tests that click Sync Now go straight to the sync
    // call (no prompt). Tests for the prompt itself live in Review.syncKey.test.tsx.
    setSyncKey('test-secret')
    await clearQueue()
  })
  afterEach(async () => {
    clearSyncKey()
    await clearQueue()
  })

  it('lists recent captures with their dims', async () => {
    render(<Review />, { wrapper })
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText(/300×200×150 mm · 2.4 kg/)).toBeInTheDocument()
  })

  it('Sync Now triggers POST /api/sync/cc', async () => {
    render(<Review />, { wrapper })
    await screen.findByText('Alpha')
    fireEvent.click(screen.getByRole('button', { name: /sync now/i }))
    await waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1))
    // sync triggers a reload of the dim list — wait for it (2nd getDims)
    await waitFor(() => expect(dimsMock.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('editing a capture PUTs by dim id', async () => {
    render(<Review />, { wrapper })
    await screen.findByText('Alpha')
    fireEvent.click(screen.getByRole('button', { name: /edit alpha/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/length/i), { target: { value: '305' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(updateMock).toHaveBeenCalledWith(10, expect.objectContaining({ lengthMm: 305 }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
