import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearQueue,
  countPendingDims,
  enqueueDim,
  getPendingDims,
  removePendingDim,
} from '@/lib/offlineQueue'
import type { SaveDimPayload } from '@/lib/api'

const payload = (skuId: string): SaveDimPayload => ({
  skuId,
  lengthMm: 300,
  widthMm: 200,
  heightMm: 150,
  weightKg: 2.4,
  measuredBy: 'Jake',
})

describe('offlineQueue', () => {
  beforeEach(async () => {
    await clearQueue()
  })

  it('enqueues a capture with a generated id and timestamp', async () => {
    const entry = await enqueueDim(payload('sku-1'), '2026-06-03T00:00:00.000Z')
    expect(entry.queueId).toBeTruthy()
    expect(entry.queuedAt).toBe('2026-06-03T00:00:00.000Z')
    expect(entry.skuId).toBe('sku-1')
    expect(await countPendingDims()).toBe(1)
  })

  it('returns pending dims oldest-first', async () => {
    await enqueueDim(payload('sku-1'), '2026-06-03T00:00:02.000Z')
    await enqueueDim(payload('sku-2'), '2026-06-03T00:00:01.000Z')
    const pending = await getPendingDims()
    expect(pending.map((p) => p.skuId)).toEqual(['sku-2', 'sku-1'])
  })

  it('removes an entry by queueId', async () => {
    const a = await enqueueDim(payload('sku-1'), '2026-06-03T00:00:00.000Z')
    await enqueueDim(payload('sku-2'), '2026-06-03T00:00:01.000Z')
    await removePendingDim(a.queueId)
    expect(await countPendingDims()).toBe(1)
    const remaining = await getPendingDims()
    expect(remaining[0]?.skuId).toBe('sku-2')
  })

  it('clears the whole queue', async () => {
    await enqueueDim(payload('sku-1'), '2026-06-03T00:00:00.000Z')
    await clearQueue()
    expect(await countPendingDims()).toBe(0)
  })
})
