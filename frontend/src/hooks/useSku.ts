import { useEffect, useRef, useState } from 'react'

import { ApiError, api, type SkuDetail } from '@/lib/api'

export interface UseSkuResult {
  sku: SkuDetail | null
  loading: boolean
  /** True when the lookup returned 404 (unknown to DB and CC). */
  notFound: boolean
  /** Non-404 failure message (e.g. backend unreachable), else null. */
  error: string | null
}

/**
 * Debounced SKU lookup by barcode. Empty/whitespace input clears the result.
 * A stale response is discarded if the barcode changed before it resolved.
 */
export function useSku(barcode: string, debounceMs = 300): UseSkuResult {
  const [sku, setSku] = useState<SkuDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    const trimmed = barcode.trim()
    if (!trimmed) {
      setSku(null)
      setLoading(false)
      setNotFound(false)
      setError(null)
      return
    }

    const id = ++requestId.current
    setLoading(true)
    setNotFound(false)
    setError(null)

    const timer = setTimeout(async () => {
      try {
        const result = await api.getSkuByBarcode(trimmed)
        if (id !== requestId.current) return
        setSku(result)
      } catch (err) {
        if (id !== requestId.current) return
        setSku(null)
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true)
        } else {
          setError(err instanceof Error ? err.message : 'Lookup failed')
        }
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    }, debounceMs)

    return () => clearTimeout(timer)
  }, [barcode, debounceMs])

  return { sku, loading, notFound, error }
}
