import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { Flashlight, FlashlightOff, X } from 'lucide-react'

import { Button } from '@/components/ui/button'

export interface BarcodeScannerProps {
  /** Called with the decoded barcode text on a successful scan. */
  onScan: (barcode: string) => void
  /** Called when the user dismisses the scanner. */
  onClose: () => void
  /** Called if the camera cannot be opened (permission denied / no device). */
  onError?: (message: string) => void
}

/**
 * Live camera barcode scanner (ZXing `BrowserMultiFormatReader`). Requests
 * camera permission on mount, decodes continuously, and calls `onScan` once.
 * The torch button only appears when the active track reports torch support
 * (ZXing exposes `switchTorch` on the controls in that case).
 */
export function BarcodeScanner({ onScan, onClose, onError }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const scannedRef = useRef(false)
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const reader = new BrowserMultiFormatReader()

    async function start() {
      const video = videoRef.current
      if (!video) return
      try {
        const controls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
          if (result && !scannedRef.current) {
            scannedRef.current = true
            onScan(result.getText())
            controlsRef.current?.stop()
          }
        })
        if (cancelled) {
          controls.stop()
          return
        }
        controlsRef.current = controls
        setTorchSupported(typeof controls.switchTorch === 'function')
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unable to open the camera. Check permissions.'
        setCameraError(message)
        onError?.(message)
      }
    }

    void start()
    return () => {
      cancelled = true
      controlsRef.current?.stop()
      controlsRef.current = null
    }
    // onScan/onError are stable callers; we intentionally start the camera once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function toggleTorch() {
    const next = !torchOn
    try {
      await controlsRef.current?.switchTorch?.(next)
      setTorchOn(next)
    } catch {
      // Torch unsupported on this device after all — hide the control.
      setTorchSupported(false)
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl border bg-black">
      <video
        ref={videoRef}
        className="aspect-[4/3] w-full object-cover"
        muted
        playsInline
        aria-label="Barcode camera preview"
      />

      {/* scan reticle */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-1/3 w-3/4 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
      </div>

      {cameraError && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white">
          {cameraError}
        </div>
      )}

      <div className="absolute right-2 top-2 flex gap-2">
        {torchSupported && (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="min-h-11 min-w-11"
            onClick={toggleTorch}
            aria-label={torchOn ? 'Turn torch off' : 'Turn torch on'}
            aria-pressed={torchOn}
          >
            {torchOn ? <FlashlightOff className="size-5" /> : <Flashlight className="size-5" />}
          </Button>
        )}
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="min-h-11 min-w-11"
          onClick={onClose}
          aria-label="Close scanner"
        >
          <X className="size-5" />
        </Button>
      </div>
    </div>
  )
}
