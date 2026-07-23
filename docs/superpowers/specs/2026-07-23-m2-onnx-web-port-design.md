# M2 — ONNX Runtime Web port design

**Status:** Approved for implementation planning.
**Scope:** build-plan-v2.md §6 M2 ("On-device deployment"), §8 (deployment/runtime), and the JS port called for in `train/domino_synth/rectify.py`'s docstring.

## Goal

Prove the trained scanner (tile detector + pip detector) runs correctly and fast
enough entirely client-side, in a browser, before any app UI is built on top of
it (UI is M3, explicitly out of scope here). Output of this milestone: a
validated, timed, browser-runnable scanner pipeline — not a shippable feature.

## Why this comes before the Quick Scan UI (M3)

The build plan's architecture decision (D3) is client-side-only inference — no
required inference server. M3 ("Quick Scan integration") explicitly depends on
M2 being done: the UI wires a *working on-device scanner* into a camera/upload
flow. Building the UI first would mean either faking the inference path or
building against Python models the shipped app can never call, so M2 has to
land first. The plan's own phone-performance budgets (§8) are also still listed
as open in §13 ("phone budgets set in M2") — this is real unvalidated risk, not
a formality.

## Models

- Tile detector (Stage 1, YOLO-Pose): `runs/pose/touch/weights/best.pt`
- Pip detector (Stage 2, plain YOLO detection): `runs/detect/pipdet_hn/weights/best.pt`

These are the current validated production weights (per-half accuracy 0.973,
detection recall 0.995 on the 79-photo/393-tile eval corpus). No retraining
happens as part of M2 — this milestone only ports what already exists.

## Export: int8 directly

Export both models straight to int8-quantized ONNX via Ultralytics' one-line
export (`model.export(format='onnx', int8=True)`), using a calibration set
drawn from real eval photos (`eval/corpus_photos/`, not synthetic data) so
quantization scale/precision reflects real capture conditions.

Rationale for skipping an fp32-first phase: the plan's own reference anchor for
this model family (YOLO-nano) shows quantization is low-risk (mAP 0.350→0.347,
negligible). If int8 parity checks fail, the first debugging step is a quick
fp32 side-by-side export to isolate whether the export itself or the
quantization is the cause — not a full separate fp32 verification pass.

## JS geometry port (non-ML)

Port the classical (non-neural) post-processing logic from
`train/domino_synth/rectify.py` and `train/predict.py` to plain, dependency-light
JS — no ML involved in any of this, it runs on the two models' raw outputs:

- **Perspective rectify**: given a tile's 4 corner keypoints, warp to an upright
  128×256 crop. Implemented as a small homography (3×3 matrix) + bilinear
  sampling on a canvas — no external library.
- **Divider-bar split**: Sobel edge-magnitude profile to find the bar row
  (`bar_split()`), with the geometric-midpoint fallback preserved.
- **Pip-to-half assignment**: partition the pip detector's output boxes into
  top/bottom by the bar row.
- **NMS + duplicate-detection dedup**: port the existing IoU-based NMS and
  `dedup_confident_duplicates` (from `predict.py`) directly — both are already
  simple, self-contained Python.
- **YOLO output decoding**: decode each model's raw ONNX output tensor into
  boxes (+ keypoints for the tile detector) — the standard anchor-free YOLO11
  decode pattern, well-documented for plain detection; carries 4 extra corner
  points through for the pose model (§8 notes this as low-risk, unlike the
  rotated-NMS path an OBB approach would have needed).

## Test harness

A minimal throwaway HTML/JS page — no build tooling, `onnxruntime-web` loaded
via a CDN script tag. Loads both int8 ONNX models and runs the full pipeline
(detect tiles → rectify → detect pips → split → count) on a fixed set of eval
photos, printing per-tile results. This page is disposable — M3 sets up the
real app structure (Vite, per §9.0) separately; nothing here is meant to carry
forward as-is.

## Parity verification

Compare the harness's output against the existing Python `predict.py` output
on the same ~10-15 representative eval photos (varied tile counts and pip
values, not the full 79-photo corpus — this is verifying the export/runtime is
numerically faithful to the trained model, not re-measuring accuracy against
ground truth). Match = same tile identities, same pip counts, confidences in
the same ballpark.

## Phone performance probe

Once parity holds, serve the same harness page over the local network (or a
quick tunnel) so it can be opened on a real mid-range phone, per §8's
requirement that budgets be validated on real hardware, not just desktop
WASM. Instrumented to log timing against the plan's targets:

- End-to-end scan: ≤ ~2s
- Detection pass: ≤ ~300–500ms
- Per-crop pip count: ≤ ~30–50ms
- Total model download: ≤ ~10–15MB

WASM + SIMD, single-threaded, is the required baseline path (§8) —
multithreading and WebGPU are opportunistic, benchmarked only if available,
never assumed.

## Explicitly out of scope (deferred to M3)

Camera capture, photo upload, the review/correction UI, local storage
(IndexedDB/localStorage), the app shell, PWA/offline caching, and the real
Vite project structure. This milestone produces a validated pipeline and
timing numbers, not a feature.

## Success criteria

- Int8 ONNX exports of both models produced and loadable via `onnxruntime-web`.
- Parity confirmed on the sample set (same identities/counts as `predict.py`).
- Real-phone timing measured and compared against §8 budgets — pass or fail,
  either way this is the answer M2 exists to produce. A failure here is a
  legitimate, useful outcome (surfaces a perf dead-end before M3 UI work is
  sunk on top of it), not a blocker to fix within this milestone unless the
  fix is small (e.g., swapping which YOLO-nano variant is exported).
