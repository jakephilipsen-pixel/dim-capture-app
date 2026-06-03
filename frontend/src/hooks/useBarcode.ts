import { useCallback, useState } from 'react'

export interface UseBarcodeResult {
  /** Whether the camera scanner overlay is open. */
  scanning: boolean
  /** The most recently scanned barcode (null until the first scan). */
  lastScanned: string | null
  openScanner: () => void
  closeScanner: () => void
  /** Pass to <BarcodeScanner onScan>; records the value and closes the camera. */
  handleScan: (barcode: string) => void
}

/** Open/close state + last-scanned value for the camera scanner. */
export function useBarcode(): UseBarcodeResult {
  const [scanning, setScanning] = useState(false)
  const [lastScanned, setLastScanned] = useState<string | null>(null)

  const openScanner = useCallback(() => setScanning(true), [])
  const closeScanner = useCallback(() => setScanning(false), [])
  const handleScan = useCallback((barcode: string) => {
    setLastScanned(barcode)
    setScanning(false)
  }, [])

  return { scanning, lastScanned, openScanner, closeScanner, handleScan }
}
