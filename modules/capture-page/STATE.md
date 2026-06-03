# State: capture-page

> This file is the handoff record between conversations. Keep it accurate. Other modules will load THIS FILE (not source) to understand what this module exports.

## Status
✅ Built — smoke passing (2026-06-03)

## Branch
`feature/capture-page`

## Last touched
2026-06-03 — initial build: full Capture flow at `/` (scan/search → lookup →
SkuCard → DimForm → save → flash/beep → clear), IndexedDB offline queue,
background sync. Smoke green (full stack).

## Public interface (what this module exports)
UI only — no exports consumed by other modules. Components are mounted by the
router (`/` → `pages/Capture.tsx`), not imported elsewhere.

**Cross-module additions this module made to the module-05 shell (additive, safe):**
```typescript
// src/lib/api.ts  (extended)
export interface DimWithSku extends Dim { sku: { name: string; barcode: string } }
api.getDims(): Promise<DimWithSku[]>          // GET /api/dims (most-recent first) — also used by module 07

// src/context/OfflineQueueContext.tsx  (new)
export function OfflineQueueProvider({ children })            // wrap app once (done in App.tsx)
export function useOfflineQueue(): OfflineQueueValue          // { pendingLocal, enqueue, list, remove, refreshQueue }
export function useOfflineQueueCount(): number                // SAFE: returns 0 with no provider

// src/lib/offlineQueue.ts  (new) — idb store 'pendingDims', UUID keys
export interface PendingDim extends SaveDimPayload { queueId: string; queuedAt: string }
export function enqueueDim/getPendingDims/countPendingDims/removePendingDim/clearQueue(...)

// src/hooks/useSync.ts  (new)
export function useSync(pollMs?): { online, syncing, pendingLocal, syncNow }

// src/components/SyncManager.tsx (new) — headless; runs useSync() once
// src/components/SyncStatus.tsx (module 05, EXTENDED) — now shows backend pendingSync + local queued
```

## Files added/changed
```
frontend/src/
  pages/Capture.tsx              (REWRITTEN from 05 placeholder) — full flow; lazy-loads BarcodeScanner
  components/
    BarcodeScanner.tsx           ZXing BrowserMultiFormatReader + torch (graceful hide) — lazy chunk
    DimForm.tsx                  L/W/H+kg, unit toggle (mm/cm/in), localStorage measuredBy, save→queue fallback
    SkuCard.tsx                  name + barcode + local/CC dim status badges
    RecentCaptures.tsx           last 10 from GET /api/dims, sync icon; reloadKey prop to refresh
    SyncManager.tsx              headless useSync() runner
    SyncStatus.tsx               (EXTENDED) backend pending + local queued
  hooks/  useBarcode.ts  useSku.ts (300ms debounce)  useSync.ts
  context/ OfflineQueueContext.tsx
  lib/  offlineQueue.ts (idb)  feedback.ts (beep+vibrate)  api.ts (+getDims/DimWithSku)
  App.tsx                        (EXTENDED) <ProgressProvider><OfflineQueueProvider><SyncManager/><Router/>
  test/setup.ts                  (EXTENDED) imports 'fake-indexeddb/auto'
  router.test.tsx                (module 05, UPDATED) '/' now asserts the real Capture page
package.json                     +@zxing/browser, +idb, +fake-indexeddb(dev)
modules/capture-page/
  docker-compose.smoke.yml       full stack: postgres + mock-cc + backend + frontend
  smoke/healthcheck.sh           polls backend /api/health + frontend /
  smoke/happy-path.sh            seed→lookup→POST dims→progress→sync + shell serves
```

## How the capture flow works
1. `Capture.tsx` holds `query` (barcode/name). Scan (lazy `BarcodeScanner`) or typing sets it.
2. `useSku(query)` debounces 300 ms → `api.getSkuByBarcode`; 404 → "SKU not found".
3. On a hit: `SkuCard` + `DimForm`. DimForm converts units on toggle (always stores mm),
   POSTs `/api/dims`; on `ApiError.status===0` (offline) it `enqueue`s to IndexedDB instead.
4. `onSaved` → beep + vibrate + 1.5 s flash, clear query, refocus search, bump RecentCaptures,
   `progress.refresh()`.
5. `SyncManager`/`useSync` (mounted in App): on mount, on `online`, every 30 s — drains the
   IndexedDB queue (`POST /api/dims`, remove each on success) then `POST /api/sync/cc` if the
   backend reports pending. `SyncStatus` shows `backend pendingSync + local queued`.

## Quirks / gotchas (read before module 07)
- **`SyncStatus` now depends on `OfflineQueueProvider`** for the queued count, but via
  `useOfflineQueueCount()` which returns 0 without a provider — so the bare shell + module-05
  tests still pass. App wires the provider; module 07 needs no change.
- **`api.getDims()` exists now** (added here) — module 07's Review page should use it.
- **ZXing is lazy-loaded** (`React.lazy` in Capture). Initial JS ~347 kB; scanner is a separate
  ~414 kB chunk fetched on first Scan tap. Don't static-import BarcodeScanner or you re-bloat the
  entry bundle.
- **Torch**: shown only when ZXing reports `controls.switchTorch` (track supports it); toggling
  failure hides the button rather than throwing.
- **Offline queue** stores `SaveDimPayload` (skuId, not SKU name) — RecentCaptures shows backend
  dims only; the local queued count surfaces via SyncStatus, not as named rows.
- **`measuredBy`** persists in `localStorage` key `dim-capture-measuredBy`; the unit toggle does NOT persist.
- **Tests**: `fake-indexeddb/auto` in `test/setup.ts` gives all tests a real IndexedDB; ZXing is
  not exercised in unit tests (camera). `crypto.randomUUID` has a fallback in offlineQueue.

## Test status
- [x] Unit tests written — offlineQueue (4), useSku (3), DimForm (4), useSync (2) + 05's suite
- [x] Unit tests passing (`npm test` → 34/34 across 9 files)
- [x] Typecheck clean (`tsc -b` exit 0), lint clean (0 errors; expected shadcn/context react-refresh warnings)
- [x] `npm run build` clean → main chunk ~347 kB, lazy BarcodeScanner chunk ~414 kB, SW + manifest present
- [x] Smoke written + passing (`./scripts/smoke-module.sh capture-page` exit 0): full stack;
      seed→lookup→save→progress→sync + shell serves; clean teardown

## In-flight work
None — module complete.

## Decisions made during this module's build
(all added to DECISIONS.md)
- 2026-06-03 | Extended module-05 `api.ts` with `getDims()` + `DimWithSku` (GET /api/dims) — needed by RecentCaptures (06) and Review (07)
- 2026-06-03 | Offline queue = IndexedDB (`idb`) store `pendingDims` keyed by UUID; `OfflineQueueProvider` tracks the count; `SyncStatus` extended to show `backend pendingSync + local queued` via a safe `useOfflineQueueCount()` (0 without provider)
- 2026-06-03 | `useSync` (run once via `<SyncManager/>` in App) drains the local queue to `POST /api/dims` then triggers `POST /api/sync/cc`; fires on mount, `online` event, and a 30 s poll
- 2026-06-03 | `BarcodeScanner` (ZXing) is `React.lazy`-loaded so the entry bundle stays ~347 kB; ZXing ships as a ~414 kB on-demand chunk
- 2026-06-03 | capture-page smoke is the full stack (pg + mock-cc + backend + frontend) exercising the page's API round-trip + shell serve; camera/torch/beep/offline-queue covered by unit tests
