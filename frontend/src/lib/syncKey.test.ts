import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearSyncKey, getSyncKey, setSyncKey } from '@/lib/syncKey'

// Each test uses a real (jsdom) sessionStorage — reset between tests.
beforeEach(() => sessionStorage.clear())
afterEach(() => sessionStorage.clear())

describe('syncKey store', () => {
  it('getSyncKey returns null when nothing is stored', () => {
    expect(getSyncKey()).toBeNull()
  })

  it('setSyncKey + getSyncKey round-trips correctly', () => {
    setSyncKey('super-secret')
    expect(getSyncKey()).toBe('super-secret')
  })

  it('setSyncKey overwrites a previously stored value', () => {
    setSyncKey('old-value')
    setSyncKey('new-value')
    expect(getSyncKey()).toBe('new-value')
  })

  it('clearSyncKey removes the stored key', () => {
    setSyncKey('to-remove')
    clearSyncKey()
    expect(getSyncKey()).toBeNull()
  })

  it('clearSyncKey is safe to call when no key is stored', () => {
    expect(() => clearSyncKey()).not.toThrow()
    expect(getSyncKey()).toBeNull()
  })

  it('getSyncKey returns null when sessionStorage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    })
    expect(getSyncKey()).toBeNull()
    spy.mockRestore()
  })

  it('setSyncKey does not throw when sessionStorage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    })
    expect(() => setSyncKey('key')).not.toThrow()
    spy.mockRestore()
  })
})
