import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useParams: () => ({ barcode: '9300675024635' }),
  useNavigate: () => navigate,
}))

const enqueue = vi.fn()
const refresh = vi.fn()
vi.mock('@/context/OfflineQueueContext', () => ({ useOfflineQueue: () => ({ enqueue }) }))
vi.mock('@/context/ProgressContext', () => ({
  useProgressContext: () => ({ progress: { total: 460, captured: 47 }, refresh }),
}))
vi.mock('@/lib/feedback', () => ({ playBeep: vi.fn(), vibrate: vi.fn() }))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    api: {
      getSkuByBarcode: vi.fn(),
      saveDim: vi.fn(),
      savePhoto: vi.fn(),
    },
  }
})

import { ApiError, api } from '@/lib/api'
import { FloorCapture } from '@/floor/FloorCapture'

const mockApi = vi.mocked(api)
const SKU = {
  id: 'prod-uuid-1',
  barcode: '9300675024635',
  name: 'Forage Free-Range Eggs 700g',
  hasDims: false,
  ccDimsCaptured: false,
  source: 'db' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('dim-capture-measuredBy', 'Jake')
  mockApi.getSkuByBarcode.mockResolvedValue(SKU)
})

async function enterDims() {
  const user = userEvent.setup()
  await screen.findByText('Forage Free-Range Eggs 700g')
  await user.type(screen.getByLabelText('L'), '30')
  await user.type(screen.getByLabelText('W'), '20')
  await user.type(screen.getByLabelText('H'), '15')
  await user.type(screen.getByLabelText('KG'), '12')
  return user
}

describe('FloorCapture', () => {
  it('looks up the scanned SKU and shows it', async () => {
    render(<FloorCapture />)
    expect(await screen.findByText('Forage Free-Range Eggs 700g')).toBeInTheDocument()
    expect(mockApi.getSkuByBarcode).toHaveBeenCalledWith('9300675024635')
    expect(screen.getByText('Needs dims')).toBeInTheDocument()
  })

  it('computes the cm volume live (30×20×15 = 9,000 cm³)', async () => {
    render(<FloorCapture />)
    await enterDims()
    expect(screen.getByText('9,000')).toBeInTheDocument()
    expect(screen.getByText('0.009 m³')).toBeInTheDocument()
  })

  it('saves dims converted cm→mm, with the chosen product type', async () => {
    mockApi.saveDim.mockResolvedValue({ id: 5 } as never)
    render(<FloorCapture />)
    const user = await enterDims()
    await user.click(screen.getByRole('button', { name: 'Chilled' }))
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(mockApi.saveDim).toHaveBeenCalledTimes(1))
    expect(mockApi.saveDim).toHaveBeenCalledWith({
      skuId: 'prod-uuid-1',
      lengthMm: 300,
      widthMm: 200,
      heightMm: 150,
      weightKg: 12,
      measuredBy: 'Jake',
      productType: 'Chilled',
    })
    expect(navigate).toHaveBeenCalledWith('/floor')
  })

  it('queues the dims offline when the backend is unreachable', async () => {
    mockApi.saveDim.mockRejectedValue(new ApiError(0, 'Network error', null))
    render(<FloorCapture />)
    const user = await enterDims()
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1))
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ skuId: 'prod-uuid-1', lengthMm: 300 }),
    )
  })

  it('blocks save with a clear error until L/W/H/weight are entered', async () => {
    render(<FloorCapture />)
    await screen.findByText('Forage Free-Range Eggs 700g')
    await userEvent.setup().click(screen.getByRole('button', { name: /save/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/greater than 0/i)
    expect(mockApi.saveDim).not.toHaveBeenCalled()
  })
})
