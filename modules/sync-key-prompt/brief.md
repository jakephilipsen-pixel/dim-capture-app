# Module 14: sync-key-prompt

## What this module does

Module 12 (`cc-write-authz`) gated `POST /api/sync/cc` and `POST /api/admin/seed`
behind an `X-Sync-Key: <SYNC_SECRET>` header. The frontend (built before module 12)
did not send this header, so the PWA's auto-sync and the Review page's "Sync Now"
button were 401-ing silently.

This module gives the operator a way to authorise CC sync from the PWA without
embedding a secret in the app bundle or environment. The operator enters the key
once per browser session; it is held in sessionStorage and sent as `X-Sync-Key`
on CC-sync calls only.

## Scope

- `lib/syncKey.ts` — sessionStorage-backed store: `getSyncKey`, `setSyncKey`,
  `clearSyncKey`.
- `lib/api.ts` — `syncToCC()` reads the key from the store; on 401 clears it and
  throws. If no key is present, throws `ApiError(401)` without hitting the network.
- `hooks/useSync.ts` — background sync skips the CC-sync step silently when no key
  is present; the local queue drain is unaffected.
- `pages/Review.tsx` — "Sync Now" button: if no key → opens a prompt dialog
  (password input + Authorise & Sync + Cancel); stores key + runs sync. On 401:
  clears key, shows inline error, re-opens prompt.
- `components/ui/dialog.tsx` — new centred modal built on `@radix-ui/react-dialog`
  (already a project dependency via sheet.tsx).

## Out of scope

- `POST /api/admin/seed` key handling (the seed flow has no frontend in this
  version of the app).
- Any server-side session or token management.
- A "forget key" button — sessionStorage clearing on tab close is sufficient.

## Acceptance criteria

1. `getSyncKey()` returns null when nothing is stored, returns the stored string
   after `setSyncKey`, returns null again after `clearSyncKey`.
2. `api.syncToCC()` sends `X-Sync-Key` header when a key is present.
3. `api.syncToCC()` throws `ApiError(401)` without a network call when no key is
   present.
4. `api.syncToCC()` clears the key and throws `ApiError(401)` on a real 401 from
   the backend.
5. `api.saveDim()` (capture path) never sends `X-Sync-Key` — always ungated.
6. `useSync` drains the local IndexedDB queue regardless of key presence.
7. `useSync` skips `POST /api/sync/cc` silently when no key is stored.
8. `useSync` calls `POST /api/sync/cc` when a key is present and `pendingSync > 0`.
9. Review "Sync Now" with no key → opens prompt dialog.
10. Review: submitting the prompt stores the key and triggers sync.
11. Review: 401 from sync → clears key, shows "Sync key rejected — re-enter.", keeps
    prompt open.
12. Review: "Sync Now" with key already stored → sync fires directly (no prompt).
