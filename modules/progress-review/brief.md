# Module: progress-review

## Purpose
Build the two secondary pages: Progress (`/progress`) gives a full-list view of all 460 SKUs with capture status, filters, and search; Review (`/review`) shows the last 10 dim captures with edit capability and pending sync count. Together these give warehouse supervisors and pickers visibility into how far through the 460-SKU campaign they are.

## In scope
- `Progress.tsx` page at `/progress`:
  - Full SKU list from `GET /api/skus` (all 460)
  - Filter tabs: All / Captured / Missing
  - Search input (filter by SKU name, client-side)
  - Each row: SKU name, barcode, captured status indicator; tap row to open edit dim sheet
  - Edit sheet: pre-fills existing dims if present, or blank DimForm for new capture; Save calls `POST /api/dims` or `PUT /api/dims/:id`
- `Review.tsx` page at `/review`:
  - Last 10 dim captures from `GET /api/dims` (sorted by measuredAt desc)
  - Each entry: SKU name, L×W×H, weight, measuredBy, timestamp, sync status icon (synced/pending)
  - Edit button opens inline edit form (PUT /api/dims/:id)
  - Pending sync count at top with manual Sync Now button (`POST /api/sync/cc`)

## Out of scope
- Capture page — capture-page (module 06)
- Backend — modules 01–04
- Docker — module 08

## Dependencies
- `frontend-scaffold` — uses router, layout, `api.*`, `units.*`, shadcn/ui components
- `capture-page` — reuses `DimForm.tsx` component (import from capture-page's component path)

## Public interface (what this module exports)

```typescript
// No exports to other modules — pure UI pages
```

## Acceptance criteria
- [ ] `/progress` loads all SKUs and shows correct captured/missing counts matching `/api/progress`
- [ ] Filter tabs narrow the list correctly (All shows all 460, Captured shows captured, Missing shows uncaptured)
- [ ] Search filters SKU names in real-time (no network call)
- [ ] Tapping a SKU row opens an edit/capture sheet
- [ ] Sheet for a SKU with existing dims pre-fills values; Save calls `PUT /api/dims/:id`
- [ ] Sheet for a SKU without dims shows blank form; Save calls `POST /api/dims`
- [ ] `/review` shows last 10 captures with sync status
- [ ] Edit on a Review entry updates via `PUT /api/dims/:id`
- [ ] Sync Now button triggers `POST /api/sync/cc` and updates counts
- [ ] Both pages work with keyboard-less mobile (no hover interactions required)

## Notes
DimForm is imported from `capture-page` — this is the one intentional cross-module component reuse. Progress list may be 460 rows — use windowing (`react-window` or CSS `content-visibility`) if scroll performance is sluggish on a mid-range Android phone. Keep the filter/search state in component state (not URL params) for simplicity.
