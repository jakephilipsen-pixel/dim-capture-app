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

// The real Capture page (module 06) mounts at "/" and its RecentCaptures
// calls GET /api/dims — stub it so routing tests make no network call.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, getDims: vi.fn().mockResolvedValue([]) } }
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

  it('renders the Progress placeholder at /progress', () => {
    renderAt('/progress')
    expect(screen.getByRole('heading', { name: 'Progress' })).toBeInTheDocument()
    expect(screen.getByText('/progress')).toBeInTheDocument()
  })

  it('renders the Review placeholder at /review', () => {
    renderAt('/review')
    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument()
    expect(screen.getByText('/review')).toBeInTheDocument()
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
