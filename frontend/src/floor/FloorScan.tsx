import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { useNavigate } from 'react-router-dom'
import { Keyboard, Warehouse, X } from 'lucide-react'

import { playBeep, vibrate } from '@/lib/feedback'

/**
 * Floor entry screen (design Frame 1): the phone camera as a full-screen barcode
 * reader. On a decode it beeps/vibrates and routes to the capture screen for that
 * barcode. "Enter code manually" reveals a text field for the same route, so a
 * damaged/missing label never blocks a capture.
 */
export function FloorScan() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const doneRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState(false)
  const [code, setCode] = useState('')

  function go(barcode: string) {
    const trimmed = barcode.trim()
    if (!trimmed || doneRef.current) return
    doneRef.current = true
    controlsRef.current?.stop()
    navigate(`/floor/capture/${encodeURIComponent(trimmed)}`)
  }

  useEffect(() => {
    let cancelled = false
    const reader = new BrowserMultiFormatReader()
    async function start() {
      const video = videoRef.current
      if (!video) return
      try {
        const controls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
          if (result && !doneRef.current) {
            playBeep()
            vibrate()
            go(result.getText())
          }
        })
        if (cancelled) {
          controls.stop()
          return
        }
        controlsRef.current = controls
      } catch {
        setError('Unable to open the camera. Enter the code manually.')
        setManual(true)
      }
    }
    void start()
    return () => {
      cancelled = true
      controlsRef.current?.stop()
      controlsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="floor fixed inset-0 z-40 flex flex-col bg-[#0b1220] text-white">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        muted
        playsInline
        aria-label="Barcode camera preview"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#080f1e]/72 via-[#080f1e]/5 to-[#080f1e]/85" />

      <div className="relative z-10 flex flex-1 flex-col px-5 pb-7 pt-[max(1rem,env(safe-area-inset-top))]">
        {/* top bar */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="Exit Floor capture"
            className="grid size-11 place-items-center rounded-full border border-white/15 bg-slate-900/55 backdrop-blur"
          >
            <X className="size-5" />
          </button>
          <span className="text-base font-bold drop-shadow">Scan barcode</span>
        </div>

        {/* customer chip */}
        <div className="mt-2.5">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-slate-900/50 px-3 py-1.5 text-[12.5px] font-semibold text-blue-100 backdrop-blur">
            <Warehouse className="size-3.5 text-[#7dd3fc]" />
            The Forage Company
          </span>
        </div>

        {/* reticle */}
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="relative h-40 w-[300px] max-w-[80%]">
            <div className="absolute left-0 top-0 h-10 w-10 rounded-tl-xl border-l-[5px] border-t-[5px] border-[#38bdf8]" />
            <div className="absolute right-0 top-0 h-10 w-10 rounded-tr-xl border-r-[5px] border-t-[5px] border-[#38bdf8]" />
            <div className="absolute bottom-0 left-0 h-10 w-10 rounded-bl-xl border-b-[5px] border-l-[5px] border-[#38bdf8]" />
            <div className="absolute bottom-0 right-0 h-10 w-10 rounded-br-xl border-b-[5px] border-r-[5px] border-[#38bdf8]" />
            {!manual && (
              <div className="absolute inset-x-[8%] h-0.5 animate-[floor-scanline_2.4s_ease-in-out_infinite_alternate] bg-[#38bdf8] shadow-[0_0_14px_2px_rgba(56,189,248,0.85)]" />
            )}
          </div>
          <p className="mt-6 text-center text-[15px] font-semibold drop-shadow">
            {error ?? 'Line up the barcode — hold steady'}
          </p>
        </div>

        {/* manual entry */}
        <div className="flex justify-center">
          {manual ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                go(code)
              }}
              className="flex w-full max-w-sm items-center gap-2"
            >
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoFocus
                placeholder="Barcode / SKU code"
                aria-label="Barcode"
                className="min-h-12 flex-1 rounded-full border border-white/20 bg-slate-900/60 px-5 text-base text-white placeholder:text-white/50 backdrop-blur"
              />
              <button
                type="submit"
                className="min-h-12 rounded-full bg-[#16a34a] px-5 text-base font-bold disabled:opacity-50"
                disabled={!code.trim()}
              >
                Go
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setManual(true)}
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-slate-900/55 px-[18px] py-2.5 text-sm font-bold backdrop-blur"
            >
              <Keyboard className="size-4" />
              Enter code manually
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
