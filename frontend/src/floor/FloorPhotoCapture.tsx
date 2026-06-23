import { useEffect, useRef, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'

/** Longest edge (px) we downscale a captured frame to before encoding — keeps the
 * upload small (a carton photo only needs to verify the cube, not print). */
const MAX_EDGE = 1280
const JPEG_QUALITY = 0.82

export interface FloorPhotoCaptureProps {
  /** SKU label shown in the chip so the operator knows what they're shooting. */
  skuName: string
  skuCode: string
  /** Receives the captured carton photo as a JPEG blob. */
  onCapture: (jpeg: Blob) => void
  /** Dismiss without capturing. */
  onClose: () => void
}

/** Draw a video frame to an offscreen canvas, downscaled, and encode JPEG. */
function frameToJpeg(video: HTMLVideoElement): Promise<Blob> {
  const { videoWidth: w, videoHeight: h } = video
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas not supported'))
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode photo'))),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

/**
 * Full-screen rear-camera viewfinder for snapping a carton photo (design Frame 3).
 * Opens the environment-facing camera on mount, frames the carton with a guide,
 * and on shutter encodes the current frame to a downscaled JPEG passed to
 * `onCapture`. The stream is always stopped on unmount.
 */
export function FloorPhotoCapture({ skuName, skuCode, onCapture, onClose }: FloorPhotoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
      } catch {
        setError('Unable to open the camera. Check permissions.')
      }
    }
    void start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  async function shoot() {
    const video = videoRef.current
    if (!video || busy || video.videoWidth === 0) return
    setBusy(true)
    try {
      onCapture(await frameToJpeg(video))
    } catch {
      setError('Could not capture the photo. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="floor fixed inset-0 z-50 flex flex-col bg-[#0b1220] text-white">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        muted
        playsInline
        aria-label="Carton camera preview"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#080f1e]/70 via-[#080f1e]/5 to-[#080f1e]/85" />

      <div className="relative z-10 flex flex-1 flex-col px-5 pb-7 pt-[max(1rem,env(safe-area-inset-top))]">
        {/* top bar */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close camera"
            className="grid size-11 place-items-center rounded-full border border-white/15 bg-slate-900/55 backdrop-blur"
          >
            <X className="size-5" />
          </button>
          <span className="text-base font-bold drop-shadow">Carton photo</span>
        </div>

        {/* SKU chip */}
        <div className="mt-2.5">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-slate-900/50 px-3 py-1.5 text-[12.5px] font-semibold backdrop-blur">
            {skuName}
            <span className="font-mono-jb font-bold text-[#7dd3fc]">{skuCode}</span>
          </span>
        </div>

        {/* framing guide */}
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="relative aspect-[14/15] w-[78%] max-w-[280px]">
            <div className="absolute left-0 top-0 size-12 rounded-tl-2xl border-l-4 border-t-4 border-white/90" />
            <div className="absolute right-0 top-0 size-12 rounded-tr-2xl border-r-4 border-t-4 border-white/90" />
            <div className="absolute bottom-0 left-0 size-12 rounded-bl-2xl border-b-4 border-l-4 border-white/90" />
            <div className="absolute bottom-0 right-0 size-12 rounded-br-2xl border-b-4 border-r-4 border-white/90" />
            <div className="absolute inset-0 grid place-items-center">
              <span className="max-w-[200px] text-center text-sm font-semibold drop-shadow">
                {error ?? 'Fit the whole carton in frame'}
              </span>
            </div>
          </div>
        </div>

        {/* shutter */}
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={shoot}
            disabled={busy || error !== null}
            aria-label="Take photo"
            className="grid size-[78px] place-items-center rounded-full bg-white/25 disabled:opacity-50"
          >
            {busy ? (
              <RotateCcw className="size-7 animate-spin text-white" />
            ) : (
              <span className="size-[62px] rounded-full bg-white shadow-[inset_0_0_0_3px_rgba(0,0,0,0.15)]" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
