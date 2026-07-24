# M2 phone performance probe — 2026-07-23

**Device:** Samsung Galaxy S25+, Chrome
**Network:** local Wi-Fi, harness served from Mac via `python3 -m http.server 8765 --bind 0.0.0.0`

**Per-photo timing (from harness.html's on-page log):**
```
models loaded
1000013754.jpg: 4 tiles, 1103ms
1000013746.jpg: 2 tiles, 640ms

total: 1743ms over 2 photos, avg 871.5ms/photo
```

**Decomposing detection-pass vs per-crop pip-count time** from the two data
points (each photo's total = one detection pass + N pip-count passes,
N = tile count):
```
640  = D + 2P
1103 = D + 4P
=> P = 231.5ms per pip crop, D = 177ms detection pass
```

**Against §8 budgets:**

| Metric | Budget | Measured | Pass? |
|---|---|---|---|
| End-to-end scan | ≤ ~2s | 640ms (2 tiles), 1103ms (4 tiles) | Yes for these photos, but see note below |
| Detection pass | ≤ ~300-500ms | ~177ms | **Yes** |
| Per-crop pip count | ≤ ~30-50ms | ~231.5ms | **No — 4-7x over budget** |
| Total model download | ≤ ~10-15MB | 6.2MB (3.1MB tile + 2.8MB pip, both int8) | **Yes** |

**Verdict: partial pass.** Detection and model size clear their budgets
comfortably. Per-crop pip counting does not, and the failure mode compounds
per tile: extrapolating linearly, a 15-tile hand (`~177 + 15*231.5 ≈ 3.65s`)
would blow well past the 2s end-to-end budget, whereas the photos tested
here (2-4 tiles) stayed under it only because tile count was low.

**Likely cause, not yet confirmed:** the pip-count path runs a hand-rolled
JS perspective-warp (`warpPerspective` in `scanner/geometry.js`, a 128×256
nested-pixel bilinear-sample loop) and Sobel edge detection (`barSplit`,
another full-image nested loop) on the CPU with no hardware acceleration,
*before* the ONNX model even runs — on a mobile CPU in an interpreted JS
loop, this is a plausible dominant cost, not the neural net itself (which
is the same architecture/size class as the tile detector, whose pass came
in well under budget). Not yet isolated by direct measurement (e.g.
timing `warpPerspective`+`barSplit` separately from the ONNX `session.run`
call) — that would be the next diagnostic step before attempting a fix.

**Implication for M3:** this is a real, useful finding — exactly the kind
of "surfaces a perf dead-end before UI work is built on top of it" outcome
the design spec anticipated as legitimate, not a failure to work around
silently within this milestone. Per-tile pip-count latency needs to come
down by roughly 5-10x before this pipeline can handle a typical multi-tile
hand within budget. Candidate fixes (not attempted here, out of scope for
M2): replace the manual bilinear warp with the Canvas API's native
`drawImage` compositing (hardware-accelerated) for the perspective step,
and/or move the Sobel bar-detection to operate on a downscaled crop (it
only needs to find one row, not full resolution). This should be resolved
or explicitly deferred-with-owner before M3 commits to this exact
architecture for the shipped app.
