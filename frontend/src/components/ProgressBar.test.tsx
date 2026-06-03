import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ProgressBar } from '@/components/ProgressBar'

describe('ProgressBar', () => {
  it('exposes captured/total via progressbar ARIA', () => {
    render(<ProgressBar captured={47} total={460} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '47')
    expect(bar).toHaveAttribute('aria-valuemax', '460')
  })

  it('renders the caption when showLabel is set', () => {
    render(<ProgressBar captured={47} total={460} showLabel />)
    expect(screen.getByText('47/460')).toBeInTheDocument()
    expect(screen.getByText('10%')).toBeInTheDocument()
  })

  it('clamps width and avoids divide-by-zero at total=0', () => {
    render(<ProgressBar captured={0} total={0} showLabel />)
    expect(screen.getByText('0%')).toBeInTheDocument()
  })
})
