import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, Box, Camera, Check, ChevronDown, Warehouse } from 'lucide-react'

import { ApiError, PRODUCT_TYPES, api, type ProductType, type SkuDetail } from '@/lib/api'
import { useOfflineQueue } from '@/context/OfflineQueueContext'
import { useProgressContext } from '@/context/ProgressContext'
import { cmToMm } from '@/lib/units'
import { playBeep, vibrate } from '@/lib/feedback'
import { FloorPhotoCapture } from '@/floor/FloorPhotoCapture'

const MEASURED_BY_KEY = 'dim-capture-measuredBy'

function readMeasuredBy(): string {
  try {
    return localStorage.getItem(MEASURED_BY_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Parse a dim field to a positive number, or null if blank/invalid/≤0. */
function parsePositive(v: string): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

type DimKey = 'l' | 'w' | 'h' | 'kg'

/**
 * Floor capture screen (design Frame 2): looks up the scanned SKU, captures its
 * carton L/W/H + weight in **cm/kg** (stored mm-canonical), an optional carton
 * class and photo, and saves. Online it POSTs the dims then uploads the photo;
 * offline it queues the dims (photo needs a connection — the operator is told).
 */
export function FloorCapture() {
  const { barcode = '' } = useParams()
  const navigate = useNavigate()
  const { progress, refresh } = useProgressContext()
  const { enqueue } = useOfflineQueue()

  const [sku, setSku] = useState<SkuDetail | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [dims, setDims] = useState<Record<DimKey, string>>({ l: '', w: '', h: '', kg: '' })
  const [productType, setProductType] = useState<ProductType | null>(null)
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [measuredBy, setMeasuredBy] = useState(readMeasuredBy)
  const [needsName, setNeedsName] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const photoUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo])
  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl])

  useEffect(() => {
    let cancelled = false
    setSku(null)
    setLookupError(null)
    api
      .getSkuByBarcode(barcode)
      .then((s) => !cancelled && setSku(s))
      .catch((err) => {
        if (cancelled) return
        setLookupError(
          err instanceof ApiError && err.status === 404
            ? 'No SKU for that barcode.'
            : 'Lookup failed — check the connection.',
        )
      })
    return () => {
      cancelled = true
    }
  }, [barcode])

  const l = parsePositive(dims.l)
  const w = parsePositive(dims.w)
  const h = parsePositive(dims.h)
  const kg = parsePositive(dims.kg)
  const volumeCm3 = l !== null && w !== null && h !== null ? l * w * h : null

  async function save() {
    setError(null)
    if (l === null || w === null || h === null || kg === null) {
      setError('Enter L, W, H and weight (all greater than 0).')
      return
    }
    const who = measuredBy.trim()
    if (!who) {
      setNeedsName(true)
      setError('Enter your name once, then Save.')
      return
    }
    try {
      localStorage.setItem(MEASURED_BY_KEY, who)
    } catch {
      /* localStorage blocked — non-fatal */
    }
    if (!sku) return

    const payload = {
      skuId: sku.id,
      lengthMm: Math.round(cmToMm(l) * 1000) / 1000,
      widthMm: Math.round(cmToMm(w) * 1000) / 1000,
      heightMm: Math.round(cmToMm(h) * 1000) / 1000,
      weightKg: kg,
      measuredBy: who,
      ...(productType ? { productType } : {}),
    }

    setSaving(true)
    try {
      const dim = await api.saveDim(payload)
      if (photo) {
        // Best-effort photo attach; a failed photo must not lose the saved dims.
        try {
          await api.savePhoto(dim.id, photo)
        } catch {
          setError('Dims saved, but the photo upload failed. Re-open to retake.')
        }
      }
      playBeep()
      vibrate()
      refresh()
      navigate('/floor')
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        // Offline — queue the dims (photo needs a connection; tell the operator).
        await enqueue(payload)
        refresh()
        navigate('/floor', {
          state: { flash: photo ? 'Dims queued offline — photo not saved (no connection).' : 'Dims queued offline.' },
        })
        return
      }
      setError(err instanceof Error ? err.message : 'Save failed. Try again.')
      setSaving(false)
    }
  }

  const captured = progress?.captured ?? 0
  const total = progress?.total ?? 460
  const ringOffset = 182.2 * (1 - (total > 0 ? captured / total : 0))

  return (
    <div className="floor fixed inset-0 z-30 flex flex-col overflow-y-auto bg-[#0f2d4a] text-white">
      {/* header */}
      <div className="flex items-center gap-3.5 px-5 pb-3.5 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div>
          <GocoldWordmark />
          <div className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.16em] text-[#7dd3fc]">
            Dim Capture
          </div>
        </div>
        <div className="relative ml-auto size-[68px]">
          <svg width="68" height="68" viewBox="0 0 68 68" aria-hidden>
            <circle cx="34" cy="34" r="29" fill="none" stroke="#1e3a5f" strokeWidth="7" />
            <circle
              cx="34"
              cy="34"
              r="29"
              fill="none"
              stroke="#22b573"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray="182.2"
              strokeDashoffset={ringOffset}
              transform="rotate(-90 34 34)"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono-jb text-lg font-extrabold leading-none">{captured}</span>
            <span className="text-[10px] font-semibold text-slate-400">/{total}</span>
          </div>
        </div>
      </div>

      {/* light surface */}
      <div className="flex-1 rounded-t-[28px] bg-[#f4f7f9] px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 text-[#0f2d4a]">
        {/* customer */}
        <div className="flex items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5">
          <Warehouse className="size-[17px] text-[#0284c7]" />
          <div className="leading-tight">
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Customer</div>
            <div className="text-sm font-bold">The Forage Company</div>
          </div>
          <ChevronDown className="ml-auto size-[18px] text-slate-400" />
        </div>

        {/* SKU card */}
        {lookupError ? (
          <div className="mt-3 rounded-2xl border-l-[5px] border-amber-500 bg-white p-4 text-sm font-semibold text-amber-700">
            {lookupError}
            <button onClick={() => navigate('/floor')} className="ml-2 underline">
              Scan again
            </button>
          </div>
        ) : (
          <div className="mt-3 rounded-2xl border-l-[5px] border-[#16a34a] bg-white px-4 py-3 shadow-sm">
            <div className="text-[17px] font-extrabold leading-tight">{sku?.name ?? 'Looking up…'}</div>
            <div className="mt-1.5 flex items-center gap-3.5 font-mono-jb text-xs">
              <span className="font-bold">
                <span className="font-medium text-slate-400">EAN </span>
                {barcode}
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {sku?.hasDims ? (
                <Badge className="bg-emerald-100 text-emerald-700">Captured</Badge>
              ) : (
                <Badge className="bg-amber-100 text-amber-700">Needs dims</Badge>
              )}
              {sku?.ccDimsCaptured && <Badge className="bg-sky-100 text-sky-700">In CC</Badge>}
            </div>
          </div>
        )}

        {/* product type */}
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-1.5">
            <Box className="size-[15px] text-slate-500" />
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Product type</span>
          </div>
          <div className="flex gap-0.5 rounded-xl bg-[#e6edf2] p-0.5">
            {PRODUCT_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setProductType((cur) => (cur === t ? null : t))}
                aria-pressed={productType === t}
                className={
                  'flex-1 rounded-[9px] px-1 py-2.5 text-[13px] font-bold transition-colors ' +
                  (productType === t ? 'bg-[#0891b2] text-white shadow-sm' : 'text-slate-500')
                }
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* carton photo */}
        <button
          type="button"
          onClick={() => sku && setCameraOpen(true)}
          disabled={!sku}
          className="mt-3 flex w-full items-center gap-3.5 rounded-2xl bg-white p-3 text-left shadow-sm disabled:opacity-60"
        >
          <div className="relative shrink-0">
            {photoUrl ? (
              <img src={photoUrl} alt="Carton" className="size-[78px] rounded-xl object-cover" />
            ) : (
              <div className="grid size-[78px] place-items-center rounded-xl bg-slate-100 text-slate-400">
                <Camera className="size-6" />
              </div>
            )}
            {photo && (
              <div className="absolute -bottom-1.5 -right-1.5 grid size-6 place-items-center rounded-full border-2 border-white bg-[#16a34a]">
                <Check className="size-3 text-white" strokeWidth={3.4} />
              </div>
            )}
          </div>
          <div className="flex-1 leading-tight">
            <div className="text-[14.5px] font-extrabold">Carton photo</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {photo ? 'Attached · helps verify the cube' : 'Add a photo of the carton'}
            </div>
          </div>
          <span className="flex items-center gap-1.5 rounded-[10px] border border-sky-200 bg-sky-50 px-3 py-2 text-[13px] font-bold text-[#0284c7]">
            <Camera className="size-4" />
            {photo ? 'Retake' : 'Add'}
          </span>
        </button>

        {/* dimensions */}
        <div className="mb-2.5 mt-4 flex items-center">
          <span className="text-[13px] font-extrabold uppercase tracking-wide text-slate-500">Dimensions</span>
          <span className="ml-auto rounded-lg bg-[#0f2d4a] px-3 py-1 text-[13px] font-extrabold text-white">cm</span>
        </div>
        <div className="flex gap-2.5">
          <DimBox label="L" value={dims.l} onChange={(v) => setDims((d) => ({ ...d, l: v }))} />
          <DimBox label="W" value={dims.w} onChange={(v) => setDims((d) => ({ ...d, w: v }))} />
          <DimBox label="H" value={dims.h} onChange={(v) => setDims((d) => ({ ...d, h: v }))} />
          <DimBox label="KG" value={dims.kg} onChange={(v) => setDims((d) => ({ ...d, kg: v }))} />
        </div>

        {/* volume */}
        <div className="mt-3 flex items-center gap-2.5 rounded-2xl border border-sky-200 bg-[#eef6fb] px-4 py-3">
          <Box className="size-[19px] text-[#0284c7]" />
          <div className="leading-tight">
            <div className="text-[11px] font-extrabold uppercase tracking-wide text-[#0284c7]">Volume</div>
            <div className="text-[11.5px] text-slate-400">Auto · L × W × H</div>
          </div>
          <div className="ml-auto text-right">
            <span className="font-mono-jb text-[22px] font-bold">
              {volumeCm3 !== null ? Math.round(volumeCm3).toLocaleString() : '—'}
            </span>
            <span className="text-xs font-semibold text-slate-500"> cm³</span>
            <div className="font-mono-jb text-xs text-slate-400">
              {volumeCm3 !== null ? `${(volumeCm3 / 1_000_000).toFixed(3)} m³` : ''}
            </div>
          </div>
        </div>

        {needsName && (
          <input
            value={measuredBy}
            onChange={(e) => setMeasuredBy(e.target.value)}
            placeholder="Your name (saved for next time)"
            autoFocus
            aria-label="Your name"
            className="mt-3 min-h-12 w-full rounded-2xl border-2 border-slate-200 bg-white px-4 text-base"
          />
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-rose-600">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={save}
          disabled={saving || !sku}
          className="mt-4 flex min-h-[62px] w-full items-center justify-center gap-2.5 rounded-2xl bg-[#16a34a] text-[19px] font-extrabold text-white shadow-[0_8px_18px_-6px_rgba(22,163,74,0.55)] disabled:opacity-60"
        >
          {saving ? 'SAVING…' : 'SAVE'}
          {!saving && <ArrowRight className="size-[23px]" strokeWidth={2.4} />}
        </button>
      </div>

      {cameraOpen && sku && (
        <FloorPhotoCapture
          skuName={sku.name}
          skuCode={barcode}
          onCapture={(jpeg) => {
            setPhoto(jpeg)
            setCameraOpen(false)
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  )
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`rounded-lg px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide ${className}`}>
      {children}
    </span>
  )
}

function DimBox({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="flex-1 rounded-2xl border-2 border-slate-200 bg-white px-1.5 py-2 text-center focus-within:border-[#0284c7]">
      <div className="text-[11px] font-extrabold tracking-wide text-slate-400">{label}</div>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        placeholder="0"
        className="mt-0.5 w-full bg-transparent text-center font-mono-jb text-2xl font-bold text-[#0f2d4a] outline-none placeholder:text-slate-300"
      />
    </label>
  )
}

/** The "g●c●ld" wordmark from the design (two coloured dots for the o's). */
function GocoldWordmark() {
  return (
    <div className="flex items-center">
      <span className="text-xl font-extrabold">g</span>
      <span className="relative top-px mx-[-5px] ml-[-7px] size-3 rounded-full bg-[#22b573]" />
      <span className="ml-0.5 text-xl font-extrabold">c</span>
      <span className="relative top-px mx-[-5px] size-3 rounded-full bg-[#1a7fd4]" />
      <span className="ml-0.5 text-xl font-extrabold">ld</span>
    </div>
  )
}
