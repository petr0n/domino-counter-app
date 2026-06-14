# Claude Code Rules for This Project

## Do NOT Assume Anything

Always check facts against existing code, documentation, or the actual file before acting. Back up reasoning with evidence — cite the file and line, or the doc you read. Never state something about the code without verifying it first.

---

## Project Overview

**Domino Counter App** is a static web application for scanning and counting domino tiles using computer vision (OpenCV.js) and AI (Claude API). It supports single-player quick-scan mode and multiplayer sessions where game state is persisted to GitHub.

There is no build system, no npm packages in the root, and no framework — only vanilla JavaScript embedded in HTML files, with a separate Cloudflare Worker backend.

---

## Repository Structure

```
domino-counter-app/
├── .claude/
│   ├── hooks/
│   │   └── js-check.sh       # Stop hook: syntax-checks changed JS/HTML files
│   └── settings.json         # Harness config (Stop hook registration)
├── worker/
│   ├── src/
│   │   └── index.js          # Cloudflare Worker credential proxy
│   ├── wrangler.toml         # Worker config (name: domino-counter-proxy)
│   └── README.md             # Worker deployment & secret rotation guide
├── sessions/
│   └── .gitkeep              # Placeholder — sessions live in GitHub, not here
├── CLAUDE.md                 # This file
├── catalog.json              # Tile database: all 56 tiles in a double-12 set
├── config.js                 # Sets window.PROXY_URL to the deployed Worker URL
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
- Creates or joins a game using a 6-letter random code
- Uses Claude AI (via the Worker proxy) to identify tiles from camera images
- Reads/writes game session JSON files to GitHub via the Worker
- Displays a live scoreboard of all players' tiles

### `quick.html` — Single-Player Quick Scan
- Full OpenCV.js computer vision pipeline running locally in the browser
- No backend calls; state is in-memory only (not persisted between page reloads)
- Real-time guidance: checks image brightness and sharpness at 2 fps
- History list of scanned tiles with running pip totals

### `catalog.html` — Tile Catalog Builder
- Scans individual tiles and records them into `catalog.json` via GitHub API
- Includes manual verification UI to correct CV misdetections
- Same OpenCV guidance loop as quick.html

### `config.js`
Sets `window.PROXY_URL = "https://domino-counter-proxy.petron.workers.dev"`. This must be configured before any page that calls the Worker. **Do not hard-code this URL elsewhere.**

---

## Backend: Cloudflare Worker (`worker/src/index.js`)

Acts as a credential proxy. The browser never sees API keys.

**Routes:**
- `POST /anthropic` → forwards to Anthropic API with `ANTHROPIC_API_KEY` header injected
  - Model used: `claude-opus-4-8` (vision)
- `GET|PUT /github/repos/...` → forwards to GitHub API with `GITHUB_TOKEN` header injected
  - Path restricted to `repos/petr0n/japan-2026/contents/domino-counter/` prefix only
  - Allowed sub-paths: `sessions/` and `catalog.json`

**CORS:** Only `https://petr0n.github.io` is allowed as the origin.

**Secrets (never in repo):**
```
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GITHUB_TOKEN
```

**Deploy:**
```
cd worker && npx wrangler deploy
```

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
Array of 56 tile objects covering all unique combinations in a double-12 set (0-0 through 12-12). Stored locally and mirrored to GitHub at `domino-counter/catalog.json`.

### Game sessions
Stored as JSON files on GitHub at `domino-counter/sessions/{code}.json`. The `sessions/` folder in this repo is a placeholder; do not put real session files there.

---

## Computer Vision Pipeline (OpenCV.js)

Loaded from CDN: `https://docs.opencv.org/4.x/opencv.js`

**Tile detection steps:**
1. Grayscale conversion
2. CLAHE contrast enhancement
3. Gaussian blur
4. Canny edge detection
5. Contour detection → find rectangular contours
6. Perspective warp to isolate tile

**Pip counting steps:**
1. Adaptive threshold (catches dark pips)
2. Convert to HSV color space (`COLOR_RGBA2BGR` then `COLOR_BGR2HSV`) — catches colored pips via saturation channel
3. Morphological close to fill gaps
4. Contour filtering by area and circularity

**Real-time guidance (2 fps):**
- Brightness check via mean pixel intensity
- Sharpness check via Laplacian variance

**Memory management:** Every `cv.Mat` created must be explicitly `.delete()`d in a `finally` block. Missing deletions cause memory leaks that will crash the page over time.

---

## Code Conventions

- **Language:** Vanilla JavaScript (ES6+), no TypeScript
- **No framework, no build step** — files are served as-is
- **Inline `<script>` blocks** in HTML — no separate `.js` source files except `config.js` and `worker/src/index.js`
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

## Development Workflow

1. **Edit** HTML/JS files directly — no compilation needed
2. **Test** by opening files in a browser (camera access requires HTTPS or localhost)
3. **Verify** the Stop hook passes with no syntax errors
4. **Worker changes:** `cd worker && npx wrangler deploy` (requires Wrangler CLI and Cloudflare login)
5. **Push** to the remote branch; create a PR if one doesn't exist

For local testing of pages that call the Worker, the `PROXY_URL` in `config.js` must point to the deployed Worker (not localhost), unless you also run the Worker locally with `wrangler dev`.

---

## External Dependencies & Services

| Dependency | How used | Location |
|---|---|---|
| OpenCV.js 4.x | Computer vision in browser | CDN in HTML files |
| Anthropic Claude API | Tile image recognition | Via Worker `/anthropic` |
| GitHub API v3 | Session + catalog persistence | Via Worker `/github/...` |
| Cloudflare Workers | Credential proxy | `worker/` directory |

---

## Security Notes

- API keys live exclusively in Cloudflare Worker secrets — never in source files or browser
- The Worker enforces origin (`petr0n.github.io`) and path restrictions before forwarding any request
- GitHub token is scoped to `petr0n/japan-2026` Contents only
- Game codes are 6-letter random strings — not cryptographic; treat sessions as loosely private, not secure
