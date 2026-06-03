import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '@/lib/api'

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

describe('api wrappers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>
  const firstCall = (): [string, RequestInit] => {
    const call = fetchMock().mock.calls[0]
    if (!call) throw new Error('fetch was not called')
    return call as [string, RequestInit]
  }

  it('getProgress hits /api/progress and returns parsed JSON', async () => {
    const payload = { total: 460, captured: 47, syncedToCC: 43, pendingSync: 4, percentage: 10.2 }
    fetchMock().mockResolvedValueOnce(okJson(payload))

    const result = await api.getProgress()

    expect(result).toEqual(payload)
    const [url] = firstCall()
    expect(url).toContain('/api/progress')
  })

  it('getSkuByBarcode URL-encodes the barcode', async () => {
    fetchMock().mockResolvedValueOnce(
      okJson({ id: 'x', barcode: 'a b', name: 'n', hasDims: false, ccDimsCaptured: false, source: 'db' }),
    )
    await api.getSkuByBarcode('a b')
    const [url] = firstCall()
    expect(url).toContain('/api/skus/a%20b')
  })

  it('saveDim POSTs JSON with a content-type header', async () => {
    fetchMock().mockResolvedValueOnce(okJson({ id: 1 }))
    await api.saveDim({
      skuId: 's1',
      lengthMm: 300,
      widthMm: 200,
      heightMm: 150,
      weightKg: 2.4,
      measuredBy: 'Jake',
    })
    const [, init] = firstCall()
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toMatchObject({ skuId: 's1', measuredBy: 'Jake' })
  })

  it('throws ApiError carrying status + backend error message on non-2xx', async () => {
    fetchMock().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
    )
    await expect(api.getSkuByBarcode('nope')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'Not found',
    })
  })

  it('maps a network failure to ApiError status 0', async () => {
    fetchMock().mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const err = await api.getProgress().catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(0)
  })
})
