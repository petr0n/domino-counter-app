# Claude Code Rules for This Project

## One Goal

**Scan a phone camera image of domino tiles and return accurate pip counts every time. Every decision, change, and line of code must serve this goal. If a change doesn't make pip detection more accurate, more consistent, or more reliable, don't make it.**

### Pursue It Cheaply — Token Cost Is a First-Class Constraint

**Accuracy is the goal; reaching it without burning tokens is how the goal must be pursued. Wasted context and tokens are a real cost the user pays out of pocket — treat them like a production resource, not free. Being economical is never an excuse to cut an accuracy corner; it means landing the same *verified* result with less waste.**

- **Read narrowly.** Never read a large file in full when `offset`/`limit` or a targeted `grep`/search will do. `detect.js` and the page files are large — pull only the lines you need.
- **Never re-read** a file already read this session unless its contents changed.
- **Mute noisy commands.** Pipe anything that can dump huge output through `tail`/`head` — a failed `grid_eval` spews the entire minified OpenCV source. Use `node eval/grid_eval.cjs 2>&1 | tail -20`.
- **Fewer loops.** Every accuracy iteration (change → eval → diagnose) costs tokens. Think the change through and verify locally before iterating; more/better test photos converge accuracy in fewer loops.
- **Keep files small.** Prefer extracting large inline `<script>` blocks into their own files so future edits read tens of lines, not hundreds.
- **Be concise.** Don't pad replies, re-explain settled decisions, or re-derive facts already established.

---

## Detection Pipeline Gate

The following are LOCKED. Do not touch them unless the user explicitly says **"change the detection pipeline"**:

- **`DominoCV.preprocess` (grayscale + contrast stretch) runs FIRST on every image, before ANY engine (OpenCV or vision model). This step is foundational and must never be removed or bypassed — see "Image Preprocessing" below.**
- The shared detection module `detect.js` — `preprocess()` (Canvas 2D grayscale + contrast stretch), `scanCanvas()`, `perspectiveWarp()`, `countPips()`, `loadCV()`
- The OpenCV.js CDN URL or version

If you think the pipeline needs improving, say so and wait for the user to approve before touching anything.

---

## PR Workflow

After pushing a branch, create a PR (ready for review, not draft) and **immediately merge it** — do not wait for user confirmation. Never block on PR merge.

After every merge, provide a fresh cache-busting link to the app so the user can immediately test. **Which link depends on the device the user is on:**
- **Desktop (default):** the user runs a local static server — link to localhost:
  `http://localhost:8765/quick.html?v=<PR number>`
- **Phone:** link to the deployed GitHub Pages site:
  `https://petr0n.github.io/domino-counter-app/quick.html?v=<PR number>`

The user will say which device they're on (or it's clear from context). When unsure, assume desktop/localhost — the user works from their desktop by default and has asked not to be given GitHub Pages links while testing locally.

---

## Triple-Check All Code Before Pushing

Before every commit, verify:
1. Every OpenCV function call uses an API that actually exists in OpenCV.js 4.x — do not assume an API exists; check it.
2. Every `cv.Mat` destination argument is initialized with `new cv.Mat()` before being passed to any OpenCV function — never pass `null`.
3. Every `new cv.Mat()` created in a `try` block is deleted in the matching `finally` block.

After a merge conflict resolution, re-check all three points above on the resolved file before pushing.

---

## Keep CLAUDE.md In Sync With the Code

**This file is a guardrail — a wrong statement here sends the next session down the wrong path (it has already happened). When a change makes anything here inaccurate, update CLAUDE.md in the SAME PR as the change.**

- Especially detection/counter behavior: if you change what `detect.js` does, change its description here too. Never leave the doc claiming behavior the code no longer has.
- Don't document intended/aspirational behavior as if it ships. If something exists but is dormant or reverted, say so explicitly.
- Verify before you write: confirm a claim against the actual code (see "Do NOT Assume Anything"). Don't describe a function from its name or an old comment.
- **Regressions are unacceptable.** After any `detect.js` change, run the free `grid_eval` (see below) and confirm accuracy held or improved before pushing — never ship a number you didn't measure.

---

## Do NOT Assume Anything

Always check facts against existing code, documentation, or the actual file before acting. Back up reasoning with evidence — cite the file and line, or the doc you read. Never state something about the code without verifying it first.

---

## Accuracy Is the Job — Use the Internet, Own Your Mistakes

**Improving pip-counting accuracy is the top goal of every iteration. Every change must move accuracy forward — measure it locally and free with `eval/grid_eval.cjs` (the shipped OpenCV counter scored against `grid_truth.json` using the committed `ref_*.jpg` crops), do not guess it.**

- **NEVER spend money on API tokens.** Do NOT run anything that calls the paid Claude API — `eval/eval.mjs` (`npm run eval`), `model-test.html`, or any direct `api.anthropic.com` / Worker `/anthropic` call — for validation, experimentation, or anything else, without the user's explicit per-task approval. The shipped pip counter is 100% local OpenCV; validate it the same way, with `grid_eval.cjs`. It costs nothing and needs no network.
- **Do not limit yourself to what is already in your head.** When you get stuck — an OpenCV API you're unsure exists, a segmentation/counting technique you don't know cold, an error you can't place — search the Internet for a working solution or example *before* guessing. The web is a first-class reference and resource, not a last resort. Always verify what you find against the actual code and the real OpenCV.js 4.x API (see "Do NOT Assume Anything" and the Triple-Check list).
- **No excuses.** Do not explain away a broken result, hand-wave past a failure, or ship something you haven't verified. Diagnose the real cause and do it correctly.
- **If you screw up, fix it.** Own the mistake and produce a concrete fix — a corrected change, a regression test that catches it, or a clean rollback — not an apology. An iteration is not done until accuracy is restored or improved and verified.

---

## DRY — Don't Repeat Yourself

**Never recreate something that already exists. Before writing any function, constant, or block of logic, search the codebase for it first — if it exists, reuse it; if it nearly exists, extend or refactor it. Never copy-paste a second implementation of the same thing.**

- One responsibility → one place. Shared logic lives in one module (e.g. detection lives only in `detect.js`), imported wherever it is needed.
- If you find yourself pasting code from one file into another, stop: extract it to a shared location and have both call it.
- If you spot existing duplication, prefer consolidating it over adding a third copy.
- This applies to data too: catalog keys, config values (`window.PROXY_URL`), constants — define once, reference everywhere.

Duplicated detection code is exactly what made this app unreliable. Keep it singular.

---

## Locked Decisions — Do Not Revisit Without Explicit Instruction

These decisions were made deliberately after testing. Do not second-guess, reverse, or "improve" them without the user explicitly asking.

### Pip color is NOT a signal
**Different domino sets use different pip colors (yellow, orange, green, blue, purple, pink, black, …). NEVER base tile detection, pip counting, prompts, thresholds, or any logic on a specific color or color palette.** Count every pip regardless of its color. Any approach must be fully color-agnostic — do not assume pips are a particular color, and do not identify or group tiles/pips by color.

### These are DOUBLE-12 tiles
**Each half holds 0–12 pips. Do not assume halves are ≤6.** Counting logic must handle the full 0–12 range per half.

### Pip grid model — exactly two layouts, 3 rows always
**Every half lays its pips on one of only two grids, and no half deviates:**
- **0–9 pips → a 3×3 grid** (e.g. 6 = two full outer columns with the middle column empty; 8 = the ring, all but centre; 9 = all nine).
- **10–12 pips → a 4×3 grid** (4 columns × 3 rows). Top and bottom rows are always full (4 each); the middle row holds the remainder: **10 = 2 (outer), 11 = 3, 12 = 4**.
- **The 11 middle row is special:** its 3 pips are spaced left/centre/right across the full width — the centre pip sits dead-centre and does NOT align to the 4 columns. Count the 4×3 middle row by its blobs, not by column position.

**Shipped counter — `countPips` → `countPipsContour`:** Otsu-threshold each half, find external contours, and keep round blobs (area in range AND circularity ≥ 0.45) as pips. A guarded "merged-pip" correction then adds count for low-circularity blobs that are genuine fused pips — but only when their area-ratio is in a window **and** their circularity is **≥ 0.15**, so thin divider-bar / edge slivers (circ ~0.1) are never counted as pips (that floor fixed the `ref_464` 6→7 overcount). The layouts above are what the counter must reproduce — its job is to land on the right 0–12 total per half.

A lattice/occupancy counter (`countPipsGrid`) that infers the 3×3 / 4×3 grid and occupancy-tests each cell **exists in `detect.js` but is currently DORMANT** — it was wired into `countPips` and reverted (`1846da9`) as an accuracy regression. The lattice model remains the *intended* direction; if you revisit it, prove it beats the contour counter on `grid_eval` before switching. Be cautious extending the merged-pip heuristic — it has historically overcounted real halves.

### Tile Detection Code Is Locked — Do Not Touch Until More Photos Are Available
**`findTiles`, `dividerSplit`, `padAndRotateCrop`, `cropRotate`, and the edge-margin logic in `detect.js` are locked as of PR #106.** Tile detection scored 8/8 on the available photo set. Do not touch any of this code until the user provides additional multi-tile test photos and explicitly asks for a tile detection change. Only pip counting work is in scope in the meantime.

### Tiles NEVER overlap
**Tiles may touch edge-to-edge but they NEVER overlap or sit on top of each other — this is a hard rule.** Every tile blob is therefore fully separable; detection may rely on this. In practice `findTiles` first erodes to separate touching tiles, then for any blob that still merges two tiles it falls back to `dividerSplit` (reconstruct each tile from its centre divider bar). Never add logic to handle overlapping tiles — that case cannot occur.

### Tile Detection: OpenCV.js in one shared module
**OpenCV.js is the ONLY tile detection and pip counting engine. There is exactly ONE implementation — `detect.js` (`window.DominoCV`) — shared by every page that detects or preprocesses (`quick.html`, `scan.html`, `catalog.html`, `test.html`). Do not duplicate it back into the pages, and do not replace it with Claude AI or any other approach.**

`detect.js` exposes:
- `DominoCV.loadCV()` — lazy-load OpenCV.js
- `DominoCV.preprocess(canvas)` — grayscale + contrast stretch (in place)
- `DominoCV.scanCanvas(canvas)` → `[{left,right}, …]` — every tile in the frame (`quick.html`, `scan.html`)
- `DominoCV.scanCanvasSingle(canvas)` → `{left,right}` — the single largest tile, with whole-frame fallback (`catalog.html`)

Every page captures a frame, calls `DominoCV.preprocess`, then the appropriate scan function. `quick.html` and `catalog.html` additionally run their own real-time guidance loops (a UI concern, not detection). The two scan functions share the same internal `findTiles` / `perspectiveWarp` / `countPips` primitives — keep it that way.

Reasoning locked in: after preprocessing (grayscale + contrast stretch), pip dots are dark circles on a bright background — exactly what OpenCV contour/blob detection was built for. It is deterministic, free, and accurate on this input. Claude AI vision was tried in `scan.html` and produced inconsistent pip counts, so it was removed.

### Image Preprocessing: Grayscale + Contrast Stretch — ALWAYS, FIRST (FOUNDATIONAL — never remove)
**Every captured image is converted to grayscale and histogram-stretched to the full 0–255 range (Canvas 2D, `DominoCV.preprocess`) BEFORE any analysis — by EVERY engine, current or future (OpenCV, Claude / vision model, anything). NEVER send a raw, un-preprocessed image to any detection or counting step.**

This has been part of the pipeline from the very beginning and is non-negotiable. Do NOT remove it, bypass it, "simplify" it away, or feed raw color to any analyzer. It has been deleted and re-added several times by mistake — that must stop. If a change seems to need raw color, STOP and ask first.

Reasoning locked in: pips come in many colors, and **color must never be a signal** (see above). Grayscale + contrast stretch turns pips of ANY color into uniformly dark, high-contrast dots on a bright tile — maximally distinct and fully color-agnostic. This is what makes both OpenCV blob detection AND vision-model counting reliable; the user has confirmed it makes pips stand out well. It runs client-side with no dependencies.

### Storage: domino-counter-app repo
**Sessions are stored at `sessions/{code}.json` and catalog at `catalog.json` in the `petr0n/domino-counter-app` repo via GitHub API.** Do not change this to any other repo or path.

### Claude API: Not Used for Detection
**No scanning page calls the Anthropic Claude API. Tile detection and pip counting are 100% local OpenCV.js.** The Worker still exposes a `/anthropic` route, but the app no longer uses it — it is legacy and may be removed. The Worker is required only for the GitHub session/catalog proxy.

### Game Codes: crypto.getRandomValues
**`genCode()` uses `crypto.getRandomValues` with an unambiguous character set (no 0/O/1/I/l).** Do not change to `Math.random()`.

---

## Project Overview

**Domino Counter App** is a static web application for scanning and counting domino tiles. It supports single-player quick-scan mode (OpenCV.js, fully local) and multiplayer sessions (also OpenCV.js for detection, with game state persisted to GitHub via the Worker proxy).

There is no build system, no npm packages in the root, and no framework — only vanilla JavaScript embedded in HTML files, with a separate Cloudflare Worker backend.

---

## Repository Structure

```
domino-counter-app/
├── .claude/
│   ├── hooks/
│   │   └── js-check.sh       # Stop hook: syntax-checks changed JS/HTML files
│   └── settings.json         # Harness config (Stop hook registration)
├── .github/
│   └── workflows/
│       └── deploy-worker.yml # Auto-deploys Cloudflare Worker on push to main
├── worker/
│   ├── src/
│   │   └── index.js          # Cloudflare Worker credential proxy
│   ├── wrangler.toml         # Worker config (name: domino-counter-proxy)
│   └── README.md             # Worker deployment & secret rotation guide
├── sessions/
│   └── .gitkeep              # Placeholder — actual session files written by app
├── eval/                     # Pip-counting eval harness + scratch scripts (NOT shipped)
│   ├── README.md             # How to run the eval harness
│   ├── eval.mjs              # Node runner: scores pipeline output vs ground truth
│   ├── prompt.txt            # Counting prompt under test
│   ├── fixtures.json         # Ground-truth tiles per photo (scoring key)
│   ├── headless.cjs          # Loads detect.js _test hooks for Node-side testing
│   ├── grid_truth.json       # Ground truth for grid-counter experiments
│   ├── test_*.cjs            # One-off diagnostic/debug scripts (not a test suite)
│   ├── ref_*.jpg / *_proper.jpg / crop_*.jpg  # Reference tile/half crops
│   └── package.json          # eval-only deps (canvas, opencv); photos/ git-ignored
├── .gitignore                # Ignores test-results/, eval/node_modules/, eval/photos/
├── CLAUDE.md                 # This file
├── catalog.json              # Tile database: all 56 tiles in a double-12 set
├── config.js                 # Sets window.PROXY_URL to the deployed Worker URL
├── detect.js                 # Shared OpenCV detection module (window.DominoCV)
├── index.html                # Landing page (New Game / Join Game / Catalog)
├── scan.html                 # Multiplayer tile scanner
├── quick.html                # Single-player quick scan (no backend required)
├── catalog.html              # Tile catalog builder UI
├── test.html                 # Preprocessing regression-test page (visual check)
└── model-test.html           # Engine-test page: experiments with Claude counting (NOT shipped)
```

---

## Pages & Their Responsibilities

### `index.html`
Entry point. Three navigation buttons: New Game, Join Game, Catalog. No logic.

### `scan.html` — Multiplayer Scanner
- Creates or joins a game using a 6-letter random code (`crypto.getRandomValues`)
- Captures camera frame → Canvas 2D grayscale + contrast stretch → OpenCV.js pip counting (runs locally, same pipeline as `quick.html`)
- Reads/writes game session JSON files to GitHub via the Worker
- Displays a live scoreboard; current player's tiles shown individually with per-tile delete

### `quick.html` — Single-Player Quick Scan
- Canvas 2D preprocessing (grayscale + contrast stretch) → OpenCV.js pipeline running locally (uses `DominoCV.scanCanvasDebug`, which returns each tile's `{left,right,dataUrl}` thumbnail for the history list)
- No backend calls; state is in-memory only (not persisted between page reloads)
- Real-time guidance: checks image brightness and sharpness at 2 fps
- History list of scanned tiles with running pip totals

### `catalog.html` — Tile Catalog Builder
- Scans individual tiles via `DominoCV.scanCanvasSingle` and records them into `catalog.json` via GitHub API
- Includes manual verification UI to correct CV misdetections
- Same OpenCV guidance loop as quick.html

### `test.html` — Preprocessing Regression Test (dev tool)
- Loads an image, runs `DominoCV.preprocess` on it, and shows original vs preprocessed side by side for **visual** verification that pips of any color become dark, high-contrast dots
- Lets you save test images to `localStorage` and re-run preprocessing on all of them
- Detection-only sanity check; not part of the user-facing app flow

### `model-test.html` — Engine Test, Claude counting (experimental, NOT shipped)
- Sandbox for evaluating Claude vision pip counting via the Worker `/anthropic` proxy: single-pass or two-pass "zoom" (locate each tile, then count each crop)
- Always runs the LOCKED `DominoCV.preprocess` on every image first (grayscale + contrast stretch), consistent with the rest of the app
- Exists **only** to validate counting accuracy before any future decision to wire a vision model in. It is NOT used by the shipped scanning pages — those remain 100% local OpenCV (see "Claude API: Not Used for Detection"). Must be opened on `petr0n.github.io` because the proxy only accepts that origin.

### `config.js`
Sets `window.PROXY_URL = "https://domino-counter-proxy.petron.workers.dev"`. This must be configured before any page that calls the Worker. **Do not hard-code this URL elsewhere.**

---

## Backend: Cloudflare Worker (`worker/src/index.js`)

Acts as a credential proxy. The browser never sees API keys.

**Routes:**
- `POST /anthropic` → forwards to Anthropic API with `ANTHROPIC_API_KEY` header injected
  - Legacy/unused: no page in the app calls this route anymore (detection is local OpenCV). Kept for now; safe to remove.
- `GET|PUT /github/repos/...` → forwards to GitHub API with `GITHUB_TOKEN` header injected
  - Allowed paths: `repos/petr0n/domino-counter-app/contents/sessions/` and `repos/petr0n/domino-counter-app/contents/catalog.json` only

**CORS:** Only `https://petr0n.github.io` is allowed as the origin.

**Secrets (set in Cloudflare dashboard or via wrangler):**
```
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GITHUB_TOKEN
```

**Deploy:** Automatic via GitHub Actions (`deploy-worker.yml`) on every push to `main` that touches `worker/`. Requires `CLOUDFLARE_API_TOKEN` secret in the GitHub repo. Can also be triggered manually from the Actions tab.

---

## Data Model

### Tile
```js
{ left: 0-12, right: 0-12, player: string, verified: boolean }
```

### Catalog key (normalized)
```js
`${Math.min(left, right)}-${Math.max(left, right)}`
```
So `1-2` and `2-1` map to the same key `"1-2"`.

### catalog.json
Array of 56 tile objects covering all unique combinations in a double-12 set (0-0 through 12-12). Stored at repo root and readable via Worker at `catalog.json`.

### Game sessions
Stored as JSON files on GitHub at `sessions/{code}.json` in this repo. The `sessions/` folder placeholder is committed; actual session files are written by the app at runtime.

---

## Image Pipeline

### Step 1 — Canvas 2D Preprocessing (`DominoCV.preprocess`, every scan page)
1. Capture video frame to canvas
2. Convert to grayscale: `g = 0.299*r + 0.587*g + 0.114*b`
3. Histogram stretch: find min/max pixel values, remap to 0–255
4. Result: high-contrast B&W image where pip dots are maximally dark

### Step 2 — OpenCV.js (`detect.js`, every scan page)
1. Otsu threshold on the preprocessed image isolates the bright tiles
2. Open/close morphology makes each tile one solid blob (touching tiles stay separate)
3. `minAreaRect` per blob, filtered by area, aspect ratio, and fill ratio → tile rectangles (tolerant of rounded corners and rotation). A blob that matches neither a single tile nor the geometric two-tile split (e.g. tiles touching at an angle) is passed to `dividerSplit`, which finds each tile's centre divider bar inside the blob and reconstructs the full rectangle from it via the 2:1 model (short side = divider length, long side = 2×, perpendicular). This is additive — such blobs were previously discarded.
4. Perspective warp to isolate each tile, split into halves
5. Otsu threshold → round-contour (area + circularity) pip detection, plus a circularity-gated merged-pip correction for fused blobs → pip count (see "Pip grid model" above). A lattice/occupancy counter (`countPipsGrid`) exists but is dormant.

**Memory management (OpenCV):** Every `cv.Mat` created must be explicitly `.delete()`d in a `finally` block. Missing deletions cause memory leaks that crash the page over time.

---

## Evaluation & Dev Tooling

None of this is part of the shipped app — it is tooling for verifying and iterating on the detection pipeline. The shipped pages remain 100% local OpenCV (see the locked decisions).

### `detect.js` full export surface (`window.DominoCV`)
- `loadCV()` — lazy-load OpenCV.js
- `preprocess(canvas)` — grayscale + contrast stretch (in place) — **LOCKED, runs first on every image**
- `scanCanvas(canvas)` → `[{left,right}, …]` — every tile (`scan.html`)
- `scanCanvasDebug(canvas)` → `[{left,right,dataUrl}, …]` — every tile plus a cropped thumbnail per tile (`quick.html`)
- `scanCanvasSingle(canvas)` → `{left,right}` — single largest tile, whole-frame fallback (`catalog.html`)
- `isReady()` → boolean — whether OpenCV.js has finished loading
- `_test` — headless hooks that operate on pixel arrays / Mats with no canvas or DOM: `{ stretchGray, findTiles, scanMat, scanMatSingle, halfDensity, getHalvesMats }`. Used by the Node eval/diagnostic scripts in `eval/`.

Internally the scan functions share the same primitives: `findTiles` (with `dividerSplit` to recover touching tiles) → `cropRotate` / `perspectiveWarp` → `splitRect` / `getHalvesMats` → `countPips` (currently the contour counter `countPipsContour`; `countPipsGrid` / `countPipsGridSample` are present but dormant — see "Pip grid model"). Keep this singular — do not duplicate detection logic into pages.

### `eval/` — pip-counting eval harness (Node, NOT shipped)
- Purpose: score the pip counter against ground truth so changes are *verified*, not guessed. See `eval/README.md`.
- **DEFAULT, FREE accuracy gate — `node grid_eval.cjs`:** feeds the committed `ref_*_tile*.jpg` crops straight into the shipped local OpenCV counter (`splitAndCount` → `countPips`) and scores left/right halves against `grid_truth.json`. **100% local — no API tokens, no network.** This is what you run to measure accuracy after a `detect.js` change. (Needs `npm install` once for `jpeg-js` + `@techstark/opencv-js`.)
- **DETECTION gate — `node detect_eval.cjs` (free, local):** `grid_eval` feeds pre-cropped single tiles to the counter and never exercises `findTiles`; this runs the real `preprocess` + `findTiles` on committed multi-tile photos (e.g. `detect_4tiles.jpg`, four tiles with two touching) and checks the detected tile count. Run it after any `findTiles` / `dividerSplit` change.
- **PAID — do NOT run without explicit approval:** `npm run eval` (`eval.mjs`) counts via the Claude API (Worker `/anthropic`, or `api.anthropic.com` if `ANTHROPIC_API_KEY` is set) and scores against `fixtures.json`. It costs money and only matters for evaluating a *vision-model* approach, which is not shipped. The shipped counter is local OpenCV — use `grid_eval.cjs` for it.
- `eval/photos/` and `eval/node_modules/` are git-ignored — keep personal test images out of the repo. The `ref_*.jpg` / `*_proper.jpg` / `crop_*.jpg` reference crops used by `grid_eval.cjs` ARE committed, so the free eval runs in a fresh clone.
- The many `eval/test_*.cjs` files are one-off diagnostic/scratch scripts (erosion, thresholding, grid sampling, margins, etc.), **not** a maintained test suite. `headless.cjs` wires `DominoCV._test` into Node.

### Browser dev pages
- `test.html` — visual preprocessing regression check (no counting).
- `model-test.html` — experimental Claude-counting sandbox via the `/anthropic` proxy.

Both call only `DominoCV.preprocess` from the shared module; neither changes what the shipped scanners do.

---

## Code Conventions

- **Language:** Vanilla JavaScript (ES6+), no TypeScript
- **No framework, no build step** — files are served as-is
- **Inline `<script>` blocks** in HTML for page-specific logic — shared logic lives in separate `.js` files: `config.js`, `detect.js` (detection pipeline), and `worker/src/index.js`
- **Compact style:** short variable names (`l`, `r`, `c`, `m`, `s`), ternaries, arrow functions — intentional for bundle size
- **No ESLint, Prettier, or TypeScript config** — style is enforced by reading existing code
- **No comments** unless the reason is non-obvious; do not add explanatory comments
- **OpenCV cleanup:** always `delete()` Mat objects in `finally` blocks

---

## Hooks & Validation

**Stop hook** (`.claude/hooks/js-check.sh`):
- Runs automatically when Claude Code stops (`Stop` event in `.claude/settings.json`)
- Checks all `.js` files changed since `origin/main` using `node --check`
- Checks inline `<script>` blocks in changed `.html` files using `new Function()`
- Returns a system message with errors if any are found, or a reminder to visually verify HTML files if syntax is OK
- **Fix any reported JS syntax errors before pushing**

---

## External Dependencies & Services

| Dependency | How used | Location |
|---|---|---|
| OpenCV.js 4.x | Tile detection + pip counting in quick.html / catalog.html / scan.html | CDN in HTML files |
| GitHub API v3 | Session + catalog persistence | Via Worker `/github/...` |
| Cloudflare Workers | Credential proxy + auto-deploy via GH Actions | `worker/` directory |

---

## Security Notes

- API keys live exclusively in Cloudflare Worker secrets — never in source files or browser
- The Worker enforces origin (`petr0n.github.io`) and path restrictions before forwarding any request
- GitHub token must have Contents write access to `petr0n/domino-counter-app`
- Game codes are 6-letter random strings — not cryptographic; treat sessions as loosely private, not secure
