# M3 sub-project 1 — App shell + camera capture + raw scan design

**Status:** Approved for implementation planning.
**Scope:** first slice of build-plan-v2.md's M3 ("Quick Scan integration").
Proves the full stack — camera capture, `scanner/` module, raw results — works
end-to-end in a real mobile browser. Review/correction UX (§9.2), local
history (§10), and PWA/offline caching (§9.0) are each their own follow-up
sub-project, not built here.

## Why this is scoped separately from the rest of M3

M3 as described in the build plan bundles several genuinely separable
concerns: app shell/scaffolding, camera+upload capture, scanner wiring,
review/correction UX, local history, and PWA/offline caching. Each is
substantial enough to deserve its own design→plan→build cycle rather than
one sprawling plan. This is the foundational slice: get a photo in, get
`scanImage()` results out, show them raw. Everything else builds on top of
this working end-to-end first.

## Stack & structure

Vite + vanilla JS — matches build-plan-v2.md §9.0's stated softer preference
("keep the UI lightweight... vanilla or a small library... the UI is simple
enough that minimal wins"), and stays consistent with `scanner/`'s existing
plain-JS style (no framework).

`scanner/` stays exactly where it is at the repo root — per `CLAUDE.md`'s
architecture note, it's a standalone module (`init()`/`scanImage()`, no DOM,
no storage), not app-specific code. A new `app/` directory holds the Vite
project (`app/index.html`, `app/src/main.js`, etc.) and imports from
`scanner/` via a relative path.

The two production `.onnx` models get copied into `app/public/models/` for
local dev. This matches the deploy convention already specified in
build-plan-v2.md §5.5 (models attached to GitHub Releases, copied into
static assets at deploy time) without building that release/CI automation
yet — that's separate infrastructure work, out of scope here.

## Camera flow

`getUserMedia()` opens a live preview in a full-bleed `<video>` element with
subtle scanner-style corner brackets overlaid (visual "aim here" cue, no
hard boundary — since one photo can capture many tiles, a tight crop guide
implying "only this box gets scanned" would be misleading). A capture button
freezes the current frame to a canvas, extracts `ImageData`, and hands it to
the same code path as the upload fallback.

If camera permission is denied or `getUserMedia` is unavailable, falls back
to a plain file input (required either way per §9.0's hard constraint — "the
photo-upload fallback when the camera is denied/unavailable" is not
optional). Both paths converge on the same "have an `ImageData`, now scan
it" function.

## Scan + display

After capture, run `scanner.scanImage(imageData, canvasFactory)` with a
visible progress indicator — multi-tile scans take multiple seconds (the
accepted M2 perf finding: ~90-105ms *per tile* for pip counting, on top of
the detection pass), so this must not pretend to be instant. Display raw
results once done: the captured photo with each detection's bounding box
overlaid, plus a simple list of each tile's `first`/`second` read and
confidence. No editing, no "Not Tile" action, no history — that's
sub-project 2 (§9.2 review/correction UX).

## Dev/testing workflow

`getUserMedia()` requires a secure context — `localhost` is exempt, but
testing on a phone over the LAN (as this project has been doing throughout
M2) is not. The Vite dev server runs with a self-signed cert
(`@vitejs/plugin-basic-ssl`) so phone testing continues over `https://`
instead of `http://`, the same workflow used for M2's perf probes, just with
the extra cert step (the browser will show a one-time security warning to
click through for a self-signed cert — expected, not a bug).

## Explicitly out of scope

Review/correction UX, local history (IndexedDB/localStorage), PWA/service-worker
offline caching, the round/game flow (§9.3). Each gets its own
brainstorm→plan→build cycle once this slice is proven working.

## Success criteria

- On a real phone (same test device as M2: Samsung Galaxy S25+, Chrome),
  tapping the capture button produces a photo, runs `scanImage()`, and
  displays per-tile results with a visible progress indicator during the
  wait.
- Camera-denied/unavailable case correctly falls back to file upload without
  a broken or blank screen.
- No regression in `scanner/`'s own behavior — it is consumed, not modified,
  by this work (unless a genuine integration bug surfaces, in which case fix
  it minimally and note why).
