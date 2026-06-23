/**
 * Review page × sync-key prompt behaviour:
 *  - clicking Sync Now with no key opens the sync-key prompt dialog
 *  - submitting the prompt stores the key and triggers sync
 *  - a 401 from syncToCC clears the key and re-opens the prompt with an error
 *  - clicking Sync Now when a key is already stored runs sync directly (no prompt)
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Review from '@/pages/Review'
import { OfflineQueueProvider } from '@/context/OfflineQueueContext'
import { ProgressProvider } from '@/context/ProgressContext'
import { ApiError, api, type DimWithSku } from '@/lib/api'
import { clearQueue } from '@/lib/offlineQueue'
import { clearSyncKey, getSyncKey, setSyncKey } from '@/lib/syncKey'

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

const DIM: DimWithSku = {
  id: 20,
  skuId: 'cc-2',
  lengthMm: 400,
  widthMm: 300,
  heightMm: 200,
  weightKg: 3.1,
  measuredBy: 'Jake',
  measuredAt: '2026-06-08T00:00:00.000Z',
  syncedToCC: false,
  syncedAt: null,
  notes: null,
  productType: null,
  photoPath: null,
  sku: { name: 'Beta', barcode: 'b2' },
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ProgressProvider>
      <OfflineQueueProvider>{children}</OfflineQueueProvider>
    </ProgressProvider>
  )
}

describe('Review page — sync-key prompt', () => {
  beforeEach(async () => {
    dimsMock.mockResolvedValue([DIM])
    progressMock.mockResolvedValue({
      total: 3,
      captured: 1,
      syncedToCC: 0,
      pendingSync: 1,
      percentage: 33,
    })
    syncMock.mockReset()
    localStorage.setItem('dim-capture-measuredBy', 'Jake')
    sessionStorage.clear()
    await clearQueue()
  })
  afterEach(async () => {
    sessionStorage.clear()
    await clearQueue()
  })

  it('opens the sync-key prompt when Sync Now is clicked with no key stored', async () => {
    clearSyncKey()
    render(<Review />, { wrapper })
    await screen.findByText('Beta')

    fireEvent.click(screen.getByRole('button', { name: /sync now/i }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText(/sync key/i)).toBeInTheDocument()
  })

  it('submitting the prompt stores the key and triggers sync', async () => {
    clearSyncKey()
    syncMock.mockResolvedValue({ synced: 1, failed: 0, pending: 0 })
    render(<Review />, { wrapper })
    await screen.findByText('Beta')

    // Open prompt.
    fireEvent.click(screen.getByRole('button', { name: /sync now/i }))
    const input = await screen.findByLabelText(/sync key/i)

    fireEvent.change(input, { target: { value: 'operator-secret' } })
    fireEvent.click(screen.getByRole('button', { name: /authorise/i }))

    await waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1))
    expect(getSyncKey()).toBe('operator-secret')
  })

  it('a 401 from syncToCC clears the key and re-shows the prompt with an error', async () => {
    clearSyncKey()
    syncMock.mockRejectedValueOnce(new ApiError(401, 'Unauthorised', null))
    render(<Review />, { wrapper })
    await screen.findByText('Beta')

    // Open prompt, submit a bad key.
    fireEvent.click(screen.getByRole('button', { name: /sync now/i }))
    const input = await screen.findByLabelText(/sync key/i)
    fireEvent.change(input, { target: { value: 'bad-key' } })
    fireEvent.click(screen.getByRole('button', { name: /authorise/i }))

    // Dialog stays open with an error message.
    await waitFor(() =>
      expect(screen.getByText(/sync key rejected/i)).toBeInTheDocument(),
    )
    expect(getSyncKey()).toBeNull()
    // The prompt is still visible for re-entry.
    expect(screen.getByLabelText(/sync key/i)).toBeInTheDocument()
  })

  it('runs sync directly without a prompt when a key is already stored', async () => {
    setSyncKey('valid-key')
    syncMock.mockResolvedValue({ synced: 1, failed: 0, pending: 0 })
    render(<Review />, { wrapper })
    await screen.findByText('Beta')

    fireEvent.click(screen.getByRole('button', { name: /sync now/i }))

    // No dialog should appear.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1))
  })
})
