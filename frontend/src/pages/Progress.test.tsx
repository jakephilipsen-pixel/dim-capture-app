import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Progress from '@/pages/Progress'
import { OfflineQueueProvider } from '@/context/OfflineQueueContext'
import { ProgressProvider } from '@/context/ProgressContext'
import { api, type DimWithSku, type SkuListResponse } from '@/lib/api'
import { clearQueue } from '@/lib/offlineQueue'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      getSkus: vi.fn(),
      getDims: vi.fn(),
      getProgress: vi.fn(),
      saveDim: vi.fn(),
      updateDim: vi.fn(),
    },
  }
})

const skusMock = vi.mocked(api.getSkus)
const dimsMock = vi.mocked(api.getDims)
const progressMock = vi.mocked(api.getProgress)
const saveMock = vi.mocked(api.saveDim)
const updateMock = vi.mocked(api.updateDim)

const SKUS: SkuListResponse = {
  total: 3,
  captured: 1,
  skus: [
    { id: 'cc-1', barcode: 'b1', name: 'Alpha', hasDims: true },
    { id: 'cc-2', barcode: 'b2', name: 'Bravo', hasDims: false },
    { id: 'cc-3', barcode: 'b3', name: 'Charlie', hasDims: false },
  ],
}

const ALPHA_DIM: DimWithSku = {
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
  sku: { name: 'Alpha', barcode: 'b1' },
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ProgressProvider>
      <OfflineQueueProvider>{children}</OfflineQueueProvider>
    </ProgressProvider>
  )
}

async function renderProgress() {
  render(<Progress />, { wrapper })
  // wait for the initial load to paint the rows
  await screen.findByRole('button', { name: /alpha/i })
}

describe('Progress page', () => {
  beforeEach(async () => {
    skusMock.mockResolvedValue(SKUS)
    dimsMock.mockResolvedValue([ALPHA_DIM])
    progressMock.mockResolvedValue({
      total: 3,
      captured: 1,
      syncedToCC: 0,
      pendingSync: 1,
      percentage: 33,
    })
    saveMock.mockReset().mockResolvedValue({} as never)
    updateMock.mockReset().mockResolvedValue({} as never)
    localStorage.setItem('dim-capture-measuredBy', 'Jake')
    await clearQueue()
  })
  afterEach(() => clearQueue())

  it('filters to Missing (hides captured SKUs)', async () => {
    await renderProgress()
    fireEvent.click(screen.getByRole('button', { name: 'Missing' }))
    expect(screen.queryByRole('button', { name: /alpha/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /bravo/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /charlie/i })).toBeInTheDocument()
  })

  it('search narrows the list by name', async () => {
    await renderProgress()
    fireEvent.change(screen.getByLabelText('Search SKUs'), { target: { value: 'brav' } })
    expect(screen.getByRole('button', { name: /bravo/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /alpha/i })).not.toBeInTheDocument()
  })

  it('editing a captured SKU PUTs by dim id', async () => {
    await renderProgress()
    fireEvent.click(screen.getByRole('button', { name: /alpha/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(updateMock).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ lengthMm: 300, widthMm: 200, heightMm: 150, weightKg: 2.4 }),
    )
    expect(saveMock).not.toHaveBeenCalled()
    // let the post-save reload settle (sheet closes)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('capturing a missing SKU POSTs a new dim', async () => {
    await renderProgress()
    fireEvent.click(screen.getByRole('button', { name: /bravo/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/length/i), { target: { value: '100' } })
    fireEvent.change(within(dialog).getByLabelText(/width/i), { target: { value: '90' } })
    fireEvent.change(within(dialog).getByLabelText(/height/i), { target: { value: '80' } })
    fireEvent.change(within(dialog).getByLabelText(/weight/i), { target: { value: '1.1' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ skuId: 'cc-2', lengthMm: 100, weightKg: 1.1 }),
    )
    expect(updateMock).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
