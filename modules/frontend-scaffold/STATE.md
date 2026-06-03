# State: frontend-scaffold

> This file is the handoff record between conversations. Keep it accurate. Other modules will load THIS FILE (not source) to understand what this module exports.

## Status
✅ Built — smoke passing (2026-06-03)

## Branch
`feature/frontend-scaffold`

## Last touched
2026-06-03 — initial build: Vite 5 + React 19 + TS strict + Tailwind v4 + shadcn/ui
PWA shell. Router, layout, shared components, api/units libs, tests, Docker smoke.
Smoke green.

## Public interface (the contract other modules see)

Modules 06 (capture-page) and 07 (progress-review) import from here:

```typescript
// src/lib/api.ts — typed wrappers; every call throws ApiError on non-2xx.
export const api: {
  getProgress(): Promise<ProgressResponse>
  getSkus(): Promise<SkuListResponse>
  getSkuByBarcode(barcode: string): Promise<SkuDetail>   // throws ApiError(404) on miss
  saveDim(payload: SaveDimPayload): Promise<Dim>
  updateDim(id: number, payload: UpdateDimPayload): Promise<Dim>
  syncToCC(): Promise<SyncReport>
}
export class ApiError extends Error { readonly status: number; readonly body: unknown }
//   status === 0 means the backend was unreachable (network error).
export const API_BASE: string                            // VITE_API_URL || http://localhost:3005
// Wire types (match backend STATE contracts exactly):
export interface ProgressResponse { total, captured, syncedToCC, pendingSync, percentage: number }
export interface SkuSummary { id, barcode, name: string; hasDims: boolean }
export interface SkuListResponse { total, captured: number; skus: SkuSummary[] }
export interface SkuDetail { id, barcode, name: string; hasDims, ccDimsCaptured: boolean; source: 'db'|'cc' }
export interface Dim { id: number; skuId: string; lengthMm, widthMm, heightMm, weightKg: number;
                       measuredBy: string; measuredAt: string; syncedToCC: boolean;
                       syncedAt: string | null; notes: string | null }
export interface SaveDimPayload { skuId, measuredBy: string; lengthMm, widthMm, heightMm, weightKg: number; notes?: string }
export interface UpdateDimPayload { measuredBy: string; lengthMm, widthMm, heightMm, weightKg: number; notes?: string }
export interface SyncReport { synced, failed, pending: number }

// src/lib/units.ts — full-precision conversions (rounding is the caller's job).
export function mmToCm/cmToMm/mmToInch/inchToMm/kgToLb/lbToKg(n: number): number
export type LengthUnit = 'mm' | 'cm' | 'in'
export function toMm(value: number, unit: LengthUnit): number
export function fromMm(mm: number, unit: LengthUnit): number

// src/context/ProgressContext.tsx — single live-progress source for the shell.
export function ProgressProvider({ children }): JSX.Element       // wrap the app once (done in App.tsx)
export function useProgressContext(): { progress, loading, error, refresh }
//   refresh(): Promise<void> — call after a capture/sync to update header badge + SyncStatus.

// src/hooks/useProgress.ts — raw poller behind the context (use the context, not this, in pages).
export function useProgress(pollMs?: number): UseProgressResult

// src/components — shared, reusable.
export function ProgressBar({ captured, total, showLabel?, className? })   // presentational
export function SyncStatus({ className? })                                  // reads progress context
export function Layout()                                                    // header + nav + <Outlet/>

// src/components/ui — shadcn (new-york): Button, Input, Badge (+ 'success' variant),
//   Card+parts, Sheet+parts. cn() helper in src/lib/utils.ts.
```

HTTP surface this module owns: **none** (frontend shell). It serves a static PWA
on container port 80 (dev server port 5175).

## Exports
- `api`, `ApiError`, `API_BASE` + all wire types — `src/lib/api.ts`
- unit converters + `toMm`/`fromMm` + `LengthUnit` — `src/lib/units.ts`
- `cn` — `src/lib/utils.ts`
- `ProgressProvider`, `useProgressContext` — `src/context/ProgressContext.tsx`
- `useProgress` — `src/hooks/useProgress.ts`
- `ProgressBar`, `SyncStatus`, `Layout` — `src/components/`
- `routes`, `router` — `src/router.tsx` (router built from `routes`; tests reuse `routes`)
- shadcn ui primitives — `src/components/ui/`

## Internal structure
```
frontend/
  package.json  tsconfig*.json  vite.config.ts  eslint.config.js  .prettierrc.json
  components.json            shadcn config (new-york, slate, @/ alias)
  index.html                 manifest link + apple-touch + SW (plugin-injected)
  Dockerfile                 node:22-alpine build → nginx:1.27-alpine serve
  nginx.conf                 SPA history fallback + no-cache for sw.js/manifest
  public/
    manifest.json            PWA manifest (standalone, theme #0284c7, 3 icons)
    favicon.svg              brand carton glyph (source for raster icons)
    icons/                   pwa-192/512.png, pwa-maskable-512.png, apple-touch-icon.png, maskable.svg
  src/
    main.tsx                 createRoot + <StrictMode><App/>
    App.tsx                  <ProgressProvider><RouterProvider/>
    router.tsx               routes[] + createBrowserRouter (/, /progress, /review, *)
    index.css                Tailwind v4 (@import) + shadcn oklch tokens + Sheet keyframes
    vite-env.d.ts            VITE_API_URL typing + PWA client types
    lib/      api.ts  units.ts  utils.ts  (+ api.test.ts, units.test.ts)
    hooks/    useProgress.ts
    context/  ProgressContext.tsx
    components/  Layout.tsx  ProgressBar.tsx  SyncStatus.tsx  (+ .test.tsx for the latter two)
                 ui/  button.tsx input.tsx badge.tsx card.tsx sheet.tsx
    pages/    Capture.tsx  Progress.tsx  Review.tsx  PlaceholderPage.tsx
    test/     setup.ts      (jest-dom + RTL cleanup)
modules/frontend-scaffold/
  docker-compose.smoke.yml   frontend-only stack, host 5176 → container 80
  smoke/healthcheck.sh       polls / for 200
  smoke/happy-path.sh        index + manifest(standalone) + sw.js + SPA fallback
```

## Quirks / gotchas (read before touching modules 06/07)
- **Use `useProgressContext()`, not `useProgress()` directly, in pages.** One poller
  lives in `<ProgressProvider>` (mounted in `App.tsx`) and feeds the header badge,
  ProgressBar, and SyncStatus. Call `refresh()` after a save/sync to update them all.
  Calling `useProgress()` again would open a second poll.
- **`api.*` throws `ApiError` on every non-2xx.** `getSkuByBarcode` throws `ApiError`
  with `status === 404` on a miss — catch it; there is no null return. `status === 0`
  means the backend was unreachable (network error), which is how the shell shows the
  `—/460` fallback and SyncStatus shows "offline".
- **Units convert at full precision** — `units.ts` does NOT round. The capture form
  (06) must round for display; storage is always mm/kg.
- **PWA manifest is a static file** (`public/manifest.json`), linked in `index.html`.
  `vite-plugin-pwa` runs with `manifest: false` and only generates + registers the SW
  (`generateSW`, cache-first, `navigateFallbackDenylist: /^\/api\//` so API is never
  cached). Edit the manifest in `public/`, not in `vite.config.ts`.
- **SW is disabled in `vite dev`** (`devOptions.enabled: false`) to avoid stale-cache
  pain; it builds + registers in `vite build`/`preview` and in the container.
- **Tailwind v4** — no `tailwind.config.js`; tokens live in `src/index.css`
  (`@theme inline` + `:root`/`.dark` oklch vars). The `--primary` accent is Go Cold
  sky-blue `#0284c7`. Sheet animations are hand-written `@keyframes` (no
  tailwindcss-animate / tw-animate-css dependency).
- **shadcn components are committed source** under `src/components/ui/` (not pulled by
  CLI at build). Add more by dropping a file there following the same cva/cn pattern.
- **Port 5175** is dev; the smoke container publishes **5176** to dodge a running dev
  server. `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` are ON in tsconfig —
  index access is `T | undefined` and optional props can't be set to `undefined`.

## Test status
- [x] Unit tests written — units (5), api wrappers (5), ProgressBar (3), SyncStatus (3), routing (5)
- [x] Unit tests passing (`npm test` → 21/21)
- [x] Typecheck clean (`tsc -b` exit 0), lint clean (`eslint .` → 0 errors; 3 expected
      shadcn `react-refresh/only-export-components` warnings)
- [x] `npm run build` clean → `dist/` with `sw.js`, `registerSW.js`, manifest, icons (17 precache entries)
- [x] `npm run dev` boots on 5175, serves shell + manifest (200)
- [x] Smoke written + passing (`./scripts/smoke-module.sh frontend-scaffold` exit 0):
      shell 200, manifest standalone, sw.js served, SPA fallback ok, clean teardown

## In-flight work
None — module complete.

## Decisions made during this module's build
(all added to DECISIONS.md)
- 2026-06-03 | Tailwind **v4** via `@tailwindcss/vite` (no `tailwind.config.js`; tokens in `index.css`); shadcn new-york components committed as in-repo source rather than pulled by the CLI; Sheet animations hand-written as `@keyframes` (no animate plugin dependency)
- 2026-06-03 | PWA manifest owned as static `public/manifest.json` (linked in `index.html`); `vite-plugin-pwa` runs `manifest: false` + `generateSW` so it only builds/registers the SW and never fights over manifest ownership; API paths excluded from the SW navigate-fallback
- 2026-06-03 | A single `ProgressProvider` context wraps one `useProgress` poller feeding the header badge, ProgressBar, and SyncStatus; exposes `refresh()` for modules 06/07 (adds `hooks/useProgress` + `context/ProgressContext` beyond the spec's listed hooks)
- 2026-06-03 | frontend-scaffold smoke is **frontend-only** (no backend/DB in the stack), building the real nginx image on host port 5176; justified because the shell degrades gracefully when the backend is absent. Reuses the established module-specific `docker-compose.smoke.yml` pattern
