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

**Implication for M3 (superseded by the follow-up investigation below):** this
is a real, useful finding — exactly the kind of "surfaces a perf dead-end
before UI work is built on top of it" outcome the design spec anticipated as
legitimate, not a failure to work around silently within this milestone.

---

## Follow-up investigation — 2026-07-23 (same day)

The "hand-rolled JS geometry is the bottleneck" hypothesis above was **wrong**
— disproven by direct isolated measurement, not just re-guessed. Real
per-step timing added to `countPips()` (temporary, since removed) and run on
the same Galaxy S25+:

| Step | Measured |
|---|---|
| `warpPerspective` (JS bilinear warp) | ~14-23ms |
| grayscale + `barSplit` (JS Sobel) | ~0.2-4ms |
| letterbox + tensor conversion | ~7-24ms |
| **ONNX inference itself** | **~104-115ms** |

The neural net call is 80-90% of the per-crop cost, not the surrounding JS.

**Second hypothesis — WASM execution provider not explicitly configured** (no
`executionProviders`/`numThreads` set, so `ort.env.wasm.numThreads` defaulted
to `0`/auto, which tries multithreading via `SharedArrayBuffer` and silently
falls back without the COOP/COEP headers this repo's plain `http.server`
doesn't send): explicitly set in `scanner/index.js`'s `init()`
(`numThreads=1`, `simd=true`, `executionProviders: ['wasm']`, matching §8's
required baseline exactly) and re-measured. **No measurable change**
(~106-109ms, same as before). Kept the explicit config anyway since it's the
architecturally-correct, deterministic setting §8 calls for, even though it
wasn't the fix.

**Third hypothesis — int8 quantization isn't actually speeding up compute on
this backend**, only shrinking file size (the ~104-115ms measured was
suspiciously close to §8's own *fp32* anchor of ~110ms, not its int8 anchor
of ~40ms). Tested directly with an isolated A/B harness (`ort.InferenceSession`
timing only, no photos, 5 warmed-up runs each) on the same phone:

| Variant / backend | Measured (5-run range) |
|---|---|
| INT8 / WASM | 101-108ms |
| FP32 / WASM | 88-94ms (**faster than int8**) |
| WebGPU (either) | unavailable — `navigator.gpu` is `false` on this device |

**Confirmed: int8 quantization provides no compute speedup here** — fp32 is
if anything ~10% faster on this WASM backend, meaning `onnxruntime-web` isn't
using real int8 kernels for this model/backend combination; the smaller
`.onnx` file only helps download size, not latency. WebGPU (the plan's other
opportunistic lever) isn't available on this specific device/Chrome build,
so that path can't be benchmarked here either.

**Fourth hypothesis — batching multiple tile-crops into one inference call**
to amortize fixed per-call overhead: tested via Python/`onnxruntime` on
desktop (different hardware than the phone, but the *ratio* of batching
benefit should carry over, since it reflects the model's own compute-scaling
behavior, not device-specific quirks) with a `dynamic=True` export:
batch=1 took ~13.5ms/call; batch=4 took ~49ms total (~12.25ms/tile-equivalent)
— only a ~10% saving. **Not enough to close a 4-7x gap.**

**Root cause, now actually confirmed rather than guessed:** ~90-105ms is the
genuine compute cost of running this exact model (YOLO11n, imgsz=384) via
`onnxruntime-web`'s WASM CPU backend on this phone. None of the config-level
levers (quantization, explicit WASM/SIMD config, batching) close the gap to
the §8 budget's ~30-50ms target, and the plan's own ~40ms reference anchor
simply doesn't hold for this specific model/runtime/device combination.
WebGPU remains untested on real hardware (unavailable on this device) and is
the one lever that could plausibly close the gap on devices that do support
it, but can't be assumed.

**Decision (2026-07-23):** accept the current performance rather than invest
further in closing this gap. M3's UX must be designed around it explicitly:
no hard 2s promise for multi-tile hands, a visible progress indicator during
multi-tile scans (each tile takes a further ~100-150ms after detection, so a
15-tile hand is a multi-second, not instant, operation). Retraining a
smaller/faster model and a server-side inference fallback were both
considered and explicitly deferred, not ruled out — either remains available
as a future lever if real-world usage shows the current latency is
unacceptable.
