# Vite + React + TypeScript Migration Plan

> Grounded in the actual codebase, not generic advice. Supersedes
> `vite-react-build-plan.md` (which was a generic AI sketch that ignored what we
> already have and would have thrown away the detection accuracy work).

## Guiding constraints (non-negotiable)

1. **The detection pipeline is LOCKED.** `detect.js` (`preprocess`, `findTiles`,
   `dividerSplit`, `padAndRotateCrop`, `cropRotate`, `countPips`, `perspectiveWarp`,
   `loadCV`) must not change behavior. The migration **moves and wraps** it; it does
   not rewrite it. Any step that alters how detection runs requires the explicit
   "change the detection pipeline" approval (see CLAUDE.md).
2. **Accuracy must never regress.** The free local gate `node eval/grid_eval.cjs`
   (28/28) and `node eval/detect_eval.cjs` must stay green through every phase.
   Because `detect.js` logic is untouched, they keep passing by construction — that
   is the whole point of wrapping instead of rewriting.
3. **No paid API calls.** The eval harness stays Node-based and free. Nothing in the
   migration calls `api.anthropic.com`.
4. **`preprocess` stays first, always.** Grayscale + contrast stretch before any
   analysis, in every code path — same as today.
5. **Ship continuously.** The existing static HTML app keeps working at every phase.
   We build the React app *alongside* it and only cut over once parity is proven.

## What we actually have today (so the plan is honest)

- **Shipped pages:** `index.html`, `quick.html` (440 lines), `scan.html` (320),
  `catalog.html` (369). **Dev pages:** `test.html`, `model-test.html`.
- **One detection module:** `detect.js` (826 lines, `window.DominoCV`). Loads
  OpenCV.js 4.x from `https://docs.opencv.org/4.x/opencv.js` via a **DOM `<script>`
  tag** (`detect.js:13-44`); `preprocess` and the scan entry points take a **Canvas
  2D** element. Headless `_test` hooks operate on pixel arrays with no DOM.
- **Backend:** Cloudflare Worker proxy (GitHub session/catalog persistence; legacy
  `/anthropic`). CORS locked to `https://petr0n.github.io`. `config.js` sets
  `window.PROXY_URL`.
- **Deploy:** static files served by GitHub Pages; Worker auto-deploys via GitHub
  Actions. No build step anywhere today.
- **Eval:** `eval/` Node harness (`grid_eval.cjs`, `detect_eval.cjs`) using
  `@techstark/opencv-js` + `jpeg-js`/`canvas`. Not shipped.

## Target architecture

```
src/
  main.tsx                 # React entry, router
  pages/
    Home.tsx               # was index.html
    QuickScan.tsx          # was quick.html (no backend)
    Scan.tsx               # was scan.html (multiplayer)
    Catalog.tsx            # was catalog.html
  components/              # CameraView, GuidanceOverlay, TileList, Scoreboard...
  detection/
    detect.js              # MOVED verbatim — the locked pipeline, untouched
    DominoCV.ts            # typed facade over window.DominoCV / the module export
  api/
    proxy.ts               # typed Worker client (sessions, catalog)
  types/
    domino.ts              # Tile, Session, CatalogEntry, ScanResult
  config.ts                # PROXY_URL from import.meta.env
index.html                 # Vite entry (single root div)
vite.config.ts
tsconfig.json
```

Key decision: **`detect.js` stays a `.js` file** inside `src/detection/`, imported
as-is. We do **not** TypeScript-ify the OpenCV internals (high risk, zero accuracy
benefit). We get type safety at the *boundary* via `DominoCV.ts`, which declares the
shapes the rest of the app consumes.

## Phasing

### Phase 0 — Decide & prerequisites
- Confirm GitHub Pages will serve a built `dist/` (project-pages base path
  `/domino-counter-app/`).
- Decide repo layout: new app in a `app/` (or `web/`) subfolder vs. root. Recommend a
  subfolder so the current static app keeps deploying untouched until cutover.
- Update `.claude/hooks/js-check.sh` plan: it currently `node --check`s changed JS and
  parses inline `<script>`. It must learn to skip/`tsc --noEmit` the TS app (inline
  scripts disappear once pages are React).

### Phase 1 — Scaffold (no behavior change)
- `npm create vite@latest` → React + TS template in the chosen subfolder.
- `vite.config.ts`: set `base: '/domino-counter-app/'`, enable the built-in Web
  Worker support (needed only in the optional Phase 7).
- `tsconfig.json`: `strict: true`. Add `vite-env.d.ts`.
- Verify `npm run dev` and `npm run build` work with an empty shell. Old app still
  lives at root and still deploys.

### Phase 2 — Types first
- `types/domino.ts`: `Tile { left:0..12; right:0..12; player?:string; verified?:boolean }`,
  `ScanResultTile { left:number; right:number; dataUrl?:string }`, `Session`,
  `CatalogEntry`. Mirror the existing data model in CLAUDE.md exactly (catalog key
  `min-max`, double-12 range).
- `config.ts`: `export const PROXY_URL = import.meta.env.VITE_PROXY_URL ??
  'https://domino-counter-proxy.petron.workers.dev'`. One source of truth (DRY).

### Phase 3 — Wrap detection (logic frozen)
- Move `detect.js` into `src/detection/` **unchanged**. It still attaches
  `window.DominoCV` and still loads OpenCV via the `<script>` tag on the main thread —
  works fine in a React app, no pipeline change.
- `DominoCV.ts`: typed facade —
  ```ts
  export interface DominoCV {
    loadCV(): Promise<void>;
    preprocess(c: HTMLCanvasElement): void;
    scanCanvas(c: HTMLCanvasElement): { left: number; right: number }[];
    scanCanvasDebug(c: HTMLCanvasElement): ScanResultTile[];
    scanCanvasSingle(c: HTMLCanvasElement): { left: number; right: number };
    isReady(): boolean;
  }
  ```
  Import `./detect.js` for its side effect, then `export default window.DominoCV as DominoCV`.
- **Gate:** `grid_eval` + `detect_eval` still green (file is byte-identical).

### Phase 4 — Port pages, simplest first, parity-checked
Order chosen by risk (no backend → backend):
1. **Home** (`index.html`) — trivial, three buttons / router links.
2. **QuickScan** (`quick.html`) — no backend. The hard one for React patterns:
   camera stream, the 2 fps guidance loop, `scanCanvasDebug`, history list. Build
   `useCamera`, `useGuidance` hooks. Keep the **same** preprocess→scan call order.
   Verify against the same photos the old page handles (the dev log server still works).
3. **Catalog** (`catalog.html`) — `scanCanvasSingle` + manual-correction UI + GitHub
   write.
4. **Scan** (`scan.html`) — multiplayer: code gen (`crypto.getRandomValues`, keep the
   unambiguous charset), session read/write, live scoreboard.
- Keep each old `.html` until its React twin is verified, then retire it.

### Phase 5 — Typed backend client
- `api/proxy.ts`: `getSession(code)`, `putSession(code, data)`, `getCatalog()`,
  `putCatalog(...)` — all hitting `${PROXY_URL}/github/...`. Centralize the GitHub
  contents-API plumbing (base64, SHA on update) that's currently duplicated inline in
  `scan.html` and `catalog.html` — **DRY win**, one place.
- Worker itself is unchanged. CORS still allows only `petr0n.github.io`, which is the
  deployed origin — dev needs either a local proxy allowance or testing against the
  deployed build (note this; don't loosen Worker CORS casually).

### Phase 6 — Dev tooling parity
- `eval/` Node harness stays exactly as-is (separate from the app, still free, still
  the accuracy gate). It imports `detect.js` via `_test` hooks — that path is
  unaffected by the React move.
- `test.html` / `model-test.html`: port to dev-only routes *or* leave as standalone
  static files. They only call `DominoCV.preprocess`; no urgency.

### Phase 7 — (OPTIONAL, separately approved) Move detection to a Web Worker
**This is the only phase that touches the locked pipeline — do NOT start it without
the explicit "change the detection pipeline" go-ahead.** It's also the only phase that
delivers the "UI never stutters" benefit the Google doc was chasing.
- Two DOM dependencies must be replaced inside a worker:
  - **OpenCV load:** `<script>` tag → `importScripts('https://docs.opencv.org/4.x/opencv.js')`.
  - **Canvas access:** `preprocess` and the scan entry points take an
    `HTMLCanvasElement` → use **`OffscreenCanvas`** / transfer `ImageData` to the
    worker. The core math in `_test.stretchGray` already works on raw pixel arrays, so
    the refactor is at the boundary, not the algorithm.
- Wire with the built-in Vite worker (`new Worker(new URL('./detect.worker.ts',
  import.meta.url), { type: 'module' })`); Comlink optional for ergonomics.
- **Gate:** add a worker-path eval or a parity test asserting identical `{left,right}`
  output vs. the main-thread path on the committed `ref_*` crops before shipping.

### Phase 8 — Cutover
- Point GitHub Pages at the built `dist/`. Either: build in CI and publish, or commit
  the build. Update/keep `deploy-worker.yml` (Worker unchanged); add a Pages build step.
- Keep the cache-bust convention:
  `https://petr0n.github.io/domino-counter-app/quick.html?v=<PR>` → becomes a routed
  path; preserve an equivalent versioned link in the PR workflow.
- Delete retired `.html` files only after the React routes are confirmed in production.

## Risks & how we handle them

| Risk | Mitigation |
|---|---|
| Worker rewrite breaks accuracy | Phases 1–6 don't touch `detect.js`; Phase 7 is gated + parity-tested before ship. |
| OpenCV.js in a bundler | We keep the **CDN** load (script tag now, `importScripts` later), not the npm `opencv-js-wasm` package the Google doc suggested — avoids an API-surface audit. |
| GitHub Pages base path | Set `base: '/domino-counter-app/'` in Vite from Phase 1. |
| Worker CORS in dev | Test backend paths against the deployed origin or add a guarded dev allowance; never loosen prod CORS. |
| Stop hook can't lint TSX | Update `js-check.sh` to run `tsc --noEmit` for the app and stop parsing inline scripts that no longer exist. |
| Scope creep off the core mission | None of this improves pip accuracy. It's a maintainability/foundation bet — sequence it **after** pip counting is solid, and keep each phase shippable. |

## Recommended sequencing vs. the core mission

Pip-counting accuracy is still the job. This migration is a foundation investment, not
an accuracy improvement. Do Phases 0–3 (cheap, reversible, zero behavior change)
whenever; hold Phase 4+ until pip counting is where you want it, so the rewrite lands
on a stable detection base instead of a moving target.
