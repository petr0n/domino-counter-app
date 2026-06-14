# Claude Code Rules for This Project

## One Goal

**Scan a phone camera image of domino tiles and return accurate pip counts every time. Every decision, change, and line of code must serve this goal. If a change doesn't make pip detection more accurate, more consistent, or more reliable, don't make it.**

---

## Detection Pipeline Gate

The following are LOCKED. Do not touch them unless the user explicitly says **"change the detection pipeline"**:

- The shared detection module `detect.js` — `preprocess()` (Canvas 2D grayscale + contrast stretch), `scanCanvas()`, `perspectiveWarp()`, `countPips()`, `loadCV()`
- The OpenCV.js CDN URL or version

If you think the pipeline needs improving, say so and wait for the user to approve before touching anything.

---

## PR Workflow

After pushing a branch, create a PR (ready for review, not draft) and **immediately merge it** — do not wait for user confirmation. Never block on PR merge.

---

## Do NOT Assume Anything

Always check facts against existing code, documentation, or the actual file before acting. Back up reasoning with evidence — cite the file and line, or the doc you read. Never state something about the code without verifying it first.

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
**Each half holds 0–12 pips, usually laid out in a compact grid (e.g. 3×3 = 9, 2×5 = 10, 3×4 = 12). Do not assume halves are ≤6.** Counting logic and prompts must handle the full 0–12 range per half.

### Tile Detection: OpenCV.js in one shared module
**OpenCV.js is the ONLY tile detection and pip counting engine. There is exactly ONE implementation — `detect.js` (`window.DominoCV`) — shared by every page that detects or preprocesses (`quick.html`, `scan.html`, `catalog.html`, `test.html`). Do not duplicate it back into the pages, and do not replace it with Claude AI or any other approach.**

`detect.js` exposes:
- `DominoCV.loadCV()` — lazy-load OpenCV.js
- `DominoCV.preprocess(canvas)` — grayscale + contrast stretch (in place)
- `DominoCV.scanCanvas(canvas)` → `[{left,right}, …]` — every tile in the frame (`quick.html`, `scan.html`)
- `DominoCV.scanCanvasSingle(canvas)` → `{left,right}` — the single largest tile, with whole-frame fallback (`catalog.html`)

Every page captures a frame, calls `DominoCV.preprocess`, then the appropriate scan function. `quick.html` and `catalog.html` additionally run their own real-time guidance loops (a UI concern, not detection). The two scan functions share the same internal `findTiles` / `perspectiveWarp` / `countPips` primitives — keep it that way.

Reasoning locked in: after preprocessing (grayscale + contrast stretch), pip dots are dark circles on a bright background — exactly what OpenCV contour/blob detection was built for. It is deterministic, free, and accurate on this input. Claude AI vision was tried in `scan.html` and produced inconsistent pip counts, so it was removed.

### Image Preprocessing: Canvas 2D — Grayscale + Contrast Stretch
**Before any detection, capture frames are converted to grayscale and histogram-stretched to full 0–255 range using the Canvas 2D API.**

Reasoning locked in: colored pips (yellow, blue, orange) have low contrast against white tiles in raw color. Grayscale + contrast stretch makes all pips uniformly dark and maximally distinct, regardless of original pip color. This preprocessing runs client-side with no dependencies.

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
├── CLAUDE.md                 # This file
├── catalog.json              # Tile database: all 56 tiles in a double-12 set
├── config.js                 # Sets window.PROXY_URL to the deployed Worker URL
├── detect.js                 # Shared OpenCV detection module (window.DominoCV)
├── index.html                # Landing page (New Game / Join Game / Catalog)
├── scan.html                 # Multiplayer tile scanner
├── quick.html                # Single-player quick scan (no backend required)
└── catalog.html              # Tile catalog builder UI
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
- Canvas 2D preprocessing (grayscale + contrast stretch) → OpenCV.js pipeline running locally
- No backend calls; state is in-memory only (not persisted between page reloads)
- Real-time guidance: checks image brightness and sharpness at 2 fps
- History list of scanned tiles with running pip totals

### `catalog.html` — Tile Catalog Builder
- Scans individual tiles via `DominoCV.scanCanvasSingle` and records them into `catalog.json` via GitHub API
- Includes manual verification UI to correct CV misdetections
- Same OpenCV guidance loop as quick.html

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
3. `minAreaRect` per blob, filtered by area, aspect ratio, and fill ratio → tile rectangles (tolerant of rounded corners and rotation)
4. Perspective warp to isolate each tile, split into halves
5. Adaptive threshold → contour filtering by area and circularity → pip count

**Memory management (OpenCV):** Every `cv.Mat` created must be explicitly `.delete()`d in a `finally` block. Missing deletions cause memory leaks that crash the page over time.

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
