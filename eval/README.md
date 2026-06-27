# Pip-counting eval harness

Measures domino pip-counting accuracy against ground truth, so prompt/pipeline
changes are *verified* instead of guessed. Not part of the shipped app.

It runs every photo through the same pipeline the app uses — the LOCKED
`DominoCV.preprocess` grayscale + contrast stretch, then Claude counting via the
Worker `/anthropic` proxy — and scores the result against `fixtures.json`.

## Prerequisites

1. **Model access** (either one):
   - **Preferred:** set an `ANTHROPIC_API_KEY` environment variable. The harness
     then calls `api.anthropic.com` directly, which is on the default Trusted
     egress allowlist — no network-settings change needed.
   - **Or:** allow egress to the Worker host
     `domino-counter-proxy.petron.workers.dev` (network access → Custom) and the
     harness uses the Worker proxy. The Worker must have a valid key.
2. **Photos**: put test images in `eval/photos/<key>.jpg`, where `<key>` matches
   a key in `fixtures.json`. (Photos are git-ignored — keep personal images out
   of the repo.)
3. **Ground truth**: fill in `fixtures.json` with the correct tiles for each
   photo. This file is the scoring key — it must be right.

## Run

```bash
cd eval
npm install        # once
npm run eval       # prints per-photo got vs expected + totals
```

Output example:

```
✓ 469: got [9|9 9|9]  exp [9|9 9|9]  2/2
✗ 466: got [12|9 9|1 2|2]  exp [6|9 9|1 2|2]  2/3
TOTAL: 17/22 tiles correct · 5/8 photos perfect
```

## Browser-faithful eval (Puppeteer)

`detect_eval.cjs`/`grid_eval.cjs` decode JPEGs with jpeg-js and a hand-rolled
`stretchGray`, which does NOT match the browser's Chromium/Skia decode — so
on-device failures can stay invisible to them. `browser_eval.cjs` runs the REAL
`detect.js` inside headless Chromium through the actual camera path, so the
pixels match the phone. Free; network only for the OpenCV.js CDN the app loads.

```bash
node browser_eval.cjs            # committed detect_*_N.jpg fixtures
node browser_eval.cjs --frames   # PHONE-EXACT: frames captured via capture.sh
```

**Phone-exact loop:** `./capture.sh` (repo root) starts the dev server +
cloudflared tunnel; open the printed URL on the phone and scan. Each scan saves
the exact post-crop frame `scanCanvas` processed into `eval/sessions/<id>/photos/`
(git-ignored). `--frames` then re-runs the current code over those frames — same
code + same input ⇒ reproduces the device exactly. The phone's own count is in
each filename (`_dN`); a mismatch after a code change is a real bug to fix.

## Files

- `eval.mjs` — runner (single-pass count).
- `prompt.txt` — the counting prompt under test (edit to iterate).
- `fixtures.json` — ground-truth answers per photo (the scoring key).
- `photos/` — test images (git-ignored).
