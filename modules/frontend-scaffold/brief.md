# Module: frontend-scaffold

## Purpose
Set up the frontend: Vite + React 19 + TypeScript + Tailwind CSS + shadcn/ui, wired as a PWA with a service worker and web app manifest. This module creates the shell — router, layout, shared components (SyncStatus, ProgressBar), and API/utility layers — but does NOT build any of the three pages. Those are modules 06 and 07.

## In scope
- `frontend/` directory: `package.json`, `tsconfig.json`, `vite.config.ts` (with `vite-plugin-pwa`)
- Tailwind CSS + shadcn/ui setup (base theme, component stubs for Button, Input, Badge, Card)
- React Router v6: routes for `/`, `/progress`, `/review` (placeholder pages showing route name only)
- `frontend/public/manifest.json` — PWA manifest (name, icons, display: standalone, theme colour)
- Service worker via `vite-plugin-pwa` — cache-first for static assets
- Layout component: top bar with app title, `X/460` progress badge (fetched from `/api/progress`), nav links
- `SyncStatus` component — badge showing pending sync count, fetches from `/api/progress`
- `ProgressBar` component — linear bar showing captured/total
- `frontend/src/lib/api.ts` — typed fetch wrappers for all 6 backend endpoints
- `frontend/src/lib/units.ts` — `mmToCm`, `mmToInch`, `cmToMm`, `inchToMm`, `kgToLb`, `lbToKg`
- TypeScript strict, ESLint + Prettier

## Out of scope
- BarcodeScanner, DimForm, SkuCard, RecentCaptures — capture-page (module 06)
- Capture, Progress, Review page implementations — modules 06 and 07
- IndexedDB offline queue — capture-page
- Docker — module 08

## Dependencies
- `backend-core` — knows the API base URL (`VITE_API_URL` env var), health endpoint shape

## Public interface (what this module exports)

```typescript
// src/lib/api.ts
export const api: {
  getProgress(): Promise<ProgressResponse>
  getSkus(): Promise<SkuListResponse>
  getSkuByBarcode(barcode: string): Promise<SkuDetail>
  saveDim(payload: SaveDimPayload): Promise<Dim>
  updateDim(id: number, payload: UpdateDimPayload): Promise<Dim>
  syncToCC(): Promise<SyncReport>
}

// src/lib/units.ts
export function mmToCm(mm: number): number
export function mmToInch(mm: number): number
export function cmToMm(cm: number): number
export function inchToMm(inch: number): number
```

## Acceptance criteria
- [ ] `npm run dev` starts on port 5175 with no errors
- [ ] `npm run build` produces a valid dist/ with no TypeScript errors
- [ ] Navigating to `/`, `/progress`, `/review` renders the correct placeholder
- [ ] Layout bar shows the app title and a progress badge (live from `/api/progress` if backend is up, or `—/460` if not)
- [ ] PWA manifest present and valid (Lighthouse PWA audit: installable)
- [ ] Service worker registers and caches static assets (verify in DevTools)
- [ ] `units.ts` functions pass round-trip unit tests (mm → cm → mm = mm)
- [ ] TypeScript strict compiles with zero errors

## Notes
Use `vite-plugin-pwa` with `generateSW` strategy. Tailwind v4 if available; v3 is fine. shadcn/ui — install base components as needed. The `VITE_API_URL` env var points at the backend (default `http://localhost:3005`). This module should feel like a proper app shell — real nav, real progress data, just empty page slots.
