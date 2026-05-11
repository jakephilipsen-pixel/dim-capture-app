# Build prompt: capture-page

You are building the `capture-page` module of `dim-capture-app`.

## Read first
- This file (`modules/capture-page/prompt.md`)
- `modules/capture-page/brief.md` — scope and acceptance criteria
- `modules/capture-page/smoke.md` — smoke test spec (must pass before module is ✅)
- `modules/capture-page/STATE.md` — current state (will be empty for new builds)
- `modules/frontend-scaffold/STATE.md` — router, layout, api.ts, units.ts, shadcn components
- `modules/sku-seed/STATE.md` — SKU API route shapes
- `modules/dim-api/STATE.md` — dim API route shapes
- `DECISIONS.md` — architectural decisions already made
- `dim-capture-app-spec.md` — Capture page UX wireframe, barcode scanner details, offline queue spec

## Do not read
- Source code of dependency modules
- `node_modules/`, build artifacts, lockfiles

## Task
Build this module to satisfy every acceptance criterion in `brief.md`. Production-ready code, no placeholders.

## Workflow
1. Confirm understanding: state in 2-3 sentences what you're building and your planned approach
2. Wait for go-ahead from Jake
3. Build incrementally — BarcodeScanner → hooks → DimForm → SkuCard → Capture page → offline queue
4. After each meaningful chunk, update `STATE.md`
5. When acceptance criteria all pass:
   a. Write smoke tests in `modules/capture-page/smoke/` per smoke.md spec
   b. Run `./scripts/smoke-module.sh capture-page` — must exit 0
   c. Finalise `STATE.md`, update `MODULES.md` to ✅ Built
   d. Commit, push, open PR

## Stack reminders
- ZXing: `@zxing/browser` — use `BrowserMultiFormatReader`. Camera permission requested on first Scan tap.
- Torch: `ImageCapture.setPhotoCapabilities` — detect support and hide button gracefully if unsupported
- Success sound: Web Audio API `OscillatorNode` at 880Hz for 150ms — no audio file
- Success haptic: `navigator.vibrate(100)` if supported
- IndexedDB offline queue: use `idb` package — one store `pendingDims`, UUID keys
- `useSync`: `navigator.onLine` + `online` event listener to trigger sync; poll every 30s
- `measuredBy` persists in `localStorage` key `dim-capture-measuredBy`
- Unit toggle state lives in component state only (no URL/storage persistence)
- Tests: Vitest + Testing Library; mock ZXing and fetch; no real camera

## Coding standards
- TypeScript strict, no `any`
- All tap targets ≥ 44px (CSS min-height/min-width)
- Numeric dim inputs: `inputMode="decimal"`, `type="number"`, `min="0.001"`
- Tests use Vitest + @testing-library/react

## Context budget
180K token ceiling. Stop and update STATE.md if approaching. BarcodeScanner + IndexedDB queue is where most of the complexity lives — prioritise those.

## When done
Tell Jake: "Module `capture-page` complete. Smoke passed. PR: <url>. Acceptance criteria met. STATE.md and MODULES.md updated. `/clear` before next module."
