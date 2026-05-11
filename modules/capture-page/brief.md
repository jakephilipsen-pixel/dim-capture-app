# Module: capture-page

## Purpose
Build the main warehouse capture flow at `/`. A picker scans or types a barcode, sees the SKU name and CC dim status, enters L/W/H/weight with a unit toggle, hits Save, and immediately gets a success flash + sound before the form clears for the next scan. Dims entered while offline are queued in IndexedDB and synced automatically when the connection returns.

## In scope
- `BarcodeScanner.tsx` — ZXing (`@zxing/browser`) camera scan with torch toggle button; emits scanned barcode string via callback
- `useBarcode.ts` — hook wrapping BarcodeScanner: open/close camera, last-scanned value
- `DimForm.tsx` — four numeric inputs (L/W/H in selected unit, weight in kg), unit toggle (mm/cm/in) that converts displayed values on switch; always stores as mm; `measuredBy` text input persists across saves (localStorage)
- `SkuCard.tsx` — shows SKU name, barcode, CC dim status (has dims / no dims)
- `RecentCaptures.tsx` — last 10 captures list with SKU name, dims summary, sync status icon
- `Capture.tsx` page (`/`) — full flow: scan → SKU lookup → SkuCard → DimForm → Save → success flash + haptic/sound → clear form → re-focus barcode input
- `useSync.ts` — polls `GET /api/progress` every 30s, triggers `POST /api/sync/cc` when there are pending dims and the device is online
- `useSku.ts` — debounced SKU lookup by barcode (calls `api.getSkuByBarcode`)
- IndexedDB offline queue: dims saved while offline are stored locally and synced via `useSync` when online

## Out of scope
- Progress page and Review page — progress-review (module 07)
- Backend API — modules 01–04
- Docker — module 08

## Dependencies
- `frontend-scaffold` — uses router, layout, `api.*`, `units.*`, `SyncStatus`, `ProgressBar`, shadcn/ui components
- `sku-seed` — runtime: SKU records must exist in backend DB (no code import)
- `dim-api` — runtime: POST /api/dims and POST /api/sync/cc must exist (no code import)

## Public interface (what this module exports)

```typescript
// No direct exports to other modules — this module is UI only
// Components are consumed by router, not imported by other modules
```

## Acceptance criteria
- [ ] Camera opens on Scan tap; barcode decoded within 2 seconds in normal indoor lighting
- [ ] Torch toggle button works on supported devices
- [ ] Typed barcode search also works (debounced, 300ms)
- [ ] SkuCard shows correct name and CC dim status after successful lookup
- [ ] Unknown barcode shows "SKU not found" inline error, form stays closed
- [ ] DimForm unit toggle converts displayed values (mm → cm: 300 → 30.0)
- [ ] Save posts to `/api/dims`; success shows green flash for 1.5s + plays a short beep
- [ ] After save, form resets and barcode input is auto-focused
- [ ] `measuredBy` name persists across sessions via localStorage
- [ ] While offline, dim is queued in IndexedDB; queued count shown in SyncStatus
- [ ] When connectivity returns, `useSync` triggers sync automatically
- [ ] All tap targets ≥ 44px; numeric inputs trigger numeric/decimal keyboard on mobile

## Notes
`@zxing/browser` is the barcode library — prefer `BrowserMultiFormatReader`. The torch API (`ImageCapture.setPhotoCapabilities`) may not work on all Android devices — gracefully hide the torch button when not supported rather than throwing. Sound: a short 440Hz oscillator beep via Web Audio API (no audio file dependency). The offline queue is IndexedDB via `idb` package — one store, `pendingDims`, keyed by a local UUID; each entry mirrors the `POST /api/dims` payload. On sync, pop entries from the queue and POST; on HTTP success remove from IndexedDB.
