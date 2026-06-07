/**
 * api.syncToCC() × sync-key behaviour:
 *  - sends X-Sync-Key header when a key is stored
 *  - on 401: clears the key + throws an ApiError with status 401
 *  - when no key is stored: throws without firing the network request
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '@/lib/api'
import { getSyncKey, setSyncKey } from '@/lib/syncKey'

beforeEach(() => {
  sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  sessionStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>
const firstCall = (): [string, RequestInit] => {
  const call = fetchMock().mock.calls[0]
  if (!call) throw new Error('fetch was not called')
  return call as [string, RequestInit]
}

describe('api.syncToCC with sync key', () => {
  it('sends X-Sync-Key header when a key is stored', async () => {
    setSyncKey('my-secret')
    fetchMock().mockResolvedValueOnce(okJson({ synced: 1, failed: 0, pending: 0 }))

    await api.syncToCC()

    const [, init] = firstCall()
    expect((init.headers as Record<string, string>)['X-Sync-Key']).toBe('my-secret')
  })

  it('does NOT send X-Sync-Key on saveDim (capture stays ungated)', async () => {
    setSyncKey('my-secret')
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
    expect((init.headers as Record<string, string>)['X-Sync-Key']).toBeUndefined()
  })

  it('on 401: clears the sync key and throws ApiError with status 401', async () => {
    setSyncKey('wrong-key')
    fetchMock().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 }),
    )

    const err = await api.syncToCC().catch((e) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(401)
    // Key must be cleared so the caller can prompt for a new one.
    expect(getSyncKey()).toBeNull()
  })

  it('throws ApiError with status 401 when no key is stored (no network request fired)', async () => {
    // sessionStorage.clear() was called in beforeEach; no key present.
    const err = await api.syncToCC().catch((e) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(401)
    // Must NOT have fired a network request.
    expect(fetchMock()).not.toHaveBeenCalled()
  })
})
