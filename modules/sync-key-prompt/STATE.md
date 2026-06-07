# State: sync-key-prompt

> This file is the handoff record between conversations. Keep it accurate.

## Status
✅ Built — all tests green (2026-06-08)

## Branch
`feature/sync-key-prompt`

## Last touched
2026-06-08 — initial build: sync-key store, api header, auto-sync skip, Review
prompt dialog, dialog.tsx component.

## Public interface (what this module exports)

### `frontend/src/lib/syncKey.ts`
```typescript
export function getSyncKey(): string | null   // reads sessionStorage
export function setSyncKey(value: string): void
export function clearSyncKey(): void
```
Backed by `sessionStorage` under key `dca.syncKey`. Safe to call in SSR /
no-storage environments (all functions catch storage exceptions).

### `frontend/src/components/ui/dialog.tsx`
Standard shadcn/ui-style Dialog built on `@radix-ui/react-dialog` (already a
project dep). Exports: `Dialog`, `DialogPortal`, `DialogOverlay`, `DialogTrigger`,
`DialogClose`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`,
`DialogDescription`.

### Changes to existing modules (additive, backward compatible)

**`lib/api.ts`**
- `syncToCC()` is now `async`, reads `getSyncKey()` before calling the network.
  - No key: throws `ApiError(401, 'Sync key required', null)` with no network call.
  - Key present: sends `X-Sync-Key: <key>` header.
  - 401 from backend: calls `clearSyncKey()` then re-throws the `ApiError(401)`.
  - All other paths unchanged.
- `saveDim()` is unchanged — capture is always ungated.

**`hooks/useSync.ts`**
- Step 2 (CC-sync) is now guarded: `if (getSyncKey() !== null) { ... }`.
  - No key → silent skip; local queue drain (step 1) is unaffected.
  - Key present → existing behaviour (getProgress + syncToCC if pendingSync > 0).
  - 401 (key cleared by api.syncToCC) → caught silently; next tick re-checks key
    (which is now null) and skips again — no 401 spam.

**`pages/Review.tsx`**
- `syncNow()`: if no key → opens prompt dialog; if key present → calls `runSync()`.
- `runSync(wasAuthorised?)`: calls `api.syncToCC()`, handles 401 by clearing key
  and re-opening prompt with optional "Sync key rejected — re-enter." error.
- New state: `promptOpen`, `keyDraft`, `keyError`.
- New Dialog render at bottom of JSX (above Sheet).

## Files added/changed
```
frontend/src/
  lib/syncKey.ts             (NEW) sessionStorage key store
  lib/syncKey.test.ts        (NEW) 7 unit tests
  lib/api.syncKey.test.ts    (NEW) 4 unit tests for api.syncToCC × key
  lib/api.ts                 (CHANGED) syncToCC reads key, handles 401
  hooks/useSync.ts           (CHANGED) CC-sync step gated on getSyncKey()
  hooks/useSync.test.tsx     (CHANGED) added setSyncKey in the "drain + sync" test
  hooks/useSync.syncKey.test.tsx  (NEW) 3 unit tests for skip/fire/401 behaviour
  components/ui/dialog.tsx   (NEW) centred modal component
  pages/Review.tsx           (CHANGED) prompt dialog + runSync/syncNow refactor
  pages/Review.test.tsx      (CHANGED) setSyncKey in beforeEach, clearSyncKey in afterEach
  pages/Review.syncKey.test.tsx  (NEW) 4 unit tests for prompt behaviour
modules/sync-key-prompt/
  brief.md
  STATE.md
```

## How the sync-key flow works

1. **Session start**: `getSyncKey()` returns null; auto-sync skips CC-sync silently;
   the pending badge shows the backlog.
2. **Operator taps Sync Now**: `syncNow()` checks key → null → opens prompt.
3. **Operator enters key + taps Authorise & Sync**: `setSyncKey(trimmed)` → prompt
   closes → `runSync(true)` fires → `api.syncToCC()` sends `X-Sync-Key` → success
   → reload. Key persists in sessionStorage for the rest of the session.
4. **Auto-sync on subsequent ticks**: key is now present → CC-sync fires automatically
   (no further operator interaction required this session).
5. **Wrong key**: backend returns 401 → `clearSyncKey()` → prompt re-opens with
   "Sync key rejected — re-enter." error.
6. **Tab close**: sessionStorage cleared by the browser — re-authorisation required
   next session.

## Quirks / gotchas

- `api.syncToCC()` is now `async` (returns `Promise<SyncReport>`) — it was already
  returning a promise implicitly, but the function keyword is now `async`. No call
  sites broke.
- The `Dialog` in Review.tsx uses `aria-describedby="sync-key-desc"` on
  `DialogContent` and `id="sync-key-desc"` on `DialogDescription` to suppress the
  Radix "Missing Description" console warning.
- The Dialog component uses the same `@radix-ui/react-dialog` primitive as Sheet.
  Both can be open simultaneously in theory (e.g. prompt while an edit sheet is
  open), but in practice the Review page doesn't expose that path.
- `useSync.syncKey.test.tsx`'s "clears the key on 401" test mocks `api.syncToCC` to
  reject with `ApiError(401)`. In the mocked world `clearSyncKey()` inside the real
  `api.syncToCC` does not run — that behaviour is covered separately by
  `api.syncKey.test.ts`. The test asserts `syncMock` was called exactly once (no
  retry loop).

## Test status
- [x] 18 new tests written and passing
- [x] 41 original tests continue to pass (59 total)
- [x] `tsc -b` clean (exit 0)
- [x] No `--run` flag needed; `npm test` exit 0

## Decisions made during this module's build
(added to DECISIONS.md)
- Sync key stored in sessionStorage (not localStorage): per-session human approval;
  tab close clears it automatically.
- `api.syncToCC()` throws `ApiError(401)` without a network request when no key is
  present — avoids 401 spam to the backend.
- `useSync` skips CC-sync silently when no key — local queue drain is unaffected.
- A new `dialog.tsx` component was created from the `@radix-ui/react-dialog`
  primitive (already in package.json as a dep of sheet.tsx).

## In-flight work
None — module complete.
