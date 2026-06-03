import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { routes } from '@/router'

// Layout/SyncStatus read live progress; stub the context so routing tests
// neither fetch nor depend on a provider.
vi.mock('@/context/ProgressContext', () => ({
  useProgressContext: vi.fn(() => ({
    progress: null,
    loading: false,
    error: new Error('offline'),
    refresh: vi.fn(),
  })),
}))

// The real pages (modules 06/07) fetch on mount — stub the calls they make so
// routing tests do no network I/O.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      getDims: vi.fn().mockResolvedValue([]),
      getSkus: vi.fn().mockResolvedValue({ total: 0, captured: 0, skus: [] }),
    },
  }
})

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return render(<RouterProvider router={router} />)
}

describe('routing', () => {
  it('renders the Capture page at /', async () => {
    renderAt('/')
    expect(await screen.findByRole('button', { name: /scan barcode/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/search barcode or sku name/i)).toBeInTheDocument()
  })

  it('renders the Progress page at /progress', async () => {
    renderAt('/progress')
    expect(await screen.findByText(/no skus match/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Progress' })).toBeInTheDocument()
  })

  it('renders the Review page at /review', async () => {
    renderAt('/review')
    expect(await screen.findByText(/no captures yet/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument()
  })

  it('renders a Not found placeholder for unknown routes', () => {
    renderAt('/does-not-exist')
    expect(screen.getByText('Not found')).toBeInTheDocument()
  })

  it('shows the fallback progress badge when backend is offline', async () => {
    renderAt('/')
    // captured falls back to "—", total to 460
    expect(await screen.findByLabelText('capture progress')).toHaveTextContent('—/460')
  })
})
