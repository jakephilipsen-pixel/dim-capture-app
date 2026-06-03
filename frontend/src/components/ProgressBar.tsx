import { cn } from '@/lib/utils'

export interface ProgressBarProps {
  /** SKUs captured so far. */
  captured: number
  /** Total SKUs in scope. */
  total: number
  /** Show the `captured/total (pct%)` caption above the bar. */
  showLabel?: boolean
  className?: string
}

/**
 * Linear captured/total indicator. Pure presentational — the caller supplies
 * the numbers (Layout/Progress page pull them from the progress context).
 */
export function ProgressBar({ captured, total, showLabel = false, className }: ProgressBarProps) {
  const pct = total > 0 ? Math.min(100, Math.round((captured / total) * 100)) : 0

  return (
    <div className={cn('w-full', className)}>
      {showLabel && (
        <div className="mb-1 flex items-baseline justify-between text-sm">
          <span className="font-medium text-foreground">
            {captured}/{total}
          </span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
      )}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuenow={captured}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${captured} of ${total} SKUs captured`}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
