import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SyncStatus } from '@/components/SyncStatus'
import { useProgressContext } from '@/context/ProgressContext'
import type { ProgressResponse } from '@/lib/api'

vi.mock('@/context/ProgressContext', () => ({
  useProgressContext: vi.fn(),
}))

const mockCtx = vi.mocked(useProgressContext)

const progress = (pendingSync: number): ProgressResponse => ({
  total: 460,
  captured: 47,
  syncedToCC: 47 - pendingSync,
  pendingSync,
  percentage: 10.2,
})

const result = (over: Partial<ReturnType<typeof useProgressContext>>) => ({
  progress: null,
  loading: false,
  error: null,
  refresh: vi.fn(),
  ...over,
})

describe('SyncStatus', () => {
  it('shows "offline" when the backend is unreachable', () => {
    mockCtx.mockReturnValue(result({ error: new Error('down') }))
    render(<SyncStatus />)
    expect(screen.getByText('offline')).toBeInTheDocument()
  })

  it('shows "synced" when nothing is pending', () => {
    mockCtx.mockReturnValue(result({ progress: progress(0) }))
    render(<SyncStatus />)
    expect(screen.getByText('synced')).toBeInTheDocument()
  })

  it('shows the pending count when dims await sync', () => {
    mockCtx.mockReturnValue(result({ progress: progress(4) }))
    render(<SyncStatus />)
    expect(screen.getByText('4 to sync')).toBeInTheDocument()
  })
})
