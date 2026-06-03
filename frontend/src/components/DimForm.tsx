import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ApiError, api, type SkuDetail } from '@/lib/api'
import { useOfflineQueue } from '@/context/OfflineQueueContext'
import { fromMm, toMm, type LengthUnit } from '@/lib/units'
import { cn } from '@/lib/utils'

const MEASURED_BY_KEY = 'dim-capture-measuredBy'
const LENGTH_UNITS: LengthUnit[] = ['mm', 'cm', 'in']

export type SaveOutcome = 'saved' | 'queued'

export interface DimFormProps {
  sku: SkuDetail
  /** Called after a successful save (online) or offline-queue write. */
  onSaved: (outcome: SaveOutcome) => void
}

function round(n: number, dp = 3): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/** Parse a field to a positive number, or null if invalid/≤0. */
function parsePositive(value: string): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function readMeasuredBy(): string {
  try {
    return localStorage.getItem(MEASURED_BY_KEY) ?? ''
  } catch {
    return ''
  }
}

/**
 * L/W/H + weight capture form. The unit toggle converts the displayed L/W/H
 * values in place; values are always stored as mm (weight as kg). On save it
 * POSTs to /api/dims, falling back to the IndexedDB offline queue when the
 * backend is unreachable. `measuredBy` persists across sessions in localStorage.
 */
export function DimForm({ sku, onSaved }: DimFormProps) {
  const { enqueue } = useOfflineQueue()
  const [unit, setUnit] = useState<LengthUnit>('mm')
  const [length, setLength] = useState('')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [measuredBy, setMeasuredBy] = useState<string>(readMeasuredBy)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function switchUnit(next: LengthUnit) {
    if (next === unit) return
    // Convert each non-empty length field from the old unit to the new one.
    const convert = (value: string): string => {
      const n = parsePositive(value)
      if (n === null) return value
      return String(round(fromMm(toMm(n, unit), next)))
    }
    setLength(convert(length))
    setWidth(convert(width))
    setHeight(convert(height))
    setUnit(next)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const l = parsePositive(length)
    const w = parsePositive(width)
    const h = parsePositive(height)
    const kg = parsePositive(weight)
    const who = measuredBy.trim()

    if (l === null || w === null || h === null || kg === null) {
      setError('All dimensions and weight must be greater than 0.')
      return
    }
    if (!who) {
      setError('Enter your name before saving.')
      return
    }

    try {
      localStorage.setItem(MEASURED_BY_KEY, who)
    } catch {
      // localStorage blocked — non-fatal.
    }

    const payload = {
      skuId: sku.id,
      lengthMm: round(toMm(l, unit)),
      widthMm: round(toMm(w, unit)),
      heightMm: round(toMm(h, unit)),
      weightKg: kg,
      measuredBy: who,
    }

    setSaving(true)
    try {
      await api.saveDim(payload)
      resetFields()
      onSaved('saved')
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        // Offline — queue locally and report queued.
        await enqueue(payload)
        resetFields()
        onSaved('queued')
      } else {
        setError(err instanceof Error ? err.message : 'Save failed. Try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  function resetFields() {
    setLength('')
    setWidth('')
    setHeight('')
    setWeight('')
    // unit + measuredBy intentionally persist for the next scan.
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {/* unit toggle */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Units</span>
        <div className="ml-auto inline-flex overflow-hidden rounded-md border">
          {LENGTH_UNITS.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => switchUnit(u)}
              aria-pressed={unit === u}
              className={cn(
                'min-h-11 px-4 text-sm font-medium transition-colors',
                unit === u
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-secondary',
              )}
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      <DimField id="length" label={`Length (${unit})`} value={length} onChange={setLength} />
      <DimField id="width" label={`Width (${unit})`} value={width} onChange={setWidth} />
      <DimField id="height" label={`Height (${unit})`} value={height} onChange={setHeight} />
      <DimField id="weight" label="Weight (kg)" value={weight} onChange={setWeight} />

      <div className="space-y-1.5">
        <label htmlFor="measuredBy" className="text-sm font-medium">
          Your name
        </label>
        <Input
          id="measuredBy"
          value={measuredBy}
          onChange={(e) => setMeasuredBy(e.target.value)}
          placeholder="e.g. Jake"
          autoComplete="name"
          className="min-h-11"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" className="min-h-12 w-full text-base" disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </form>
  )
}

interface DimFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}

function DimField({ id, label, value, onChange }: DimFieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min="0.001"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 text-base"
        aria-label={label}
      />
    </div>
  )
}
