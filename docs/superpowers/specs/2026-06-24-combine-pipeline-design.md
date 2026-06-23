# Design — combine the proven dims-write pipeline into the app

_Date: 2026-06-24 · Status: approved design, pre-implementation · Repo: `dim-capture-app`_

## 1. Goal

Make the **app itself** write captured carton dimensions to CartonCloud (CC) correctly,
using the validated recipe proven in the parent `gocold-wms-flow` repo, then deploy it to
the Go Cold NUC so Jake can fill in missing dims on the floor while testing. Per-dim
**read-back verify** is the live safety net (Jake's chosen go-live posture — no separate
sandbox smoke).

The app's PWA, IndexedDB offline queue, capture/floor flows, sync orchestration
(batch-of-10, advisory lock, `X-Sync-Key` auth), storage, and hardening all **stay**. The
change is surgical to one layer: the CC integration (`ccClient`) plus the seed/lookup that
feeds it.

## 2. Why this is needed (current state is broken)

The app's `ccClient` speaks a CC contract that was **never validated and cannot work** (creds
are placeholders; it has never talked to live CC):

| Aspect | App today | Proven recipe (required) |
|---|---|---|
| Auth | Bearer `CC_API_KEY` on `app.cartoncloud.com.au/api/v1` | OAuth2 client_credentials on `api.cartoncloud.com` |
| Write endpoint | `PATCH /products/{id}` (transport products → 404 "Invalid product id") | `PATCH /warehouse-products/{id}` |
| Version | `Accept-Version: 1` (silently drops L/W/H) | `Accept-Version: 8` |
| Body | flat `{length,width,height,weight}` | JSON-Patch `op:add` on `/unitOfMeasures/{uom}/{field}` |
| UoM target | none | resolved `defaultUnitOfMeasure` (the Each) |
| Name-poison guard | none | skip SKUs whose UoM set has an invalid name |
| Units | mm→cm ÷10 (also wrong) | **mm→m ÷1000** (metres — fixed in PR #11) |

## 3. Grounding — live CC probe (read-only, 2026-06-24)

Confirmed against a real Forage warehouse-product (`AE-BLA`,
id `55811cf3-aca0-409e-b9e5-99e965ea7700`):

- Top-level keys: `id, references, name, description, type, scope, defaultUnitOfMeasure,
  customer, details, itemPropertyRequirements, unitOfMeasures, timestamps`.
- **SKU code** is `references.code` (e.g. `"AE-BLA"`).
- **Barcode lives on the UoM**, not the product: `unitOfMeasures.EA.barcode = "19345911000021"`.
  The `unitOfMeasures` object is keyed by UoM code (`"PLT"`, `"EA"`, `"CT"`); each value has
  `id, name, baseQty, …` and (for EA) `barcode, weight, volume`. L/W/H are **absent until set**
  (so the write uses `op:add` to create them).
- `defaultUnitOfMeasure = "EA"` — the PATCH target key.
- **Name-poison is real**: this product's `CT` UoM has `name: "CT"` (2 chars < CC's 3-char
  floor); any dims PATCH on the product validates the whole UoM set and 422s. The guard is
  mandatory, not theoretical.
- The **v8 `/warehouse-products/search`** (customer-scoped) returns the full object incl.
  `unitOfMeasures` + barcodes — so the app can seed **everything from this one endpoint**.
  No v1 cross-reference fallback is required.

## 4. Architecture

```
Floor/Capture PWA (unchanged) → IndexedDB queue → POST /api/dims (unchanged)
                                                        │
                            syncService (unchanged: batch 10, advisory lock, X-Sync-Key)
                                                        │
                                          ┌─────────────▼──────────────┐
                                          │   ccClient (REWRITTEN)     │
                                          │  OAuth2 token mgr          │
                                          │  warehouse-products v8 read│
                                          │  v8 JSON-Patch dims write  │
                                          │  name-poison + read-back   │
                                          └─────────────┬──────────────┘
                                                        ▼
                                        CartonCloud  api.cartoncloud.com
                                          /tenants/{tenant}/warehouse-products
```

## 5. Components

### 5.1 OAuth2 token manager (`ccClient`)
- `POST {base}/uaa/oauth/token`, header `Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)`,
  body `grant_type=client_credentials`. Cache `access_token`; refresh 60 s before `expires_in`.
- Base URL `https://api.cartoncloud.com`; all data paths tenant-scoped
  `/tenants/{CC_TENANT_ID}/…`. Keep `CC_BASE_URL` override for tests/mock.
- Reuse the existing `AbortSignal.timeout` + typed errors + token-bucket rate limiter.

### 5.2 Seed / lookup → warehouse-products v8
- **Seed** (`POST /api/admin/seed`, re-pointed): paginate
  `POST /tenants/{t}/warehouse-products/search` filtered to the Forage customer
  (`d4810e1e-91ab-43ed-b68e-b72bd858b122`), `Accept-Version: 8`. For each product upsert a
  `Sku` row with: `id` = **warehouse-product id**, `code` = `references.code`,
  `barcode` = the default UoM's barcode (fallback: first UoM barcode present; may be null),
  `name`, and current default-UoM dims (for the progress display).
- **Lookup** (`GET /api/skus/:barcode`): DB-first by barcode → warehouse-product id. The
  scanner matches a UoM barcode. SKUs with no barcode are not scannable (findable via the
  Progress list's code search) — acceptable, logged.
- The write path resolves `defaultUnitOfMeasure` **live** at write time (it GETs the product
  anyway), so the UoM key is not persisted.

### 5.3 Write recipe (`patchProductDims` rewrite)
Given a warehouse-product id + captured dims (mm/kg):
1. `GET /warehouse-products/{id}` v8 → `customer`, `defaultUnitOfMeasure`, current UoM dims.
2. **Customer guard** — assert `customer.id == Forage`; refuse otherwise (defensive; the
   client is customer-scoped already).
3. **Name-poison guard** — scan `unitOfMeasures[*].name` vs CC's 3–64 char rule; if any fails,
   **skip** with a structured "blocked" reason naming the offending UoM(s). Do not PATCH.
4. Target UoM = `defaultUnitOfMeasure`.
5. Desired dims = **mm→m ÷1000** (L/W/H) + weight kg (PR #11's `mmToMetres`).
6. **Idempotent diff** vs current UoM dims → no-op if unchanged (re-sync safe).
7. `PATCH /warehouse-products/{id}` v8, `Content-Type: application/json-patch+json`, body =
   JSON-Patch **`op:add`** entries on `/unitOfMeasures/{uom}/{length|width|height|weight}` for
   changed fields only.
8. **Read-back verify** — GET again, compare the target UoM's dims to what was written; any
   mismatch → throw (surfaces as a failed sync; this is the live seatbelt).

### 5.4 Sync orchestration (mostly unchanged)
- `syncService` keeps batch-of-10, the advisory lock (no double-PATCH), per-item isolation,
  and the `X-Sync-Key` gate. Each item now flows through the rewritten write path.
- New terminal state per dim: **synced** / **failed (retryable)** / **blocked (name-poison,
  not retryable until fixed in CC)**. `blocked` must not masquerade as `pending` forever.

### 5.5 Operator feedback for blocked SKUs (UI)
- When the sync result marks a SKU `blocked`, the Review/Progress UI shows a clear,
  non-alarming state: "CC blocked — UoM name too short; fix in CC UI" with the offending UoM.
  Distinct from a transient sync failure. Small additive surface.

## 6. Data model

Minimal, additive (first NUC deploy is a fresh DB, so no production migration risk):
- `Sku.id` semantics change from transport-product id → **warehouse-product id** (same type;
  just a re-seed). 
- Add `Sku.code` (the `references.code`). `barcode` stays but is now sourced from the UoM and
  may be nullable.
- `Dim` unchanged (still mm-canonical). The mm→m conversion stays at the CC boundary only.
- Optional: a `blocked`/`blockedReason` field on `Dim` (or a derived sync status) to persist
  the name-poison state for the UI.

## 7. Config / secrets
- New env (replaces `CC_API_KEY`): `CC_CLIENT_ID`, `CC_CLIENT_SECRET`, `CC_TENANT_ID`
  (+ optional `CC_BASE_URL`). Values come from the parent repo's live `.env`. Plus the
  existing `SYNC_SECRET` (gates CC-write routes; fail-closed if unset).
- Injected into the NUC `.env` manually (per `NUC_DEPLOY.md`); never committed. Set up SSH key
  auth to the NUC at deploy time (no password in files).

## 8. Testing
Unit tests (mocked fetch), rewriting the existing `ccClient` suite (it asserts the dead v1
contract):
- token fetch + refresh-before-expiry + Basic-auth header shape;
- seed parses warehouse-product → Sku (id, code, barcode-from-UoM, dims);
- write builds correct v8 JSON-Patch (`op:add`, `/unitOfMeasures/EA/…`, metres values, changed
  fields only) with the right headers;
- UoM resolution = `defaultUnitOfMeasure`;
- name-poison → skip with reason (no PATCH fired);
- idempotent no-op when dims already match;
- read-back mismatch → throws;
- customer-guard refusal.
Smoke: extend the in-container CC mock to the v8 warehouse-products + json-patch shapes.

## 9. Build & deploy plan (app framework)
Through the app's module framework (its `CLAUDE.md` governs):
- **Module 16 `cc-oauth-write`** — the CC-layer rewrite (auth + seed/lookup re-point + write
  recipe + name-poison + read-back + tests). Split into seed-repoint vs write if the build
  conversation approaches the 180K-token sizing limit.
- **Module 17 `blocked-sku-feedback`** — operator UI for blocked SKUs. Small; may fold into 16.
- **Module 15 closeout** — `floor-camera-flow` is marked Built but its `modules/floor-camera-flow/`
  dir, `STATE.md`, and smoke tests are missing. Write them so the gate is honest.
- Then `/compile-stress` → `/deploy-local` (the local validation is stale — modules 14/15 + the
  units fix all landed after `a9d2136`) → `/deploy-nuc` to `gocold-nuc` (`192.168.1.188`,
  fresh deploy: `prod_deployed:false`).

## 10. Risks & mitigations
- **Wrong contract reintroduced** → read-back verify makes any drift fail loudly, not silently.
- **SKUs with no barcode** can't be scanned → still editable via Progress list code-search; seed
  logs how many lack a barcode.
- **Name-poisoned SKUs** can't get dims until CT names are fixed in CC (Jake, manual) → app shows
  a clear blocked state; guard auto-unblocks once names are valid.
- **NUC reachability** — Tailscale IP timed out; use LAN `192.168.1.188`; NUC must be up at
  deploy.
- **Initial backfill volume** — write path is 2 GET + 1 PATCH per dim; ~180 writable SKUs ≈ 540
  calls at the 40/min sync bucket ≈ 13 min for a full backfill. Floor captures are one-at-a-time,
  so this only matters for a bulk initial sync.

## 11. Out of scope
- Re-correcting the parent repo's 132 live 5d writes (cm, ~100× too big) + 4 EA 5b writes — a
  separate, deliberately-armed Python-engine run Jake owns (flagged in `DIMS_UOM_STATE.md`).
- Writing dims to the **CT carton UoM** (CLOSED — name-validation 422 + no-edit-on-master).
- Changing the staff **input** unit toggle (cm/mm/in) — unaffected; entry only.

## 12. Open questions
- Persist `blocked` state on `Dim`, or derive it each sync? (Leaning: persist a small
  `syncBlockedReason` so the UI is correct without a live CC call.)
- Should a scanned **carton** barcode (CT) ever target the CT UoM once names are fixed? Deferred
  — for now all writes target the default (Each), matching the proven pipeline.
