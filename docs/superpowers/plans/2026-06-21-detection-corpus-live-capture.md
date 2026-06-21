# Detection Corpus via Live Phone Capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tile-detection test corpus from live phone-camera scans (watched live on desktop), scored by `detect_eval`, while keeping all capture tooling out of the shipped app.

**Architecture:** A single dev server (extended `log-server.cjs`) serves the app, injects a dev-only capture hook into `quick.html` at serve time, and saves each scan's full frame; it's exposed to the phone over an HTTPS cloudflared tunnel (camera needs a secure context). The shipped app keeps only one guarded no-op hook. `detect_eval` is refactored to derive truth from fixture filenames so new photos need no code edits.

**Tech Stack:** Vanilla JS, Node `http`/`fs` (no framework), OpenCV.js (untouched), cloudflared quick-tunnel, `sips` (macOS, downscaling).

## Global Constraints

- **Locked pipeline:** no behavior change to `preprocess`, `findTiles`, `dividerSplit`, `dividerScan`, `pipClusterScan`, `perspectiveWarp`, `countPips`. Tooling only observes.
- **Dev/app isolation:** all capture/logging logic lives in dev-only `eval/` files injected at serve time; shipped app retains at most one guarded no-op hook. Removes today's hardcoded `localhost:8766` POST from `quick.js`.
- **Detection-only this round.** No pip-counting work. Deliverable is corpus + root-cause report; no fix to locked code.
- **Free & local:** no paid APIs. Score with `node eval/detect_eval.cjs`. Tunnel is the free cloudflared quick-tunnel (already installed at `/opt/homebrew/bin/cloudflared`).
- **Repo hygiene:** raw frames stage in gitignored `eval/photos/`; per-tile crops in gitignored `eval/crop_*.jpg`; only downscaled (~1000px max dim) promoted fixtures `eval/detect_*.jpg` are committed.
- **No-regression:** `node eval/detect_eval.cjs` (currently 6/6) and `node eval/grid_eval.cjs` (29/29) must stay green.

---

### Task 1: Refactor `detect_eval` to parse truth from filenames

**Files:**
- Modify: `eval/detect_eval.cjs:11-19` (the inline `TRUTH` map) and the loop at `:29`
- Rename: the 6 `eval/detect_*.jpg` fixtures to the `_<N>` convention (via `git mv`)

**Interfaces:**
- Produces: a `detect_*.jpg` naming convention where the **trailing `_<digits>` before `.jpg` is the expected tile count**. Later tasks add fixtures by copying files into `eval/` with this naming — no code edit needed.

- [ ] **Step 1: Rename the 6 fixtures to the trailing-count convention**

```bash
cd /Users/peterabeln/Documents/github/petr0n/domino-counter-app
git mv eval/detect_4tiles.jpg eval/detect_4tiles_4.jpg
git mv eval/detect_towel3.jpg  eval/detect_towel_3.jpg
git mv eval/detect_glare3.jpg  eval/detect_glare_3.jpg
git mv eval/detect_grass3.jpg  eval/detect_grass_3.jpg
git mv eval/detect_stack4.jpg  eval/detect_stack_4.jpg
git mv eval/detect_cloth4.jpg  eval/detect_cloth_4.jpg
```

- [ ] **Step 2: Run the eval to verify it now FAILS (stale hardcoded map)**

Run: `cd eval && node detect_eval.cjs 2>&1 | tail -8`
Expected: FAIL — it tries to read the old names (e.g. `detect_4tiles.jpg`) which no longer exist (ENOENT), or reports 0/6.

- [ ] **Step 3: Replace the inline map with a glob + parse**

In `eval/detect_eval.cjs`, replace the `TRUTH` object (lines 11-19) with:

```js
// committed multi-tile fixtures: detect_<desc>_<N>.jpg where N = expected tile count
const TRUTH = {};
for (const f of fs.readdirSync(__dirname).sort()) {
  const m = f.match(/^detect_.*_(\d+)\.jpg$/);
  if (m) TRUTH[f] = parseInt(m[1], 10);
}
```

(`fs` and `path` are already required at the top of the file. No other change to the run loop, which already iterates `Object.entries(TRUTH)`.)

- [ ] **Step 4: Run the eval to verify 6/6 PASS**

Run: `cd eval && node detect_eval.cjs 2>&1 | tail -8`
Expected: 6 lines `✓ detect_*_N.jpg found N exp N`, then `DETECTION: 6/6 photos correct`.

- [ ] **Step 5: Confirm grid_eval still green (untouched sanity)**

Run: `cd eval && node grid_eval.cjs 2>&1 | tail -2`
Expected: `HALVES: 58/58   TILES: 29/29`.

- [ ] **Step 6: Commit**

```bash
git add eval/detect_eval.cjs eval/detect_*.jpg
git commit -m "eval: derive detect_eval truth from filename (glob + trailing _N)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Unified dev server — static serving, hook injection, full-frame save

**Files:**
- Create: `eval/dev-capture.js` (the injected dev hook)
- Modify: `log-server.cjs` (repo root — full rewrite below)
- Create: `eval/test_capture_server.cjs` (integration test)

**Interfaces:**
- Consumes: the shipped app calls `window.__domCapture({ file, frame, tiles })` (added in Task 3).
- Produces:
  - `window.__domCapture(payload)` — defined by `eval/dev-capture.js`; POSTs `{ file, tileCount, frame, tiles:[{left,right,dataUrl}] }` to relative `/log`.
  - Dev server on port **8766**: `GET` serves repo-root static files; `GET /quick.html` is served with `<script src="/eval/dev-capture.js"></script>` injected before `</body>`; `POST /log` saves `eval/photos/frame_<ts>_d<detected>.jpg` (when `frame` present) + per-tile `eval/crop_*.jpg` + appends `eval/scan-log.json`.

- [ ] **Step 1: Write the integration test**

Create `eval/test_capture_server.cjs`:

```js
// Integration test for the unified dev server (../log-server.cjs).
// Spawns it and checks static serving, quick.html injection, and frame saving.
// Run: node eval/test_capture_server.cjs
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PHOTOS = path.join(ROOT, 'eval', 'photos');
const PORT = 8766;
let fails = 0;
const check = (n, c) => { console.log((c ? '✓ ' : '✗ ') + n); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method,
      headers: body ? { 'Content-Type': 'application/json' } : {} }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  fs.mkdirSync(PHOTOS, { recursive: true });
  const srv = spawn('node', [path.join(ROOT, 'log-server.cjs')], { stdio: 'ignore' });
  await sleep(900);
  try {
    const js = await req('GET', '/detect.js');
    check('serves detect.js (200 + DominoCV)', js.status === 200 && /DominoCV/.test(js.body));

    const qh = await req('GET', '/quick.html');
    check('injects dev-capture into quick.html', qh.status === 200 && qh.body.includes('/eval/dev-capture.js'));

    const dc = await req('GET', '/eval/dev-capture.js');
    check('serves dev-capture.js (200 + __domCapture)', dc.status === 200 && /__domCapture/.test(dc.body));

    const frame = 'data:image/jpeg;base64,' + Buffer.from('fake-frame-bytes').toString('base64');
    const before = fs.readdirSync(PHOTOS).length;
    const lr = await req('POST', '/log', JSON.stringify({ file: 'test', tileCount: 2, frame, tiles: [{left:1,right:2},{left:3,right:4}] }));
    const after = fs.readdirSync(PHOTOS).length;
    check('POST /log ok (200)', lr.status === 200);
    check('saves a frame to eval/photos/', after === before + 1);
  } catch (e) {
    check('test ran without error: ' + e.message, false);
  } finally {
    srv.kill();
  }
  console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
```

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `node eval/test_capture_server.cjs 2>&1 | tail -8`
Expected: FAIL — the current `log-server.cjs` 404s on `GET /detect.js` and `/quick.html` and has no `dev-capture.js`, so the static/inject checks fail.

- [ ] **Step 3: Create `eval/dev-capture.js`**

```js
// Dev-only capture hook for quick.html. Injected at serve time by log-server.cjs.
// Never referenced by committed HTML; absent in production => window.__domCapture undefined => app no-op.
(function () {
  window.__domCapture = function (payload) {
    var tiles = (payload.tiles || []).map(function (t) {
      return { left: t.left, right: t.right, dataUrl: t.dataUrl || null };
    });
    fetch("/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file: payload.file || null,
        tileCount: tiles.length,
        frame: payload.frame || null,
        tiles: tiles
      })
    }).catch(function () {});
  };
})();
```

- [ ] **Step 4: Rewrite `log-server.cjs` (repo root) to serve static + inject + save frame**

```js
// Local dev tool — unified static server + scan logger for quick.html live capture.
// Serves the app, injects eval/dev-capture.js into quick.html, and on POST /log
// saves the full frame + per-tile crops to eval/ and appends eval/scan-log.json.
// Run: node log-server.cjs   (expose: cloudflared tunnel --url http://localhost:8766)
// NOT shipped — dev only.
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT   = __dirname;                       // repo root (log-server.cjs lives here)
const EVAL   = path.join(ROOT, 'eval');
const PHOTOS = path.join(EVAL, 'photos');
const LOG    = path.join(EVAL, 'scan-log.json');
const PORT   = 8766;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.png':'image/png', '.ico':'image/x-icon', '.svg':'image/svg+xml' };

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const fp = path.join(ROOT, path.normalize(rel));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); res.end('Not Found'); return;
  }
  let body = fs.readFileSync(fp);
  if (rel === '/quick.html') {
    body = Buffer.from(body.toString('utf8').replace(
      '</body>', '<script src="/eval/dev-capture.js"></script>\n</body>'));
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
  res.end(body);
}

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const slug = (parsed.file||'camera').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
        const ts   = Date.now();
        const n    = (parsed.tiles||[]).length;
        if (!fs.existsSync(PHOTOS)) fs.mkdirSync(PHOTOS, { recursive: true });
        if (parsed.frame) {
          const fb = parsed.frame.replace(/^data:image\/\w+;base64,/, '');
          fs.writeFileSync(path.join(PHOTOS, `frame_${ts}_d${n}.jpg`), Buffer.from(fb, 'base64'));
        }
        (parsed.tiles||[]).forEach((t, i) => {
          if (!t.dataUrl) return;
          const b64 = t.dataUrl.replace(/^data:image\/\w+;base64,/, '');
          fs.writeFileSync(path.join(EVAL, `crop_${slug}_t${i}_${t.left}-${t.right}.jpg`), Buffer.from(b64, 'base64'));
        });
        const entry = { ts: new Date().toISOString(), file: parsed.file||null, tileCount: parsed.tileCount,
          tiles: (parsed.tiles||[]).map(({dataUrl,...t})=>t) };
        const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : [];
        log.push(entry);
        fs.writeFileSync(LOG, JSON.stringify(log, null, 2));
        console.log('[log]', entry.ts, entry.file||'(camera)', entry.tileCount, 'tile(s):',
          (entry.tiles||[]).map(t=>t.left+'|'+t.right).join('  '));
        res.writeHead(200); res.end('ok');
      } catch(e) { res.writeHead(400); res.end(e.message); }
    });
    return;
  }

  if (req.method === 'GET') { serveStatic(req, res); return; }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log(`Dev server + log on :${PORT}  (static + /log → eval/)`));
```

- [ ] **Step 5: Run the test to verify it PASSES**

Run: `node eval/test_capture_server.cjs 2>&1 | tail -8`
Expected: 5 `✓` lines, then `ALL PASS`.

- [ ] **Step 6: Commit**

```bash
git add log-server.cjs eval/dev-capture.js eval/test_capture_server.cjs
git commit -m "dev: unified capture server (static serve + hook inject + full-frame save)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Shipped-app seam — guarded hook + raw-frame capture in `quick.js`

**Files:**
- Modify: `quick.js:154-187` (the `doScan` function)

**Interfaces:**
- Consumes: `window.__domCapture({ file, frame, tiles })` (Task 2). Undefined in production → no-op.
- Produces: nothing for later tasks.

- [ ] **Step 1: Capture the raw guide-cropped frame before preprocess, and replace the hardcoded POST with a guarded hook**

In `quick.js`, inside `doScan`, after the `cropToGuide` IIFE and **before** `DominoCV.preprocess(canvas);`, add the raw-frame capture (only computed in dev):

```js
  })();
  const rawCropUrl = window.__domCapture ? canvas.toDataURL("image/jpeg", 0.92) : null;
  DominoCV.preprocess(canvas);
```

Then replace the existing logging block:

```js
    const found = DominoCV.scanCanvasDebug(canvas);
    fetch("http://localhost:8766/log", { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ file: filename||null, tileCount: (found||[]).length, tiles: (found||[]).map(t=>({left:t.left,right:t.right,dataUrl:t.dataUrl||null})) })
    }).catch(()=>{});
```

with:

```js
    const found = DominoCV.scanCanvasDebug(canvas);
    if (window.__domCapture) window.__domCapture({ file: filename||null, frame: rawCropUrl, tiles: found||[] });
```

- [ ] **Step 2: Syntax-check the changed file**

Run: `node --check quick.js && echo OK`
Expected: `OK`.

- [ ] **Step 3: Verify dev/app isolation structurally**

Run:
```bash
grep -n "localhost:8766" quick.js || echo "no hardcoded host ✓"
grep -n "dev-capture" quick.html || echo "no dev ref in committed quick.html ✓"
grep -n "__domCapture" quick.js && echo "guarded hook present ✓"
```
Expected: `no hardcoded host ✓`, `no dev ref in committed quick.html ✓`, and a line showing the `window.__domCapture` guard plus `guarded hook present ✓`.

- [ ] **Step 4: Verify the integration path still works end-to-end (server injects, hook fires)**

Run: `node eval/test_capture_server.cjs 2>&1 | tail -3`
Expected: `ALL PASS` (server-side unchanged; confirms no regression).

- [ ] **Step 5: Commit**

```bash
git add quick.js
git commit -m "quick: dev-only guarded capture hook; remove hardcoded log POST

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Session launcher (server + HTTPS tunnel)

**Files:**
- Create: `eval/capture.sh`

**Interfaces:**
- Produces: `bash eval/capture.sh` — boots the dev server on :8766 and prints a `https://*.trycloudflare.com` URL to open on the phone.

- [ ] **Step 1: Create `eval/capture.sh`**

```bash
#!/usr/bin/env bash
# Live detection-capture session: unified dev server + cloudflared HTTPS tunnel.
# Usage: bash eval/capture.sh   (Ctrl-C to stop)
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Free the port if a previous server/static server is holding it.
lsof -nP -tiTCP:8766 -sTCP:LISTEN 2>/dev/null | xargs -r kill 2>/dev/null || true

node "$DIR/log-server.cjs" &
SRV=$!
trap "kill $SRV 2>/dev/null" EXIT
sleep 1
echo "Local:  http://localhost:8766/quick.html"
echo "Opening HTTPS tunnel (open the trycloudflare URL on your phone)…"
cloudflared tunnel --url http://localhost:8766
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x eval/capture.sh && echo OK`
Expected: `OK`.

- [ ] **Step 3: Verify it boots and prints a tunnel URL**

Run: `timeout 20 bash eval/capture.sh 2>&1 | grep -m1 trycloudflare.com || echo "no URL — check network/cloudflared"`
Expected: a line containing `https://<random>.trycloudflare.com`. (The `timeout` ends the probe; the real session runs it without `timeout`.)

- [ ] **Step 4: Commit**

```bash
git add eval/capture.sh
git commit -m "dev: capture.sh launcher (dev server + cloudflared tunnel)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Live capture session, fixture promotion, and failure report (deliverable)

**Files:**
- Create (committed): `eval/detect_<desc>_<truth>.jpg` for each promoted scene
- Create: `docs/superpowers/reports/2026-06-21-detection-failures.md` (root-cause report)

**Interfaces:**
- Consumes: launcher (Task 4), dev server (Task 2), seam (Task 3), filename-truth convention (Task 1).
- Produces: committed detection fixtures + a failure report. No locked-code changes.

This task is operated interactively (the human scans; the implementer monitors). It is not a unit-test cycle; its definition of done is at the end.

- [ ] **Step 1: Stop the standalone dev servers (avoid port conflicts)**

Run:
```bash
lsof -nP -tiTCP:8765 -sTCP:LISTEN 2>/dev/null | xargs -r kill 2>/dev/null || true
lsof -nP -tiTCP:8766 -sTCP:LISTEN 2>/dev/null | xargs -r kill 2>/dev/null || true
echo "ports clear"
```
Expected: `ports clear`.

- [ ] **Step 2: Start the capture session and capture the tunnel URL**

Start the dev server (background) and cloudflared (background), then read the printed `https://*.trycloudflare.com` URL and give it to the human to open `…/quick.html` on the phone. (Run `log-server.cjs` and `cloudflared tunnel --url http://localhost:8766` as background processes so the tunnel URL can be read from cloudflared's output.)

Expected: human confirms `quick.html` loads on the phone and the camera prompt appears (HTTPS secure context satisfied).

- [ ] **Step 3: Run the capture loop, monitoring detected-vs-truth live**

Watch the dev server stdout (`[log] … tileCount …`). For each scene the human states the true tile count + arrangement; record `truth`, `detected`, and the saved `eval/photos/frame_<ts>_d<detected>.jpg`. Flag every `detected != truth` immediately.

Coverage targets (the approved axes — dense + arrangements):
- Dense counts: scenes of ~10, ~15, ~20 tiles.
- Arrangements: touching edge-to-edge, stacked, angled/rotated, random scatter.
Aim for ~12–18 scenes total, ensuring at least 2 scenes per arrangement type and the three dense counts.

Expected: a recorded table of (scene, arrangement, truth, detected, frame path), with mismatches marked.

- [ ] **Step 4: Promote selected frames to committed fixtures (downscaled)**

For every mismatch scene plus a representative passing scene per arrangement, downscale and commit:

```bash
# <ts>, <det>, <desc>, <truth> from the recorded table
sips -Z 1000 eval/photos/frame_<ts>_d<det>.jpg --out eval/detect_<desc>_<truth>.jpg
```
Naming `detect_<desc>_<truth>.jpg` (truth is the trailing number, parsed by Task 1's harness). `<desc>` is lowercase words/underscores, e.g. `detect_dense_touching_15.jpg`.

Expected: new `eval/detect_*.jpg` files at ≤1000px max dimension.

- [ ] **Step 5: Score the new corpus**

Run: `cd eval && node detect_eval.cjs 2>&1 | tail -30`
Expected: all fixtures listed (6 originals + new), each `✓`/`✗` with parsed truth. Confirm each live failure reproduces here (same `detected` count) — this proves the fixture captured the failure.

- [ ] **Step 6: Root-cause each failure (no code changes)**

For each `✗`, determine why `findTiles` returned the wrong count (e.g. erosion merged N touching tiles into one blob; `dividerSplit` found the wrong divider count; bright-bg fusion). Use read-only inspection and existing `eval/` diagnostic scripts; do **not** modify locked code. Record the root cause per failure.

- [ ] **Step 7: Write the report**

Create `docs/superpowers/reports/2026-06-21-detection-failures.md` with: a table of all scenes (arrangement, truth, detected, pass/fail), and for each failure a root-cause paragraph + a recommendation (worth a future pipeline change, or a capture/usage limitation). End with a short summary of which detection weaknesses the new corpus exposed.

- [ ] **Step 8: Verify no regression and commit**

Run:
```bash
cd eval && node detect_eval.cjs 2>&1 | tail -2 && node grid_eval.cjs 2>&1 | tail -2
```
Expected: the 6 original fixtures still `✓` (any `✗` are only new scenes); `grid_eval` still `29/29`.

```bash
git add eval/detect_*.jpg docs/superpowers/reports/2026-06-21-detection-failures.md
git commit -m "eval: add live-captured detection corpus + failure report

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

**Definition of done:** ≥12 scenes captured covering the three dense counts and all four arrangements; every failure reproduced in `detect_eval` and root-caused; report committed; original 6 fixtures still pass; locked code untouched.

---

## Self-Review

**Spec coverage:**
- §3.1 unified server (static + inject + frame save) → Task 2 ✓
- §3.2 `dev-capture.js` → Task 2 ✓
- §3.3 `quick.js` seam + raw-frame-before-preprocess + remove hardcoded POST → Task 3 ✓
- §3.4 `detect_eval` glob/parse + rename 6 fixtures → Task 1 ✓
- §4 data flow → Tasks 2+3 ✓
- §5 live session workflow → Task 5 (Steps 1–3) ✓
- §6 promotion + reporting → Task 5 (Steps 4–7) ✓
- §7 verification (detect_eval green, grid_eval green, production no-op) → Task 1 Step 5, Task 3 Step 3, Task 5 Step 8 ✓
- §8 deps (cloudflared present) → Global Constraints + Task 4 ✓
- §9 risks (downscale, tunnel) → Task 5 Step 4, Global Constraints ✓

**Placeholder scan:** no TBD/TODO; every code step shows full code; commands have expected output. ✓

**Type/name consistency:** `window.__domCapture({ file, frame, tiles })` — defined in `eval/dev-capture.js` (Task 2), called identically in `quick.js` (Task 3). Payload `{ file, tileCount, frame, tiles:[{left,right,dataUrl}] }` consumed by `log-server.cjs` `POST /log` (Task 2). Fixture naming `detect_<desc>_<N>.jpg` parsed by regex `^detect_.*_(\d+)\.jpg$` (Task 1), produced by Task 5 Step 4. Port `8766` consistent across server, test, launcher. ✓
