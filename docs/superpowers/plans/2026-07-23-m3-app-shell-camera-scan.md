# M3 Sub-project 1: App Shell + Camera Capture + Raw Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Vite app where tapping a capture button on a real phone
runs the actual scanner pipeline and shows raw per-tile pip results — the
first slice of M3, proving camera → `scanner/` → results works end-to-end
before building review/correction UX on top of it.

**Architecture:** A new `app/` directory (Vite + vanilla JS, no framework)
imports the existing, unmodified `scanner/` module. `onnxruntime-web` loads
via the same CDN `<script>` tag pattern already phone-tested in M2's
`harness.html` (not npm-bundled — that's deferred to the future PWA/offline
sub-project, which will need to reconsider WASM asset bundling for
precaching anyway). Camera capture and file-upload fallback both produce a
plain `ImageData`, which flows through one shared "scan and render" path.

**Tech Stack:** Vite (vanilla-js template), `@vitejs/plugin-basic-ssl` (dev
HTTPS for phone testing), `onnxruntime-web@1.19.2` via CDN (matches the
version already used and tested in `harness.html`), Node's built-in
`assert` for pure-logic unit tests (no test framework added — matches the
`scanner/` module's own testing approach).

## Global Constraints

- `scanner/` (repo root) is consumed, not modified. Its public API:
  `init({tileModelUrl, pipModelUrl}) -> Promise<void>` and
  `scanImage(imageData, canvasFactory) -> Promise<Array<{bbox, corners, predicted: {first, second, confidence, firstConfidence, secondConfidence}}>>`,
  where `imageData` is `{data: Uint8ClampedArray, width, height}` and
  `canvasFactory` is `(w, h) => {canvas, ctx}`.
- Camera access requires a secure context. `localhost` is exempt but
  phone-over-LAN testing is not — the Vite dev server must run with
  `@vitejs/plugin-basic-ssl` and `host: true`.
- Camera-denied/unavailable must fall back to file upload, not a broken
  screen (build-plan-v2.md §9.0 hard constraint).
- Multi-tile scans take multiple seconds (M2's accepted perf finding:
  ~90-105ms per tile for pip counting, on top of the detection pass) — any
  scan-in-progress UI must show a visible indicator, never look frozen or
  instant.
- Out of scope: review/correction UX, local history, PWA/offline caching.
  Do not build any of these — a future sub-project each.

---

### Task 1: Vite app scaffold + model assets

**Files:**
- Create: `app/package.json`, `app/vite.config.js`, `app/index.html`, `app/src/main.js`, `app/public/models/tile.onnx`, `app/public/models/pip.onnx`

**Interfaces:**
- Produces: a Vite dev server reachable over HTTPS from the phone, serving a
  blank page that later tasks build on.

- [ ] **Step 1: Scaffold the Vite project**

Run:
```bash
cd /Users/peterabeln/Documents/github/petr0n/domino-counter-app
npm create vite@latest app -- --template vanilla
```
Expected: creates `app/` with `package.json`, `index.html`, `src/main.js`,
`src/counter.js`, `src/style.css`, `src/javascript.svg`, `public/vite.svg`.

- [ ] **Step 2: Remove the template's placeholder content**

```bash
rm app/src/counter.js app/src/javascript.svg app/public/vite.svg
```

- [ ] **Step 3: Install dependencies and the HTTPS plugin**

```bash
cd app
npm install
npm install --save-dev @vitejs/plugin-basic-ssl
```
Expected: `npm install` completes with no errors; `node_modules/` and
`package-lock.json` created.

- [ ] **Step 4: Configure Vite for HTTPS + LAN access**

```javascript
// app/vite.config.js
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [basicSsl({ name: 'domino-scanner-dev', ttlDays: 30 })],
  server: {
    https: true,
    host: true, // listen on 0.0.0.0 so the phone can reach it over LAN
  },
});
```

- [ ] **Step 5: Copy the production ONNX models into public assets**

```bash
cd /Users/peterabeln/Documents/github/petr0n/domino-counter-app
mkdir -p app/public/models
cp runs/pose/touch/weights/best_int8.onnx app/public/models/tile.onnx
cp runs/detect/pipdet_hn/weights/best_int8.onnx app/public/models/pip.onnx
```
Expected: both files present at `app/public/models/`.

Run: `ls -la app/public/models/`
Expected: `tile.onnx` (~3.1MB), `pip.onnx` (~2.8MB).

- [ ] **Step 6: Write a minimal index.html with the onnxruntime-web CDN script**

```html
<!-- app/index.html -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>Domino Scanner</title>
  <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js"></script>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

- [ ] **Step 7: Write a placeholder main.js and verify the dev server runs**

```javascript
// app/src/main.js
document.querySelector('#app').innerHTML = '<h1>Domino Scanner (M3 sub-project 1)</h1>';
```

Run: `cd app && npm run dev -- --host`
Expected output includes:
```
  ➜  Local:   https://localhost:5173/
  ➜  Network: https://<your-LAN-IP>:5173/
```
Open the `Local` URL in a desktop browser (click through the self-signed
cert warning) — expect to see "Domino Scanner (M3 sub-project 1)". Stop the
server (Ctrl+C) before continuing.

- [ ] **Step 8: Commit**

```bash
cd /Users/peterabeln/Documents/github/petr0n/domino-counter-app
git add app/package.json app/package-lock.json app/vite.config.js app/index.html app/src/main.js app/.gitignore
git commit -m "M3 sub-project 1 Task 1: scaffold Vite app + HTTPS dev server + model assets"
```
(`app/public/models/*.onnx` and `app/node_modules/` are large/generated —
verify `app/.gitignore` from the Vite template already excludes
`node_modules`; add `public/models/` to `app/.gitignore` too, since these
are copies of gitignored `runs/` artifacts, not source: append
`public/models/` as a new line in `app/.gitignore` before running `git add`
above.)

---

### Task 2: Camera capture with corner-bracket overlay

**Files:**
- Create: `app/src/camera.js`, `app/src/camera.test.js`, `app/src/style.css`

**Interfaces:**
- Produces: `startCamera(videoEl) -> Promise<MediaStream | null>` (returns
  `null` if permission denied/unavailable, never throws — caller checks for
  `null` to decide whether to show the upload fallback),
  `captureFrame(videoEl, canvasFactory) -> {data, width, height}` (an
  `ImageData`-shaped plain object, matching what `scanner.scanImage()`
  expects), `computeCaptureButtonRect(viewportW, viewportH) -> {x, y, w, h}`
  (pure, testable — the capture button's position, factored out so it's
  unit-testable without a real DOM).
- Consumed by: Task 6 (`main.js`)

- [ ] **Step 1: Write the failing test for the one pure-logic piece**

Camera access and frame capture both need a real browser (`getUserMedia`,
`<video>`, `<canvas>`) and can't be meaningfully unit-tested in Node — they
get verified manually on a real phone in Task 6. The one pure function here
(button positioning) can be tested directly:

```javascript
// app/src/camera.test.js
import assert from 'node:assert';
import { computeCaptureButtonRect } from './camera.js';

// Button should be horizontally centered, near the bottom, with a fixed
// size regardless of viewport (matches the approved mockup: a 56px circle
// ~14px from the bottom edge).
{
  const rect = computeCaptureButtonRect(390, 844); // iPhone-ish viewport
  assert.strictEqual(rect.w, 56);
  assert.strictEqual(rect.h, 56);
  assert.strictEqual(rect.x, (390 - 56) / 2);
  assert.strictEqual(rect.y, 844 - 14 - 56);
  console.log('computeCaptureButtonRect: PASS');
}
{
  const rect = computeCaptureButtonRect(800, 400); // wider viewport
  assert.strictEqual(rect.x, (800 - 56) / 2);
  assert.strictEqual(rect.y, 400 - 14 - 56);
  console.log('computeCaptureButtonRect (wide): PASS');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node app/src/camera.test.js`
Expected: `Error [ERR_MODULE_NOT_FOUND]` — `camera.js` doesn't exist yet.

- [ ] **Step 3: Write camera.js**

```javascript
// app/src/camera.js
// Live camera capture: getUserMedia preview + frame-to-ImageData capture.
// startCamera never throws -- permission denial / no camera is a normal,
// expected outcome the caller handles by falling back to file upload
// (build-plan-v2.md §9.0 hard constraint), not an error state.

export async function startCamera(videoEl) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    videoEl.srcObject = stream;
    await videoEl.play();
    return stream;
  } catch {
    return null; // permission denied, no camera, etc. -- all handled the same way
  }
}

export function stopCamera(stream) {
  if (stream) stream.getTracks().forEach(track => track.stop());
}

// videoEl: a playing <video> showing the camera stream. Returns an
// ImageData-shaped object ({data, width, height}) matching what
// scanner.scanImage() expects, captured at the video's native resolution.
export function captureFrame(videoEl, canvasFactory) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  const { ctx } = canvasFactory(w, h);
  ctx.drawImage(videoEl, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// Pure function: capture button position (56px circle, centered
// horizontally, 14px above the bottom edge), matching the approved
// mockup. Factored out from rendering so it's unit-testable.
export function computeCaptureButtonRect(viewportW, viewportH) {
  const size = 56, marginBottom = 14;
  return {
    w: size, h: size,
    x: (viewportW - size) / 2,
    y: viewportH - marginBottom - size,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node app/src/camera.test.js`
Expected:
```
computeCaptureButtonRect: PASS
computeCaptureButtonRect (wide): PASS
```

- [ ] **Step 5: Write the camera view styles (full-bleed video + corner brackets)**

```css
/* app/src/style.css */
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app { height: 100%; }
body { background: #000; overflow: hidden; }

.camera-view {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.camera-view video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Corner-bracket framing guide -- a visual "aim here" cue, deliberately NOT
   a hard crop boundary, since one photo can capture many tiles anywhere in
   frame. Matches the approved mockup (option C). */
.corner-bracket {
  position: absolute;
  width: 26px;
  height: 26px;
  border: 3px solid #fff;
  opacity: 0.85;
}
.corner-bracket.top-left     { top: 18px; left: 18px; border-right: none; border-bottom: none; border-radius: 4px 0 0 0; }
.corner-bracket.top-right    { top: 18px; right: 18px; border-left: none; border-bottom: none; border-radius: 0 4px 0 0; }
.corner-bracket.bottom-left  { bottom: 80px; left: 18px; border-right: none; border-top: none; border-radius: 0 0 0 4px; }
.corner-bracket.bottom-right { bottom: 80px; right: 18px; border-left: none; border-top: none; border-radius: 0 0 4px 0; }

.capture-button {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #fff;
  border: 3px solid rgba(255, 255, 255, 0.5);
  cursor: pointer;
}

.upload-fallback {
  position: absolute;
  bottom: 90px;
  left: 50%;
  transform: translateX(-50%);
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  padding: 8px 16px;
  border-radius: 8px;
  font-family: sans-serif;
  font-size: 14px;
}
```

- [ ] **Step 6: Commit**

```bash
cd /Users/peterabeln/Documents/github/petr0n/domino-counter-app
git add app/src/camera.js app/src/camera.test.js app/src/style.css
git commit -m "M3 sub-project 1 Task 2: camera capture module + corner-bracket overlay styles"
```

---

### Task 3: File-upload fallback

**Files:**
- Create: `app/src/upload.js`, `app/src/upload.test.js`

**Interfaces:**
- Produces: `fileToImageData(file, canvasFactory) -> Promise<{data, width, height}>`
  (same `ImageData`-shape contract as `captureFrame`, so both paths feed the
  same downstream code)
- Consumed by: Task 6 (`main.js`)

This mirrors `harness.html`'s already-phone-tested `fileToImageData`
(M2), extracted into its own module. No new pure logic to unit-test beyond
what Task 2 already covers for the shared contract; this task's own
verification is Step 2 (a real file decodes into a correctly-shaped
object), checked manually in Task 6's end-to-end phone test. Still fully
specified here since a reviewer needs the real code, not "similar to
Task 2."

- [ ] **Step 1: Write upload.js**

```javascript
// app/src/upload.js
// File-input fallback for when camera access is denied/unavailable
// (build-plan-v2.md §9.0 hard constraint: this is not optional). Produces
// the same {data, width, height} shape captureFrame() does, so both paths
// feed one shared scan-and-render pipeline.

export async function fileToImageData(file, canvasFactory) {
  const bitmap = await createImageBitmap(file);
  const { ctx } = canvasFactory(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}
```

- [ ] **Step 2: Verify the module loads correctly**

Run: `node -e "import('/Users/peterabeln/Documents/github/petr0n/domino-counter-app/app/src/upload.js').then(() => console.log('imports OK')).catch(e => console.error(e))"`
Expected: `imports OK` (this only checks the module is syntactically valid
and has no broken imports — `createImageBitmap`/canvas are browser APIs,
so the actual behavior is verified manually in Task 6).

- [ ] **Step 3: Commit**

```bash
cd /Users/peterabeln/Documents/github/petr0n/domino-counter-app
git add app/src/upload.js
git commit -m "M3 sub-project 1 Task 3: file-upload fallback for denied/unavailable camera"
```

---

### Task 4: Scanner integration with progress indicator

**Files:**
- Create: `app/src/scan.js`, `app/src/scan.test.js`

**Interfaces:**
- Consumes: `scanner/index.js`'s `init({tileModelUrl, pipModelUrl})` and
  `scanImage(imageData, canvasFactory)` (repo root, unmodified — imported
  via relative path `../../scanner/index.js` from `app/src/`)
- Produces: `initScanner() -> Promise<void>` (points `init()` at
  `/models/tile.onnx` and `/models/pip.onnx`, the Vite-served static
  assets from Task 1), `scanWithProgress(imageData, canvasFactory, onProgress) -> Promise<Array<...>>`
  (wraps `scanImage`, calling `onProgress(message)` before/after so the UI
  can show a visible indicator instead of looking frozen — per the Global
  Constraints, multi-tile scans take multiple seconds), `formatEta(tileCount) -> string`
  (pure, testable — estimates roughly how long a scan will take from tile
  count, using the accepted M2 perf numbers, for the progress message)
- Consumed by: Task 6 (`main.js`)

- [ ] **Step 1: Write the failing test for the pure ETA-estimate function**

```javascript
// app/src/scan.test.js
import assert from 'node:assert';
import { formatEta } from './scan.js';

// Estimate uses the M2-measured numbers: ~180ms detection pass +
// ~100ms/tile pip counting (rounded, conservative -- real measured range
// was 90-115ms/tile). Message should read naturally for 0 tiles (before
// detection completes, tile count unknown) vs a known count.
{
  assert.strictEqual(formatEta(0), 'Detecting tiles...');
  console.log('formatEta(0): PASS');
}
{
  assert.strictEqual(formatEta(1), 'Reading 1 tile (~0.3s)...');
  console.log('formatEta(1): PASS');
}
{
  assert.strictEqual(formatEta(15), 'Reading 15 tiles (~1.7s)...');
  console.log('formatEta(15): PASS');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node app/src/scan.test.js`
Expected: `Error [ERR_MODULE_NOT_FOUND]` — `scan.js` doesn't exist yet.

- [ ] **Step 3: Write scan.js**

```javascript
// app/src/scan.js
// Thin wrapper around scanner/index.js: points init() at the app's static
// model assets, and adds a progress callback so the UI never looks frozen
// during a multi-second multi-tile scan (M2's accepted perf finding: pip
// counting alone runs ~90-115ms/tile on real hardware).
import { init, scanImage } from '../../scanner/index.js';

export async function initScanner() {
  await init({
    tileModelUrl: '/models/tile.onnx',
    pipModelUrl: '/models/pip.onnx',
  });
}

// Rounded, conservative per-tile estimate from the M2 phone perf probe
// (docs/superpowers/notes/2026-07-23-m2-perf-results.md): ~180ms detection
// + ~100ms/tile pip counting. This is a UX estimate for the progress
// message, not a promise -- real timing varies by device and tile count.
const DETECTION_MS = 180, PER_TILE_MS = 100;

export function formatEta(tileCount) {
  if (tileCount === 0) return 'Detecting tiles...';
  const seconds = (DETECTION_MS + tileCount * PER_TILE_MS) / 1000;
  const label = tileCount === 1 ? 'tile' : 'tiles';
  return `Reading ${tileCount} ${label} (~${seconds.toFixed(1)}s)...`;
}

// onProgress(message: string) is called once immediately (detection phase)
// and is available for scanImage's caller to call again once tile count is
// known, if a future revision of scanner/index.js exposes that -- for now
// this wraps the single opaque scanImage() call with a before/after
// message, since scanImage() doesn't yet report intermediate progress.
export async function scanWithProgress(imageData, canvasFactory, onProgress) {
  onProgress(formatEta(0));
  const results = await scanImage(imageData, canvasFactory);
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node app/src/scan.test.js`
Expected:
```
formatEta(0): PASS
formatEta(1): PASS
formatEta(15): PASS
```

- [ ] **Step 5: Verify the scanner import resolves from the app's location**

Run: `node -e "import('/Users/peterabeln/Documents/github/petr0n/domino-counter-app/app/src/scan.js').then(() => console.log('imports OK')).catch(e => console.error(e))"`
Expected: `imports OK` (confirms the relative path to `scanner/index.js`
resolves correctly from `app/src/`; `scanImage`'s actual browser-only
execution is verified in Task 6).

- [ ] **Step 6: Commit**

```bash
cd /Users/peterabeln/Documents/github/petr0n/domino-counter-app
git add app/src/scan.js app/src/scan.test.js
git commit -m "M3 sub-project 1 Task 4: scanner integration with progress-estimate messaging"
```

---

### Task 5: Raw-results rendering

**Files:**
- Create: `app/src/render.js`, `app/src/render.test.js`

**Interfaces:**
- Consumes: scan results shaped like `scanner/index.js`'s `scanImage()`
  output: `Array<{bbox: {x,y,width,height}, corners: Array<{x,y}>, predicted: {first, second, confidence}}>`
- Produces: `formatTileLabel(predicted) -> string` (pure, testable — e.g.
  `"7 / 3 (91% confident)"`), `renderResults(container, imageBitmap, results) -> void`
  (draws the photo + bbox overlay to a canvas inside `container`, and a text
  list below it — DOM-dependent, verified manually in Task 6)
- Consumed by: Task 6 (`main.js`)

- [ ] **Step 1: Write the failing test for the pure label-formatting function**

```javascript
// app/src/render.test.js
import assert from 'node:assert';
import { formatTileLabel } from './render.js';

{
  const label = formatTileLabel({ first: 7, second: 3, confidence: 0.91 });
  assert.strictEqual(label, '7 / 3 (91% confident)');
  console.log('formatTileLabel: PASS');
}
{
  // confidence rounds to nearest whole percent
  const label = formatTileLabel({ first: 0, second: 0, confidence: 0.4948 });
  assert.strictEqual(label, '0 / 0 (49% confident)');
  console.log('formatTileLabel (rounding): PASS');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node app/src/render.test.js`
Expected: `Error [ERR_MODULE_NOT_FOUND]` — `render.js` doesn't exist yet.

- [ ] **Step 3: Write render.js**

```javascript
// app/src/render.js
// Raw-results display: the captured photo with each detection's bbox
// drawn on top, plus a plain list of first/second reads. No editing, no
// history -- that's a future sub-project (§9.2/§10).

export function formatTileLabel(predicted) {
  const pct = Math.round(predicted.confidence * 100);
  return `${predicted.first} / ${predicted.second} (${pct}% confident)`;
}

// container: a DOM element to render into. imageBitmap: the captured
// photo (an ImageBitmap or HTMLCanvasElement, anything drawImage accepts).
// results: scanImage()'s output array.
export function renderResults(container, imageBitmap, results) {
  container.innerHTML = '';

  const canvas = document.createElement('canvas');
  canvas.width = imageBitmap.width;
  canvas.height = imageBitmap.height;
  canvas.style.maxWidth = '100%';
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageBitmap, 0, 0);

  ctx.strokeStyle = '#6ea8fe';
  ctx.lineWidth = Math.max(2, imageBitmap.width / 400);
  ctx.font = `${Math.max(16, imageBitmap.width / 60)}px sans-serif`;
  ctx.fillStyle = '#6ea8fe';
  for (const r of results) {
    ctx.strokeRect(r.bbox.x, r.bbox.y, r.bbox.width, r.bbox.height);
    ctx.fillText(formatTileLabel(r.predicted), r.bbox.x, r.bbox.y - 6);
  }
  container.appendChild(canvas);

  const list = document.createElement('ul');
  list.style.fontFamily = 'sans-serif';
  for (const r of results) {
    const li = document.createElement('li');
    li.textContent = formatTileLabel(r.predicted);
    list.appendChild(li);
  }
  container.appendChild(list);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node app/src/render.test.js`
Expected:
```
formatTileLabel: PASS
formatTileLabel (rounding): PASS
```

- [ ] **Step 5: Commit**

```bash
cd /Users/peterabeln/Documents/github/petr0n/domino-counter-app
git add app/src/render.js app/src/render.test.js
git commit -m "M3 sub-project 1 Task 5: raw-results rendering (bbox overlay + list)"
```

---

### Task 6: Wire it together + phone smoke test

**Files:**
- Modify: `app/src/main.js`

**Interfaces:**
- Consumes: `startCamera`/`stopCamera`/`captureFrame`/`computeCaptureButtonRect`
  (Task 2), `fileToImageData` (Task 3), `initScanner`/`scanWithProgress`
  (Task 4), `renderResults` (Task 5)

This is the integration task — no new pure logic, so no new unit test; its
verification is the real end-to-end phone test in Step 3, following the
same HTTPS/LAN workflow already used for M2's perf probes.

- [ ] **Step 1: Write main.js**

```javascript
// app/src/main.js
import './style.css';
import { startCamera, stopCamera, captureFrame } from './camera.js';
import { fileToImageData } from './upload.js';
import { initScanner, scanWithProgress } from './scan.js';
import { renderResults } from './render.js';

function canvasFactory(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

const app = document.querySelector('#app');
app.innerHTML = `
  <div class="camera-view" id="camera-view">
    <video autoplay playsinline muted></video>
    <div class="corner-bracket top-left"></div>
    <div class="corner-bracket top-right"></div>
    <div class="corner-bracket bottom-left"></div>
    <div class="corner-bracket bottom-right"></div>
    <button class="capture-button" id="capture-btn" aria-label="Capture photo"></button>
    <label class="upload-fallback" id="upload-label" style="display:none">
      Camera unavailable — <input type="file" accept="image/*" id="upload-input" style="display:none" /> tap to upload a photo
    </label>
  </div>
  <div id="results" style="display:none; padding: 16px;"></div>
  <div id="status" style="display:none; position:fixed; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.7); color:#fff; font-family:sans-serif; font-size:18px;"></div>
`;

const video = document.querySelector('#camera-view video');
const cameraView = document.querySelector('#camera-view');
const captureBtn = document.querySelector('#capture-btn');
const uploadLabel = document.querySelector('#upload-label');
const uploadInput = document.querySelector('#upload-input');
const resultsEl = document.querySelector('#results');
const statusEl = document.querySelector('#status');

function showStatus(message) {
  statusEl.textContent = message;
  statusEl.style.display = 'flex';
}
function hideStatus() {
  statusEl.style.display = 'none';
}

async function handleImageData(imageData, sourceBitmap) {
  cameraView.style.display = 'none';
  resultsEl.style.display = 'none';
  showStatus('Detecting tiles...');
  try {
    const results = await scanWithProgress(imageData, canvasFactory, showStatus);
    hideStatus();
    resultsEl.style.display = 'block';
    renderResults(resultsEl, sourceBitmap, results);
  } catch (err) {
    hideStatus();
    resultsEl.style.display = 'block';
    resultsEl.textContent = `Scan failed: ${err.message}`;
  }
}

async function main() {
  showStatus('Loading models...');
  await initScanner();
  hideStatus();

  const stream = await startCamera(video);
  if (!stream) {
    uploadLabel.style.display = 'block';
    captureBtn.style.display = 'none';
  }

  captureBtn.addEventListener('click', async () => {
    const imageData = captureFrame(video, canvasFactory);
    stopCamera(stream);
    await handleImageData(imageData, video);
  });

  uploadInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const bitmap = await createImageBitmap(file);
    const { ctx } = canvasFactory(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    await handleImageData(imageData, bitmap);
  });
}

main();
```

- [ ] **Step 2: Serve over HTTPS and reachable from the phone**

Run: `cd app && npm run dev -- --host`
Expected: same `Local`/`Network` HTTPS URLs as Task 1's check.

- [ ] **Step 3: Phone smoke test**

On the same phone/network used for M2's perf probes (Samsung Galaxy S25+,
Chrome), open the printed `Network` URL. Click through the self-signed
cert warning ("Advanced" → "Proceed").

Expected behavior, in order:
1. "Loading models..." shown briefly, then disappears.
2. Camera permission prompt appears; tap Allow.
3. Live camera preview fills the screen with four corner brackets visible.
4. Tap the white capture button.
5. "Detecting tiles..." shown (camera view hidden).
6. Within a few seconds, the results view appears: the captured photo with
   blue boxes + `first / second (NN% confident)` labels drawn over each
   detected tile, and the same labels listed below as plain text.

Also verify the fallback path: in Chrome, go to Settings → Site settings →
find the dev server's origin → Camera → Block, reload the page. Expected:
no camera prompt, the "Camera unavailable — tap to upload a photo" label
is visible instead of the capture button; tapping it and picking a photo
from `eval/corpus_photos/` (transferred to the phone, or any photo already
on the phone) produces the same results view as the camera path.

- [ ] **Step 4: Commit**

```bash
cd /Users/peterabeln/Documents/github/petr0n/domino-counter-app
git add app/src/main.js
git commit -m "M3 sub-project 1 Task 6: wire camera/upload -> scanner -> results; phone-verified"
```

---

## Self-Review Notes

- **Spec coverage:** Vite+vanilla stack (Task 1) ✓, `scanner/` unmodified
  and consumed via relative import (Task 4, verified by Step 5's import
  check) ✓, models copied to static assets not npm-bundled (Task 1) ✓, live
  camera with corner-bracket overlay per the approved mockup (Task 2) ✓,
  upload fallback (Task 3) ✓, progress indicator for multi-second scans
  (Task 4) ✓, raw bbox+list display, no editing (Task 5) ✓, HTTPS dev
  workflow for phone testing (Task 1, exercised in Task 6) ✓, explicitly
  out-of-scope items (review UX, history, PWA) not touched by any task ✓.
- **Placeholder scan:** no TBD/TODO; Task 6's phone-test steps are
  manual-verification instructions by design (camera/DOM code isn't
  meaningfully unit-testable), not deferred implementation.
- **Type/interface consistency:** checked `captureFrame` (Task 2) and
  `fileToImageData` (Task 3) both return the same `{data, width, height}`
  shape `scanWithProgress` (Task 4) and ultimately `scanner.scanImage()`
  expect. Checked `renderResults`' `results` parameter shape matches
  `scanImage()`'s actual return type (`bbox`/`corners`/`predicted`) as
  established in M2. Checked `canvasFactory` has the same `(w,h) => {canvas,
  ctx}` signature everywhere it's passed (Tasks 2, 3, 4, 6).
