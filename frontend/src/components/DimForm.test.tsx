import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DimForm } from '@/components/DimForm'
import { OfflineQueueProvider } from '@/context/OfflineQueueContext'
import { ApiError, api, type SkuDetail } from '@/lib/api'
import { clearQueue, countPendingDims } from '@/lib/offlineQueue'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, saveDim: vi.fn() } }
})

const saveMock = vi.mocked(api.saveDim)

const sku: SkuDetail = {
  id: 'sku-1',
  barcode: '9311111000011',
  name: 'Test SKU',
  hasDims: false,
  ccDimsCaptured: false,
  source: 'db',
}

function renderForm(onSaved = vi.fn()) {
  render(
    <OfflineQueueProvider>
      <DimForm sku={sku} onSaved={onSaved} />
    </OfflineQueueProvider>,
  )
  return onSaved
}

function fillValidDims() {
  fireEvent.change(screen.getByLabelText(/length/i), { target: { value: '300' } })
  fireEvent.change(screen.getByLabelText(/width/i), { target: { value: '200' } })
  fireEvent.change(screen.getByLabelText(/height/i), { target: { value: '150' } })
  fireEvent.change(screen.getByLabelText(/weight/i), { target: { value: '2.4' } })
  fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Jake' } })
}

describe('DimForm', () => {
  beforeEach(async () => {
    saveMock.mockReset()
    localStorage.clear()
    await clearQueue()
  })
  afterEach(() => clearQueue())

  it('converts displayed values when the unit toggle changes (mm → cm)', () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/length/i), { target: { value: '300' } })
    fireEvent.click(screen.getByRole('button', { name: 'cm' }))
    expect(screen.getByLabelText(/length \(cm\)/i)).toHaveValue(30)
  })

  it('blocks save and shows an error when fields are empty', async () => {
    const onSaved = renderForm()
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(saveMock).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('posts mm values and reports "saved" on success', async () => {
    saveMock.mockResolvedValue({} as never)
    const onSaved = renderForm()
    fillValidDims()
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    expect(saveMock).toHaveBeenCalledWith({
      skuId: 'sku-1',
      lengthMm: 300,
      widthMm: 200,
      heightMm: 150,
      weightKg: 2.4,
      measuredBy: 'Jake',
    })
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('saved'))
    expect(localStorage.getItem('dim-capture-measuredBy')).toBe('Jake')
  })

  it('queues offline and reports "queued" when the backend is unreachable', async () => {
    saveMock.mockRejectedValue(new ApiError(0, 'offline', null))
    const onSaved = renderForm()
    fillValidDims()
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('queued'))
    expect(await countPendingDims()).toBe(1)
  })
})
