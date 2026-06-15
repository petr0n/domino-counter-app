# Pip-counting eval harness

Measures domino pip-counting accuracy against ground truth, so prompt/pipeline
changes are *verified* instead of guessed. Not part of the shipped app.

It runs every photo through the same pipeline the app uses — the LOCKED
`DominoCV.preprocess` grayscale + contrast stretch, then Claude counting via the
Worker `/anthropic` proxy — and scores the result against `fixtures.json`.

## Prerequisites

1. **Network egress** to the Worker host must be allowed for this environment:
   `domino-counter-proxy.petron.workers.dev` (otherwise calls fail with
   "Host not in allowlist"). The Worker must be deployed with a valid
   `ANTHROPIC_API_KEY`.
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

## Files

- `eval.mjs` — runner (single-pass count).
- `prompt.txt` — the counting prompt under test (edit to iterate).
- `fixtures.json` — ground-truth answers per photo (the scoring key).
- `photos/` — test images (git-ignored).
