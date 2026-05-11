# dim-capture-app — Claude Code Module Prompt

## MISSION

Build a complete, production-ready **Carton Dimension Capture PWA** called `dim-capture-app` for Go Cold Warehouse Management at 15 Rocco Drive, Scoresby, Victoria.

This app runs on a mobile device on the warehouse floor. A picker scans or types a SKU barcode, enters carton dimensions (L × W × H) and weight, and the data is saved locally and synced to CartonCloud via their API. The goal is to capture carton dimensions for all 460 active Forage SKUs currently missing dims in CC — zero of 460 have dimensions captured.

This is a standalone module within the `gocold-wms-flow` project suite. It does not depend on other modules but its output feeds `slot-recommender` downstream.

---

## STACK

- **Frontend:** React 19 + TypeScript + Tailwind CSS + shadcn/ui (PWA, mobile-first)
- **Backend:** Node.js + Express + TypeScript
- **Database:** PostgreSQL + Prisma (local cache of captured dims)
- **Deployment:** Docker Compose on NUC at `dims.gocold.local` via Caddy reverse proxy
- **Port allocation:** Frontend 5175 | Backend 3005 | Postgres 5434
- **CC API:** CartonCloud REST API using existing CC API client from `gocold-wms-flow`

---

## PROJECT STRUCTURE

```
dim-capture-app/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── BarcodeScanner.tsx       # camera barcode scan via ZXing
│   │   │   ├── DimForm.tsx              # L/W/H/weight input form
│   │   │   ├── ProgressBar.tsx          # X/460 captured indicator
│   │   │   ├── SkuCard.tsx              # SKU name + current CC dim status
│   │   │   ├── RecentCaptures.tsx       # last 10 entries list
│   │   │   └── SyncStatus.tsx           # pending sync count badge
│   │   ├── pages/
│   │   │   ├── Capture.tsx              # main capture flow
│   │   │   ├── Progress.tsx             # full SKU list with captured/missing
│   │   │   └── Review.tsx               # edit/correct past entries
│   │   ├── hooks/
│   │   │   ├── useBarcode.ts
│   │   │   ├── useSku.ts
│   │   │   └── useSync.ts
│   │   ├── lib/
│   │   │   ├── api.ts                   # backend API calls
│   │   │   └── units.ts                 # mm/cm/inch conversion helpers
│   │   └── main.tsx
│   ├── public/
│   │   └── manifest.json               # PWA manifest
│   ├── vite.config.ts
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── skus.ts                  # GET /skus, GET /skus/:barcode
│   │   │   ├── dims.ts                  # POST /dims, GET /dims, PUT /dims/:id
│   │   │   └── sync.ts                  # POST /sync/cc (push to CartonCloud)
│   │   ├── services/
│   │   │   ├── ccClient.ts              # CartonCloud API client (ported from gocold-wms-flow)
│   │   │   ├── dimService.ts            # capture + validation logic
│   │   │   └── syncService.ts           # batch sync to CC with retry
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   └── index.ts
│   └── package.json
├── docker-compose.yml
├── docker-compose.local.yml
├── .env.example
└── CLAUDE.md
```

---

## DATA MODELS

### Prisma Schema

```prisma
model Sku {
  id            String    @id                    // CartonCloud product UUID
  barcode       String    @unique
  name          String
  ccDimsCaptured Boolean  @default(false)        // dims already in CC before we started
  createdAt     DateTime  @default(now())
  dims          Dim?
}

model Dim {
  id            Int       @id @default(autoincrement())
  skuId         String    @unique
  sku           Sku       @relation(fields: [skuId], references: [id])
  lengthMm      Float
  widthMm       Float
  heightMm      Float
  weightKg      Float
  measuredBy    String                            // picker name/initials
  measuredAt    DateTime  @default(now())
  syncedToCC    Boolean   @default(false)
  syncedAt      DateTime?
  notes         String?
}
```

---

## API ROUTES

### `GET /api/skus`
Returns all SKUs from local DB with dim capture status.
```json
{ "total": 460, "captured": 0, "skus": [ { "id": "...", "barcode": "...", "name": "...", "hasDims": false } ] }
```

### `GET /api/skus/:barcode`
Looks up SKU by barcode. Checks local DB first, falls back to CC API lookup.
Returns 404 if not found in either.

### `POST /api/dims`
Save a dimension capture.
```json
{ "skuId": "...", "lengthMm": 300, "widthMm": 200, "heightMm": 150, "weightKg": 2.4, "measuredBy": "Jake" }
```
Validates: all dims > 0, weight > 0, skuId exists. Returns saved dim.

### `PUT /api/dims/:id`
Correct a previously entered dim. Updates syncedToCC to false (needs re-sync).

### `POST /api/sync/cc`
Triggers sync of all unsynced dims to CartonCloud. Runs in batches of 10. Returns sync report.
```json
{ "synced": 12, "failed": 0, "pending": 34 }
```

### `GET /api/progress`
Returns capture progress summary.
```json
{ "total": 460, "captured": 47, "syncedToCC": 43, "pendingSync": 4, "percentage": 10.2 }
```

---

## CARTONCLOUD API INTEGRATION

Use the existing CC API client pattern from `gocold-wms-flow`. Key details:

- **Base URL:** `https://app.cartoncloud.com.au/api/v1`
- **Auth:** Bearer token via `CC_API_KEY` env var
- **Tenant ID:** from `CC_TENANT_ID` env var
- **Rate limit:** 60 req/min — implement token bucket in ccClient.ts

**Product lookup by barcode:**
```
GET /products?barcode={barcode}&warehouseAccountId={WAREHOUSE_ID}
```

**Update product dimensions:**
```
PATCH /products/{productId}
Body: { "length": 300, "width": 200, "height": 150, "weight": 2.4 }
```
Units: CC expects **mm** for dimensions, **kg** for weight.

The `syncService.ts` should:
1. Query local DB for all `syncedToCC = false` dims
2. Batch into groups of 10
3. PATCH each product in CC
4. On success: update `syncedToCC = true`, `syncedAt = now()`
5. On failure: log error, leave syncedToCC false, retry on next sync call
6. Return sync report

---

## FRONTEND — CAPTURE FLOW (MOBILE UX)

### Main Capture Page (`/`)

```
┌─────────────────────────────────┐
│  📦 Dim Capture      47/460 ✅  │  ← progress badge top right
├─────────────────────────────────┤
│  [📷 Scan Barcode]              │  ← opens camera scanner
│  ─── or ───                     │
│  [___________________] Search   │  ← manual barcode/SKU name input
├─────────────────────────────────┤
│  CADBURY DAIRY MILK 200G        │  ← SKU name once found
│  Barcode: 9300675024635         │
│  Status: ❌ No dims in CC       │
├─────────────────────────────────┤
│  Length (mm)  [_______]         │
│  Width  (mm)  [_______]         │
│  Height (mm)  [_______]         │
│  Weight (kg)  [_______]         │
│  Your name    [_______]         │
├─────────────────────────────────┤
│         [  SAVE  ]              │
└─────────────────────────────────┘
```

- After SAVE: green flash + sound + "Saved! Scan next item" — immediately clear form and focus barcode input for next scan
- Numeric keypads only for dim fields (inputMode="decimal")
- Unit toggle: mm / cm / inches — converts on save, always stores as mm
- Barcode scanner: ZXing library (`@zxing/browser`) — camera scan with torch toggle
- Offline capable: if backend unreachable, queue locally in IndexedDB and sync when back

### Progress Page (`/progress`)
Full SKU list. Filter: All / Captured / Missing. Search by name. Tap a SKU to edit its dims.

### Review Page (`/review`)
Last 10 captures with edit button. Shows pending sync count.

---

## ENVIRONMENT VARIABLES

```env
# CartonCloud
CC_API_KEY=your_cc_api_key
CC_TENANT_ID=4906532d-xxxx-xxxx-xxxx-xxxxxxxxxxxx
CC_WAREHOUSE_ID=your_warehouse_id

# Database
DATABASE_URL=postgresql://gocold:gocold@postgres:5432/dimcapture

# App
NODE_ENV=production
PORT=3005
FRONTEND_URL=http://localhost:5175
```

---

## DOCKER COMPOSE

```yaml
version: '3.9'
services:
  frontend:
    build: ./frontend
    ports: ["5175:80"]
    environment:
      - VITE_API_URL=http://backend:3005
    depends_on: [backend]

  backend:
    build: ./backend
    ports: ["3005:3005"]
    env_file: .env
    depends_on: [postgres]

  postgres:
    image: postgres:16-alpine
    ports: ["5434:5432"]
    environment:
      POSTGRES_DB: dimcapture
      POSTGRES_USER: gocold
      POSTGRES_PASSWORD: gocold
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

---

## SEED DATA

On first run, seed the SKU table from CartonCloud by calling:
```
GET /products?warehouseAccountId={WAREHOUSE_ID}&page=1&pageSize=100
```
Paginate through all pages. Store id, barcode, name for each product. Mark `ccDimsCaptured = true` for any product that already has dimensions in CC.

Expose a seed endpoint: `POST /api/admin/seed` — runs the CC product pull and populates the SKU table. Idempotent.

---

## BUILD ORDER

1. **Backend foundation** — Express + Prisma schema + migrations + DB connection
2. **CC client** — port from gocold-wms-flow, add product lookup + PATCH dims
3. **SKU seed** — `/api/admin/seed` endpoint, pull all Forage products from CC
4. **Dim capture API** — POST/GET/PUT /api/dims + validation
5. **Sync service** — batch PATCH to CC with retry
6. **Frontend scaffold** — Vite + React 19 + Tailwind + shadcn/ui + PWA manifest
7. **Barcode scanner component** — ZXing camera integration
8. **Capture page** — full mobile UX flow
9. **Progress + Review pages**
10. **Docker Compose** — local + production configs
11. **Caddy config** — `dims.gocold.local` on NUC

---

## QUALITY GATES

- TypeScript strict mode, no `any`
- All API routes have input validation (zod)
- Sync service handles CC API errors gracefully — never crashes on a single SKU failure
- Mobile UX: tap targets ≥ 44px, numeric inputs trigger numeric keyboard
- Offline queue: dims entered while offline sync automatically when connection restored
- Seed endpoint is idempotent — safe to re-run without duplicating SKUs

---

## ACCEPTANCE CRITERIA

- [ ] Scanner opens camera and reads a barcode in < 2 seconds on warehouse floor lighting
- [ ] SKU lookup returns name within 500ms of barcode scan
- [ ] Dim entry form saves in < 300ms
- [ ] Sync pushes to CC and updates `syncedToCC` correctly
- [ ] Progress counter `X/460` is accurate and updates in real time
- [ ] Works offline — dims queued and synced when reconnected
- [ ] Runs via Docker Compose on NUC, accessible at `dims.gocold.local`
