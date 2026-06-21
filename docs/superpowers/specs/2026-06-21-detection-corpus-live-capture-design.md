# Detection Corpus via Live Phone Capture — Design Spec

**Date:** 2026-06-21
**Status:** Approved (design), pending spec review
**Goal of this round:** Build a tile-**detection** test corpus from live phone-camera
scans, watched in real time on the desktop, then score and root-cause failures.

---

## 1. Goal & Scope

Expand `detect_eval` coverage with real phone-camera photos of dense, varied-arrangement
scenes (the regime that stresses `findTiles` separation), captured **live from the phone
while monitored on the desktop**, using and extending the existing local logging tooling.

**In scope**
- A dev-only live-capture path: phone camera → unified dev server → saved full frame + log.
- Real-time monitoring of detected-vs-truth tile counts as the user scans.
- Promotion of selected frames into committed `detect_eval` fixtures.
- A `detect_eval` refactor to derive truth from filenames (glob + parse), for scalability.
- Root-cause analysis of each detection failure the new corpus reveals.

**Out of scope (explicit non-goals)**
- **Pip counting.** This round is detection only. Pip-counting corpus expansion is a
  separate, later project (one goal at a time).
- **Changing locked detection code.** `findTiles`, `dividerSplit`, `dividerScan`,
  `pipClusterScan`, `perspectiveWarp`, `countPips`, `preprocess` are LOCKED (see CLAUDE.md).
  This round produces a corpus + failure report; it does **not** modify the pipeline.
  Any fix that requires touching that code is a separate, explicitly-approved round.
- Backgrounds/lighting axes — already represented in the existing 6 fixtures; not a focus.

---

## 2. Constraints

1. **Locked pipeline.** No behavior change to the detection primitives. The eval harness
   and dev tooling only *observe* the pipeline.
2. **Dev/app isolation (hard requirement).** None of the live-capture machinery may ship
   in the running app. All capture/logging logic lives in dev-only `eval/` files and is
   injected by the dev server at serve-time. The shipped app retains at most a single
   guarded no-op hook. This *reduces* shipped dev-code versus today (the current
   hardcoded `localhost:8766` POST in `quick.js` is removed).
3. **Camera needs a secure context.** `getUserMedia` only works over HTTPS or `localhost`.
   Live phone capture therefore requires an HTTPS origin (the tunnel).
4. **Free & local-first.** No paid APIs. Detection is scored by the free local
   `detect_eval` (preprocess + `findTiles`). Tunnel is a free cloudflared quick-tunnel.
5. **Repo hygiene.** Raw captured frames stage in gitignored `eval/photos/`. Only
   downscaled, promoted fixtures (`eval/detect_*.jpg`, ~1000px max dim) are committed.

---

## 3. Architecture & Components

Single origin for the dev session (so the browser uses a relative `/log`, satisfying the
secure-context + same-origin/mixed-content rules and removing all hardcoded hosts):

```
 Phone (HTTPS via tunnel)                Desktop
 ┌───────────────────────┐              ┌──────────────────────────────────────┐
 │ quick.html + quick.js │  scan POST   │ unified dev server (eval/log-server)  │
 │  camera → preprocess  │ ───/log────► │  - serves static files (repo root)   │
 │  → scanCanvasDebug    │   (relative) │  - injects eval/dev-capture.js into  │
 │  → guarded hook       │              │    quick.html at serve time          │
 └───────────────────────┘              │  - POST /log: save full frame +      │
        ▲   cloudflared HTTPS tunnel    │    per-tile crops + scan-log.json    │
        └──────────────────────────────│  - prints each scan to stdout        │
                                        └──────────────────────────────────────┘
                                                 ▲ I run this in background and
                                                 │ watch stdout live
```

### 3.1 Unified dev server — `eval/log-server.cjs` (extended)
- Serves static files from the repo root (so the app loads from the same origin as `/log`).
- **Injects** `<script src="/eval/dev-capture.js"></script>` into `quick.html` responses
  only. Committed `quick.html` is never modified.
- `POST /log`: in addition to today's per-tile crops + `scan-log.json` entry, saves the
  **full raw guide-cropped frame** to `eval/photos/frame_<ts>_d<detected>.jpg`.
- Logs each scan to stdout: timestamp, detected `tileCount`, per-tile reads.
- Runs on one port; exposed via `cloudflared tunnel --url http://localhost:<port>`.

### 3.2 Dev capture hook — `eval/dev-capture.js` (NEW, dev-only)
- Defines `window.__domCapture` and POSTs scan payloads to the **relative** `/log`.
- Never referenced by committed HTML; only present when injected by the dev server.
- In production the file is absent → `window.__domCapture` is undefined → app no-ops.

### 3.3 Shipped app seam — `quick.js` (minimal change)
- **Remove** the hardcoded `http://localhost:8766/log` POST.
- Add one guarded hook after a scan, e.g.:
  ```js
  if (window.__domCapture) window.__domCapture({ frame: rawCropDataUrl, tiles: found });
  ```
  The raw guide-cropped frame (`rawCropDataUrl`) is captured **before**
  `DominoCV.preprocess` so committed fixtures stay raw color, matching existing fixtures
  and keeping `detect_eval`'s own preprocess step faithful. The `toDataURL` for the frame
  is only computed when the hook is registered (dev), so production pays nothing.

### 3.4 Detection eval — `eval/detect_eval.cjs` (refactor)
- Replace the inline `TRUTH` map with a **glob of `eval/detect_*.jpg`** where truth is the
  **trailing `_<N>`** in the filename (e.g. `detect_dense_touching_12.jpg` → expect 12).
- Migrate the 6 existing fixtures to the `_<N>` convention
  (e.g. `detect_4tiles.jpg` → `detect_4tiles_4.jpg`, `detect_towel3.jpg` →
  `detect_towel_3.jpg`, etc.). Pipeline call params to `findTiles` unchanged.

---

## 4. Data Flow (one scan)

1. Phone camera frame → guide-box crop (existing 84% crop) → **capture `rawCropDataUrl`**.
2. `DominoCV.preprocess` (in place) → `DominoCV.scanCanvasDebug` → per-tile results.
3. Guarded hook fires → `dev-capture.js` POSTs `{ frame, tiles }` to `/log`.
4. Server saves `frame_<ts>_d<detected>.jpg` + per-tile crops, appends `scan-log.json`,
   prints to stdout.
5. I read stdout live; user states true count; I flag detected ≠ truth.

---

## 5. Live Session Workflow

1. **Setup:** stop standalone `:8765` (Python) and `:8766` (node) servers; I start the
   unified dev server in the background and `cloudflared` to get the HTTPS URL.
2. **Connect:** user opens the `https://…trycloudflare.com/quick.html` URL on the phone
   (same or any network — tunnel handles reachability).
3. **Capture loop:** user stages a scene, says the true tile count + arrangement, scans.
   I report detected-vs-truth immediately and note the saved frame.
4. **Coverage targets:** dense scenes (10–20+ tiles) and arrangements
   (touching edge-to-edge, stacked, angled, scattered).

---

## 6. Promotion & Reporting (deliverable)

1. Promote selected staged frames (all failures + representative passes, emphasizing
   dense/touching) → downscale to ~1000px max dim → commit as
   `eval/detect_<desc>_<truth>.jpg`.
2. Run `node eval/detect_eval.cjs`; confirm it reproduces each live failure.
3. Root-cause every failure (why `findTiles` returned the wrong count) **without changing
   locked code**.
4. Deliver a report: per failure → scene description, detected vs truth, root cause.
   User decides which (if any) warrant a future detection-pipeline change.

---

## 7. Verification

- `node eval/detect_eval.cjs` runs green on all **previously-passing** fixtures after the
  glob/parse refactor and renames (no regression from the harness change itself).
- `node eval/grid_eval.cjs` stays green (untouched; sanity that nothing leaked).
- Production sanity: with `dev-capture.js` absent, `quick.js` performs no logging and no
  frame `toDataURL` (hook guard false) — verified by reading the shipped code path.
- New fixtures appear in `detect_eval` output with correct parsed truth.

---

## 8. Dependencies

- `cloudflared` — installed (`/opt/homebrew/bin/cloudflared`, v2026.6.1). Quick-tunnel
  mode; no account/login.
- Existing eval deps (`jpeg-js`, `@techstark/opencv-js`) already installed.

---

## 9. Risks & Mitigations

- **Tunnel frames transit Cloudflare's edge** (ephemeral). Accepted by user over
  self-signed-LAN-cert friction. No secrets in frames (domino photos).
- **Quick-tunnel URL changes per run.** Acceptable; user re-opens the printed URL.
- **`detect_eval` rename churn.** One-time migration of 6 names; covered by the
  no-regression check in §7.
- **Promoting too many frames bloats the repo.** Mitigated by downscaling and curating to
  failures + representative passes only.
