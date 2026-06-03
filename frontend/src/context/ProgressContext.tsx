import { createContext, useContext, type ReactNode } from 'react'

import { useProgress, type UseProgressResult } from '@/hooks/useProgress'

const ProgressContext = createContext<UseProgressResult | null>(null)

/**
 * Single source of live progress for the whole shell. One poll feeds the
 * header badge, the ProgressBar, and SyncStatus — so they never each open
 * their own request. Later modules call `refresh()` after a capture/sync.
 */
export function ProgressProvider({ children }: { children: ReactNode }) {
  const value = useProgress()
  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>
}

export function useProgressContext(): UseProgressResult {
  const ctx = useContext(ProgressContext)
  if (!ctx) {
    throw new Error('useProgressContext must be used within a <ProgressProvider>')
  }
  return ctx
}
