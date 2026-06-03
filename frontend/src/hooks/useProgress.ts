import { useCallback, useEffect, useRef, useState } from 'react'

import { api, type ProgressResponse } from '@/lib/api'

export interface UseProgressResult {
  progress: ProgressResponse | null
  /** True until the first fetch settles. */
  loading: boolean
  /** Set when the backend is unreachable or returns non-2xx. */
  error: Error | null
  /** Re-fetch now (e.g. after a capture in module 06). */
  refresh: () => Promise<void>
}

/**
 * Fetches capture progress from `GET /api/progress` on mount, then polls every
 * `pollMs`. Degrades cleanly: on failure `progress` stays null and `error` is
 * set, which lets the shell render a `—/460` fallback instead of crashing.
 */
export function useProgress(pollMs = 30_000): UseProgressResult {
  const [progress, setProgress] = useState<ProgressResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const next = await api.getProgress()
      if (!mounted.current) return
      setProgress(next)
      setError(null)
    } catch (err) {
      if (!mounted.current) return
      setError(err instanceof Error ? err : new Error('Failed to load progress'))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh()
    const id = setInterval(() => void refresh(), pollMs)
    return () => {
      mounted.current = false
      clearInterval(id)
    }
  }, [refresh, pollMs])

  return { progress, loading, error, refresh }
}
