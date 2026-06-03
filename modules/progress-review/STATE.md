# State: progress-review

> This file is the handoff record between conversations. Keep it accurate. Other modules will load THIS FILE (not source) to understand what this module exports.

## Status
✅ Built — smoke passing (2026-06-03)

## Branch
`feature/progress-review`

## Last touched
2026-06-03 — initial build: Progress (`/progress`) list + filter + search +
edit sheet; Review (`/review`) last-10 + inline edit + Sync Now. Extended 06's
DimForm with edit/PUT mode and 05's Sheet with a bottom side. Smoke green.

## Public interface (what this module exports)
UI only — no exports consumed by other modules. Pages are mounted by the router
(`/progress` → `pages/Progress.tsx`, `/review` → `pages/Review.tsx`).

**Cross-module changes this module made (additive, backward compatible):**
```typescript
// src/components/DimForm.tsx (module 06, EXTENDED)
export interface InitialDims { lengthMm; widthMm; heightMm; weightKg: number }
// new optional props:
//   initialDims?: InitialDims   — pre-fill (mm/kg) for edit
//   dimId?: number              — when set, Save does PUT /api/dims/:id (no offline queue);
//                                 when absent, behaviour is unchanged (POST + offline fallback)

// src/components/ui/sheet.tsx (module 05, EXTENDED)
// SheetContent gains side?: 'right' | 'bottom' (default 'right' — Layout nav unaffected).
// Bottom slide keyframes added to index.css.
```

## Files added/changed
```
frontend/src/
  pages/Progress.tsx   (REWRITTEN from placeholder) list + All/Captured/Missing tabs + search + edit Sheet
  pages/Review.tsx     (REWRITTEN from placeholder) last-10 + sync icons + inline edit + Sync Now
  pages/Progress.test.tsx  Review.test.tsx
  components/DimForm.tsx       (EXTENDED) initialDims + dimId → PUT mode
  components/ui/sheet.tsx      (EXTENDED) side variant (right|bottom)
  index.css                    (EXTENDED) slide-in/out-bottom keyframes
  router.test.tsx              (module 05, UPDATED) /progress + /review now assert real pages
modules/progress-review/
  docker-compose.smoke.yml     full stack: postgres + mock-cc + backend + frontend
  smoke/healthcheck.sh         polls backend /api/health + frontend /
  smoke/happy-path.sh          seed→skus→dims→capture→PUT→sync + SPA routes serve
```

## How the pages work
- **Progress** fetches `api.getSkus()` (the full list + total/captured) AND `api.getDims()` once,
  joining dims by `skuId` into a Map. Segmented All/Captured/Missing filter (on `hasDims`) +
  client-side name/barcode search (no network). Tapping a row opens a **bottom Sheet** with
  `DimForm`: captured row → pre-filled + `dimId` (PUT); missing row → blank (POST). On save it
  reloads both lists and calls `progress.refresh()`.
- **Review** fetches `api.getDims()`, sorts by `measuredAt` desc, shows the last 10 with a sync
  icon. Edit opens the same bottom-Sheet DimForm in PUT mode. A header **Sync Now** button calls
  `api.syncToCC()` then reloads; the pending count comes from `useProgressContext().progress.pendingSync`.

## Quirks / gotchas
- **Progress needs both `getSkus` AND `getDims`** — `/api/skus` rows (`SkuSummary`) carry no dim
  values or dim id, so the edit sheet's pre-fill + PUT id come from the joined `getDims()` result.
- **DimForm edit mode does NOT fall back to the offline queue** — a PUT that fails offline shows an
  error (edits are supervisor/bench actions, assumed online). Only new captures queue.
- **`<DimForm key={...}>`** is keyed by SKU/dim id in the sheets so switching rows remounts the form
  with fresh pre-fill state.
- **460-row performance**: handled with CSS `content-visibility:auto` + `contain-intrinsic-size` on
  each row (no `react-window` dependency). Revisit only if a real device is sluggish.
- **Filter/search state is component-local** (not URL params), per the brief.
- **Sheet side**: this module uses `side="bottom"`; the Layout mobile nav still uses the default
  `side="right"`. Don't change the default.

## Test status
- [x] Unit tests written — Progress (4: filter, search, PUT-edit, POST-capture), Review (3: list, Sync Now, PUT-edit)
- [x] Unit tests passing (`npm test` → 41/41 across 11 files)
- [x] Typecheck clean (`tsc -b` exit 0), lint clean (0 errors; expected shadcn/context react-refresh warnings)
- [x] `npm run build` clean → main ~354 kB, lazy BarcodeScanner ~414 kB, SW + manifest present
- [x] Smoke written + passing (`./scripts/smoke-module.sh progress-review` exit 0): full stack;
      seed→skus→dims→capture→PUT→sync + /progress & /review serve; clean teardown

## In-flight work
None — module complete.

## Decisions made during this module's build
(all added to DECISIONS.md)
- 2026-06-03 | Extended 06's `DimForm` with optional `initialDims` + `dimId` → PUT/edit mode (the brief's mandated DimForm reuse); backward compatible, edit mode skips the offline queue
- 2026-06-03 | Progress joins `GET /api/skus` with `GET /api/dims` by `skuId` (skus rows lack dim values/id) to pre-fill the edit sheet and supply the PUT id
- 2026-06-03 | Extended 05's `SheetContent` with a `side` variant (`right` default | `bottom`); pages use a bottom sheet for the tall edit form; Layout nav keeps the right default
- 2026-06-03 | 460-row list uses CSS `content-visibility:auto` (no `react-window` dependency); filter/search kept in component state
- 2026-06-03 | progress-review smoke is the full stack (pg + mock-cc + backend + frontend) on ports 3011/5178, exercising the pages' API calls + SPA route serving; interactive UI covered by unit tests
