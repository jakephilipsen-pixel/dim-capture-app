import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSku } from '@/hooks/useSku'
import { ApiError, api, type SkuDetail } from '@/lib/api'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, getSkuByBarcode: vi.fn() } }
})

const lookup = vi.mocked(api.getSkuByBarcode)

const sku: SkuDetail = {
  id: 'sku-1',
  barcode: '9311111000011',
  name: 'CADBURY DAIRY MILK 200G',
  hasDims: false,
  ccDimsCaptured: false,
  source: 'db',
}

describe('useSku', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    lookup.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves a SKU after the debounce window', async () => {
    lookup.mockResolvedValue(sku)
    const { result } = renderHook(() => useSku('9311111000011', 300))

    expect(result.current.loading).toBe(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup).toHaveBeenCalledWith('9311111000011')
    expect(result.current.sku).toEqual(sku)
    expect(result.current.loading).toBe(false)
  })

  it('flags notFound on a 404', async () => {
    lookup.mockRejectedValue(new ApiError(404, 'Not found', null))
    const { result } = renderHook(() => useSku('nope', 300))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(result.current.notFound).toBe(true)
    expect(result.current.sku).toBeNull()
  })

  it('does not call the API for blank input', async () => {
    const { result } = renderHook(() => useSku('   ', 300))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(lookup).not.toHaveBeenCalled()
    expect(result.current.sku).toBeNull()
  })
})
