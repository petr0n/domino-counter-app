# M2 — ONNX Runtime Web Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export the trained tile detector and pip detector to int8 ONNX, port
the non-ML geometry pipeline to plain JS, and prove the whole thing runs
correctly and fast enough in a browser via ONNX Runtime Web — before any app
UI is built on top of it.

**Architecture:** Two int8 ONNX models + a dependency-light `scanner/` JS
module (per `CLAUDE.md`'s existing architecture note: exposes `init()` and
`scanImage()`, no DOM, no storage) that ports `train/domino_synth/rectify.py`'s
math. A throwaway `harness.html` wires the module to `onnxruntime-web`
(CDN, no build step) for parity verification and a real-phone perf probe.

**Tech Stack:** Python/Ultralytics (export), plain JS + Node (module + tests,
no npm dependencies), `onnxruntime-web` via CDN `<script>` tag in the harness
only.

## Global Constraints

- Models to export: `runs/pose/touch/weights/best.pt` (tile detector),
  `runs/detect/pipdet_hn/weights/best.pt` (pip detector). Do not retrain —
  these are the current validated production weights.
- Export directly to int8 (`quantize=8`), no fp32-first phase. If parity
  fails later, the fallback diagnostic is a quick fp32 side-by-side export,
  not a full separate phase.
- Calibration data: real eval photos, not synthetic (`eval/corpus_photos/`
  for the tile detector, `train/data/face_crops/` for the pip detector).
- `scanner/` code touches no DOM, no storage — pure functions in, pure JSON
  out, matching `CLAUDE.md`'s existing architecture note.
- No build tooling anywhere in this milestone (no npm install, no bundler).
  Node is used only to run plain `.js` files as tests (`node file.test.js`).
- Out of scope: camera, review/correction UI, local storage, the real Vite
  app shell. All of that is M3.
- Verified facts this plan relies on (checked directly against the installed
  `ultralytics==8.4.96` / `onnxruntime==1.19.2`, not assumed from general
  knowledge — see `docs/superpowers/specs/2026-07-23-m2-onnx-web-port-design.md`
  for how):
  - Export API is `model.export(format="onnx", quantize=8, data="<dataset>.yaml")`
    (not the commonly-documented `int8=True` — that flag doesn't exist in
    this version).
  - Raw ONNX output tensors are **already fully decoded**: box coords are
    pixel-space `[cx, cy, w, h]`, class score is already sigmoid-applied,
    and (pose model) keypoint x/y are pixel-space with sigmoid-applied
    visibility. No DFL/anchor math needed client-side.
  - Pip detector ONNX output shape at imgsz=384: `(1, 5, 3024)` — channels
    `[cx, cy, w, h, class_score]`.
  - Tile detector ONNX output shape at imgsz=640: `(1, 17, 8400)` — channels
    `[cx, cy, w, h, class_score, kp1x, kp1y, kp1v, kp2x, kp2y, kp2v, kp3x,
    kp3y, kp3v, kp4x, kp4y, kp4v]`.
  - **NMS is NOT baked into the export** (only box/keypoint decode is) —
    both models' raw output contains multiple overlapping boxes per real
    detection; standard NMS must run client-side.
  - `train/predict.py`'s exact production thresholds: tile detector
    `conf=0.50`, NMS `iou=0.75`; pip detector `conf=0.85`, NMS `iou=0.7`
    (Ultralytics' default, not overridden in `predict.py`); post-NMS
    duplicate cleanup `DUPLICATE_IOU_THRESHOLD=0.65`.
  - Ultralytics' default single-image preprocessing (`rect=False`, which
    `predict.py` doesn't override) is a **square, centered letterbox**:
    `scale = min(imgsz/w, imgsz/h)`, resize preserving aspect ratio, pad to
    `imgsz × imgsz` with grey (114,114,114), padding split evenly on both
    sides. Confirmed by reading `LetterBox.get_params`/`BasePredictor.pre_transform`
    directly — `auto` (stride-rounded rectangle) is only used when
    `rect=True`, which is not the default and not set anywhere in this repo.

---

### Task 1: Real-photo calibration datasets for int8 export

**Files:**
- Create: `train/build_calibration_sets.py`
- Create (generated, gitignored under `train/data/`): `train/data/calib_tiles/`, `train/data/calib_pips/`

**Interfaces:**
- Produces: `train/data/calib_tiles/dataset.yaml` (pose-format, `kpt_shape: [4, 3]`,
  matching `train/data/synth_touch/dataset.yaml`'s schema) and
  `train/data/calib_pips/dataset.yaml` (plain-detection format, matching
  `train/data/pips_yolo/dataset.yaml`'s schema). Both point `val:` at a
  directory of real images with no label files (Ultralytics treats
  unlabeled images as background — calibration doesn't need accurate boxes,
  only representative pixel content).

- [x] **Step 1: Write the calibration-set builder script**

```python
#!/usr/bin/env python3
"""Build minimal real-photo calibration datasets for int8 ONNX export
(M2 design doc: calibration must be real photos, not synthetic, so
quantization scale/precision reflects real capture conditions).

Usage:
  .venv/bin/python train/build_calibration_sets.py
"""
import shutil
from pathlib import Path

TILE_YAML = """\
path: {root}
train: images/val
val: images/val
kpt_shape: [4, 3]
flip_idx: [0, 1, 2, 3]
names:
  0: domino_tile
"""

PIP_YAML = """\
path: {root}
train: images/val
val: images/val
names:
  0: pip
"""


def build(out_dir, yaml_template, source_images):
    out = Path(out_dir)
    (out / "images" / "val").mkdir(parents=True, exist_ok=True)
    (out / "labels" / "val").mkdir(parents=True, exist_ok=True)
    for p in source_images:
        shutil.copy(p, out / "images" / "val" / p.name)
    (out / "dataset.yaml").write_text(yaml_template.format(root=out.resolve()))
    print(f"{len(source_images)} images -> {out}")


def main():
    tile_images = sorted(Path("eval/corpus_photos").glob("*.jpg"))[:40]
    build("train/data/calib_tiles", TILE_YAML, tile_images)

    pip_images = sorted(Path("train/data/face_crops").glob("*.jpg"))[:200]
    build("train/data/calib_pips", PIP_YAML, pip_images)


if __name__ == "__main__":
    main()
```

- [x] **Step 2: Run it**

Run: `cd /Users/peterabeln/Documents/github/petr0n/domino-counter-app && .venv/bin/python train/build_calibration_sets.py`

Expected output:
```
40 images -> train/data/calib_tiles
200 images -> train/data/calib_pips
```

- [x] **Step 3: Verify both dataset.yaml files load correctly**

Run:
```bash
.venv/bin/python3 -c "
from ultralytics.data.utils import check_det_dataset
d = check_det_dataset('train/data/calib_tiles/dataset.yaml')
print('tiles val images:', len(list(__import__('pathlib').Path(d['val']).glob('*.jpg'))))
d2 = check_det_dataset('train/data/calib_pips/dataset.yaml')
print('pips val images:', len(list(__import__('pathlib').Path(d2['val']).glob('*.jpg'))))
"
```
Expected: `tiles val images: 40` and `pips val images: 200`, no errors.

- [x] **Step 4: Commit**

```bash
git add train/build_calibration_sets.py
git commit -m "Add real-photo calibration dataset builder for int8 ONNX export"
```
(The generated `train/data/calib_*` directories are gitignored under the
existing `train/data/` pattern — only the builder script is tracked.)

---

### Task 2: Export both models to int8 ONNX

**Files:**
- Create: `train/export_onnx.py`
- Test: none (this task's own Step 3 is the verification — no separate test file)

**Interfaces:**
- Consumes: `runs/pose/touch/weights/best.pt`, `runs/detect/pipdet_hn/weights/best.pt`,
  `train/data/calib_tiles/dataset.yaml`, `train/data/calib_pips/dataset.yaml` (Task 1)
- Produces: `runs/pose/touch/weights/best_int8.onnx`, `runs/detect/pipdet_hn/weights/best_int8.onnx`
  (int8, verified output shapes `(1,17,8400)` and `(1,5,3024)` respectively)

- [x] **Step 1: Write the export script**

```python
#!/usr/bin/env python3
"""Export the production tile/pip detectors to int8 ONNX for on-device use
(M2). Exact API verified against the installed ultralytics==8.4.96 --
`quantize=8` + `data=<calibration dataset.yaml>`, NOT the commonly-documented
`int8=True` (that flag doesn't exist in this version).

Usage:
  .venv/bin/python train/export_onnx.py
"""
from ultralytics import YOLO


def main():
    tile = YOLO("runs/pose/touch/weights/best.pt")
    tile_path = tile.export(format="onnx", quantize=8,
                            data="train/data/calib_tiles/dataset.yaml",
                            imgsz=640, simplify=True)
    print("tile detector exported:", tile_path)

    pip = YOLO("runs/detect/pipdet_hn/weights/best.pt")
    pip_path = pip.export(format="onnx", quantize=8,
                          data="train/data/calib_pips/dataset.yaml",
                          imgsz=384, simplify=True)
    print("pip detector exported:", pip_path)


if __name__ == "__main__":
    main()
```

- [x] **Step 2: Run it**

Run: `.venv/bin/python train/export_onnx.py`

Expected: two `ONNX: export success` lines, ending with:
```
tile detector exported: runs/pose/touch/weights/best_int8.onnx
pip detector exported: runs/detect/pipdet_hn/weights/best_int8.onnx
```
Takes roughly 30-40s per model. Total exported size should be well under
10MB combined (verified during design research: ~3.1MB + ~2.8MB = ~5.9MB).

- [x] **Step 3: Verify output shapes and value ranges via onnxruntime**

```python
# scratch check, not a committed file -- run directly:
import onnxruntime as ort
import numpy as np

for path, expected_shape in [
    ("runs/pose/touch/weights/best_int8.onnx", [1, 17, 8400]),
    ("runs/detect/pipdet_hn/weights/best_int8.onnx", [1, 5, 3024]),
]:
    sess = ort.InferenceSession(path)
    out = sess.get_outputs()[0]
    assert list(out.shape) == expected_shape, f"{path}: got {out.shape}, expected {expected_shape}"
    print(path, "OK", out.shape)
```

Run: `.venv/bin/python3 -c "$(cat above)"` (or paste into a `-c` call).
Expected: `OK` printed for both paths, matching the exact shapes above.

- [x] **Step 4: Commit**

```bash
git add train/export_onnx.py
git commit -m "Add int8 ONNX export script for tile/pip detectors"
```
(The `.onnx` files themselves live under `runs/`, already gitignored — not
committed. They get regenerated by running this script.)

---

### Task 3: `scanner/preprocess.js` — letterbox math

**Files:**
- Create: `scanner/preprocess.js`
- Test: `scanner/test/preprocess.test.js`

**Interfaces:**
- Produces: `computeLetterboxParams(srcW, srcH, targetSize) -> {scale, newW, newH, padLeft, padTop}`,
  `unletterboxPoint(x, y, params) -> {x, y}`, `letterboxImage(imageData, targetSize, canvasFactory) -> {imageData, params}`
  (all named exports from `scanner/preprocess.js`)
- Consumed by: Task 7 (`scanner/index.js`)

- [x] **Step 1: Write the failing test**

```js
// scanner/test/preprocess.test.js
import assert from 'node:assert';
import { computeLetterboxParams, unletterboxPoint } from '../preprocess.js';

// Fixture verified 2026-07-23 against Ultralytics' actual LetterBox.get_params
// for a 4000x2252 photo -> imgsz 640 (auto=False, the default .predict() uses):
// r = min(640/2252, 640/4000) = 0.16; new_unpad = (640, 360);
// dw,dh = (0, 280); centered -> padLeft=0, padTop=140.
{
  const p = computeLetterboxParams(4000, 2252, 640);
  assert.strictEqual(p.scale, 0.16, `scale: got ${p.scale}`);
  assert.strictEqual(p.newW, 640, `newW: got ${p.newW}`);
  assert.strictEqual(p.newH, 360, `newH: got ${p.newH}`);
  assert.strictEqual(p.padLeft, 0, `padLeft: got ${p.padLeft}`);
  assert.strictEqual(p.padTop, 140, `padTop: got ${p.padTop}`);
  console.log('computeLetterboxParams: PASS');
}

// A point at (320, 320) in letterboxed 640x640 space maps back to original
// space: x=(320-0)/0.16=2000, y=(320-140)/0.16=1125.
{
  const pt = unletterboxPoint(320, 320, { scale: 0.16, padLeft: 0, padTop: 140 });
  assert.strictEqual(pt.x, 2000, `x: got ${pt.x}`);
  assert.strictEqual(pt.y, 1125, `y: got ${pt.y}`);
  console.log('unletterboxPoint: PASS');
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `node scanner/test/preprocess.test.js`
Expected: `Error [ERR_MODULE_NOT_FOUND]` — `scanner/preprocess.js` doesn't exist yet.

- [x] **Step 3: Write the implementation**

```js
// scanner/preprocess.js
// Letterbox resize+pad to a square target size, matching Ultralytics'
// LetterBox(auto=False, scale_fill=False, scaleup=True, center=True,
// padding_value=114) -- verified 2026-07-23 as the exact behavior of
// model.predict() with rect=False, which train/predict.py relies on
// unchanged (rect is never set anywhere in this repo, so it's the default).

export function computeLetterboxParams(srcW, srcH, targetSize) {
  const scale = Math.min(targetSize / srcW, targetSize / srcH);
  const newW = Math.round(srcW * scale);
  const newH = Math.round(srcH * scale);
  const dw = targetSize - newW;
  const dh = targetSize - newH;
  const padLeft = Math.round(dw / 2 - 0.1);
  const padTop = Math.round(dh / 2 - 0.1);
  return { scale, newW, newH, padLeft, padTop };
}

export function unletterboxPoint(x, y, params) {
  return {
    x: (x - params.padLeft) / params.scale,
    y: (y - params.padTop) / params.scale,
  };
}

// canvasFactory: (w, h) => { canvas, ctx } -- injected so this stays
// dependency-free here; the harness (Task 9) passes an OffscreenCanvas
// factory. imageData: {data: Uint8ClampedArray (RGBA), width, height}.
export function letterboxImage(imageData, targetSize, canvasFactory) {
  const { width: w, height: h } = imageData;
  const params = computeLetterboxParams(w, h, targetSize);
  const src = canvasFactory(w, h);
  src.ctx.putImageData(imageData, 0, 0);
  const dst = canvasFactory(targetSize, targetSize);
  dst.ctx.fillStyle = 'rgb(114,114,114)';
  dst.ctx.fillRect(0, 0, targetSize, targetSize);
  dst.ctx.drawImage(src.canvas, 0, 0, w, h,
                    params.padLeft, params.padTop, params.newW, params.newH);
  return { imageData: dst.ctx.getImageData(0, 0, targetSize, targetSize), params };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node scanner/test/preprocess.test.js`
Expected:
```
computeLetterboxParams: PASS
unletterboxPoint: PASS
```

- [x] **Step 5: Commit**

```bash
git add scanner/preprocess.js scanner/test/preprocess.test.js
git commit -m "Add scanner/preprocess.js: letterbox math ported from Ultralytics default preprocessing"
```

---

### Task 4: `scanner/decode.js` — raw ONNX output → boxes/keypoints

**Files:**
- Create: `scanner/decode.js`
- Test: `scanner/test/decode.test.js`

**Interfaces:**
- Produces: `decodeDetections(data, channels, numAnchors, confThreshold, numKeypoints = 0) -> Array<{box: [x0,y0,x1,y1], score, keypoints: Array<{x,y,visibility}>}>`
- Consumed by: Task 7 (`scanner/index.js`)

- [x] **Step 1: Write the failing test**

```js
// scanner/test/decode.test.js
import assert from 'node:assert';
import { decodeDetections } from '../decode.js';

// Plain-detection fixture (pip detector shape): channels=5, numAnchors=3.
// Hand-computed: anchor0 score=0.9 (kept), anchor1 score=0.3 (dropped,
// below 0.5 threshold), anchor2 score=0.6 (kept).
{
  const data = new Float32Array([
    10, 50, 100,   // cx
    10, 50, 100,   // cy
    4, 4, 4,       // w
    4, 4, 4,       // h
    0.9, 0.3, 0.6, // score
  ]);
  const dets = decodeDetections(data, 5, 3, 0.5);
  assert.strictEqual(dets.length, 2, `expected 2 detections, got ${dets.length}`);
  assert.deepStrictEqual(dets[0].box, [8, 8, 12, 12], `box0: ${dets[0].box}`);
  assert.strictEqual(dets[0].score, 0.9);
  assert.deepStrictEqual(dets[1].box, [98, 98, 102, 102], `box1: ${dets[1].box}`);
  assert.strictEqual(dets[1].score, 0.6);
  console.log('decodeDetections (plain): PASS');
}

// Pose fixture (tile detector shape, 1 keypoint for brevity): channels=8
// (4 box + 1 class + 3 kpt), numAnchors=2. Both anchors above threshold.
{
  const data = new Float32Array([
    20, 60,    // cx
    20, 60,    // cy
    4, 4,      // w
    4, 4,      // h
    0.9, 0.9,  // score
    21, 61,    // kp1 x
    19, 59,    // kp1 y
    0.95, 0.5, // kp1 visibility
  ]);
  const dets = decodeDetections(data, 8, 2, 0.5, 1);
  assert.strictEqual(dets.length, 2);
  assert.deepStrictEqual(dets[0].box, [18, 18, 22, 22]);
  assert.deepStrictEqual(dets[0].keypoints, [{ x: 21, y: 19, visibility: 0.95 }]);
  assert.deepStrictEqual(dets[1].box, [58, 58, 62, 62]);
  assert.deepStrictEqual(dets[1].keypoints, [{ x: 61, y: 59, visibility: 0.5 }]);
  console.log('decodeDetections (pose): PASS');
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `node scanner/test/decode.test.js`
Expected: `Error [ERR_MODULE_NOT_FOUND]` — `scanner/decode.js` doesn't exist yet.

- [x] **Step 3: Write the implementation**

```js
// scanner/decode.js
// Decode a raw YOLO11 ONNX output tensor. Box coords, class score, and (for
// pose models) keypoint x/y/visibility are ALL already fully decoded by the
// exported graph -- verified empirically 2026-07-23 against the real
// pipdet_hn and touch int8 exports via onnxruntime: raw output columns are
// plain pixel-space values (box coords in [0, imgsz] range, scores/visibility
// in [0,1]), not distributional logits needing DFL/anchor decode. This
// function only transposes, thresholds, and converts cx/cy/w/h -> corners.
// NMS is NOT applied here -- see scanner/nms.js.

// data: Float32Array, length = channels * numAnchors, row-major
// [channel][anchor] (the ONNX output shape (1, channels, numAnchors) with
// the batch dim stripped, as returned directly by onnxruntime-web).
export function decodeDetections(data, channels, numAnchors, confThreshold, numKeypoints = 0) {
  const results = [];
  for (let a = 0; a < numAnchors; a++) {
    const score = data[4 * numAnchors + a]; // channel 4 = class score
    if (score < confThreshold) continue;
    const cx = data[0 * numAnchors + a];
    const cy = data[1 * numAnchors + a];
    const w = data[2 * numAnchors + a];
    const h = data[3 * numAnchors + a];
    const box = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
    const keypoints = [];
    for (let k = 0; k < numKeypoints; k++) {
      const base = (5 + k * 3) * numAnchors;
      keypoints.push({
        x: data[base + a],
        y: data[base + numAnchors + a],
        visibility: data[base + 2 * numAnchors + a],
      });
    }
    results.push({ box, score, keypoints });
  }
  return results;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node scanner/test/decode.test.js`
Expected:
```
decodeDetections (plain): PASS
decodeDetections (pose): PASS
```

- [x] **Step 5: Commit**

```bash
git add scanner/decode.js scanner/test/decode.test.js
git commit -m "Add scanner/decode.js: YOLO11 ONNX output decode"
```

---

### Task 5: `scanner/nms.js` — NMS + duplicate-detection dedup

**Files:**
- Create: `scanner/nms.js`
- Test: `scanner/test/nms.test.js`

**Interfaces:**
- Consumes: detection objects shaped like Task 4's output (`{box, score, keypoints}`)
- Produces: `boxIou(a, b) -> number`, `nms(detections, iouThreshold) -> Array<detection>`,
  `dedupConfidentDuplicates(detections, threshold = DUPLICATE_IOU_THRESHOLD) -> Array<detection>`,
  `DUPLICATE_IOU_THRESHOLD` (= 0.65, exported constant)
- Consumed by: Task 7 (`scanner/index.js`)

- [x] **Step 1: Write the failing test**

```js
// scanner/test/nms.test.js
import assert from 'node:assert';
import { boxIou, nms, dedupConfidentDuplicates } from '../nms.js';

// Fixture verified 2026-07-23 directly against train/predict.py's
// dedup_confident_duplicates on the same 3 boxes: A and B are genuinely
// touching (IoU 0.0 for this axis-aligned pair), C is a near-duplicate of
// A (IoU 0.9702, above the 0.65 threshold) with lower confidence -> dropped.
const boxes = [
  { box: [100, 100, 200, 300], score: 0.9, keypoints: [] },  // A
  { box: [205, 100, 305, 300], score: 0.85, keypoints: [] }, // B
  { box: [100, 100, 198, 298], score: 0.7, keypoints: [] },  // C
];

{
  const iouAB = boxIou(boxes[0].box, boxes[1].box);
  const iouAC = boxIou(boxes[0].box, boxes[2].box);
  assert.strictEqual(iouAB, 0, `iouAB: ${iouAB}`);
  assert.ok(Math.abs(iouAC - 0.9702) < 0.001, `iouAC: ${iouAC}`);
  console.log('boxIou: PASS');
}

{
  const kept = dedupConfidentDuplicates(boxes, 0.65);
  assert.strictEqual(kept.length, 2, `expected 2 kept, got ${kept.length}`);
  assert.deepStrictEqual(kept[0].box, [100, 100, 200, 300]);
  assert.deepStrictEqual(kept[1].box, [205, 100, 305, 300]);
  console.log('dedupConfidentDuplicates: PASS');
}

// Standard NMS at a much lower threshold should also collapse A+C (they
// overlap far more than a typical 0.5 NMS threshold too), independent of
// the dedup pass.
{
  const kept = nms(boxes, 0.5);
  assert.strictEqual(kept.length, 2, `expected 2 kept, got ${kept.length}`);
  console.log('nms: PASS');
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `node scanner/test/nms.test.js`
Expected: `Error [ERR_MODULE_NOT_FOUND]` — `scanner/nms.js` doesn't exist yet.

- [x] **Step 3: Write the implementation**

```js
// scanner/nms.js
// Standard greedy NMS + the post-NMS duplicate-detection cleanup, ported
// directly from train/predict.py's dedup_confident_duplicates (same file's
// module comment explains the 0.65 threshold choice: confirmed genuine
// touching-tile pairs sit at axis-aligned IoU ~0.05-0.09, confirmed
// same-tile duplicate pairs measured 0.65-0.73 on real eval photos).

export function boxIou(a, b) {
  const [ax0, ay0, ax1, ay1] = a;
  const [bx0, by0, bx1, by1] = b;
  const ix0 = Math.max(ax0, bx0), iy0 = Math.max(ay0, by0);
  const ix1 = Math.min(ax1, bx1), iy1 = Math.min(ay1, by1);
  const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
  const union = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - inter;
  return union > 0 ? inter / union : 0;
}

function greedyKeep(detections, threshold) {
  const order = detections.map((_, i) => i).sort((a, b) => detections[b].score - detections[a].score);
  const keptIdx = [];
  for (const i of order) {
    if (keptIdx.some(j => boxIou(detections[i].box, detections[j].box) > threshold)) continue;
    keptIdx.push(i);
  }
  return keptIdx;
}

// Single-class greedy NMS -- both scanner models emit exactly one class
// each, so no per-class grouping is needed. Matches the semantics of
// ultralytics' `iou` threshold (tile detector 0.75, pip detector 0.7 --
// see train/predict.py; those exact values are wired in Task 7, not here).
export function nms(detections, iouThreshold) {
  return greedyKeep(detections, iouThreshold).map(i => detections[i]);
}

export const DUPLICATE_IOU_THRESHOLD = 0.65;

export function dedupConfidentDuplicates(detections, threshold = DUPLICATE_IOU_THRESHOLD) {
  const keptIdx = greedyKeep(detections, threshold).sort((a, b) => a - b);
  return keptIdx.map(i => detections[i]);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node scanner/test/nms.test.js`
Expected:
```
boxIou: PASS
dedupConfidentDuplicates: PASS
nms: PASS
```

- [x] **Step 5: Commit**

```bash
git add scanner/nms.js scanner/test/nms.test.js
git commit -m "Add scanner/nms.js: NMS + duplicate-detection dedup ported from predict.py"
```

---

### Task 6: `scanner/geometry.js` — rectify + bar-split

**Files:**
- Create: `scanner/geometry.js`
- Test: `scanner/test/geometry.test.js`

**Interfaces:**
- Produces: `RECT_W` (=128), `RECT_H` (=256), `computeRectifyTransform(corners) -> {H, layout}`,
  `applyHomography(H, x, y) -> {x, y}`, `warpPerspective(src, H) -> {data, width, height}`,
  `barSplit(grayRows) -> {splitRow, tier}`
- Consumes: `corners: Array<{x, y}>` (4 points, in the tile detector's §5.4
  polar-angle winding order — no re-sorting needed, `computeRectifyTransform`
  re-derives its own winding internally exactly like `rectify.py` does)
- Consumed by: Task 7 (`scanner/index.js`)

- [x] **Step 1: Write the failing test**

```js
// scanner/test/geometry.test.js
import assert from 'node:assert';
import { computeRectifyTransform, applyHomography, barSplit, RECT_W, RECT_H } from '../geometry.js';

// Fixture verified 2026-07-23 directly against cv2.getPerspectiveTransform
// for a simple axis-aligned 100x200 source rectangle (corners in any order,
// as the tile detector would emit them) mapped to the padded RECT_W x
// RECT_H canvas: output center (64,128) samples from source (50,100)
// (the source rectangle's own center); the two padding corners map exactly
// to the source's opposite corners.
{
  const corners = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 0, y: 200 }];
  const { H, layout } = computeRectifyTransform(corners);
  assert.strictEqual(layout, 'vertical', `layout: ${layout}`);

  const center = applyHomography(H, RECT_W / 2, RECT_H / 2);
  assert.ok(Math.abs(center.x - 50) < 0.01, `center.x: ${center.x}`);
  assert.ok(Math.abs(center.y - 100) < 0.01, `center.y: ${center.y}`);

  const p = 0.06 * RECT_W; // PAD_FRAC * RECT_W
  const topLeftPad = applyHomography(H, p, p);
  assert.ok(Math.abs(topLeftPad.x - 0) < 0.01, `topLeftPad.x: ${topLeftPad.x}`);
  assert.ok(Math.abs(topLeftPad.y - 0) < 0.01, `topLeftPad.y: ${topLeftPad.y}`);

  const botRightPad = applyHomography(H, RECT_W - p, RECT_H - p);
  assert.ok(Math.abs(botRightPad.x - 100) < 0.01, `botRightPad.x: ${botRightPad.x}`);
  assert.ok(Math.abs(botRightPad.y - 200) < 0.01, `botRightPad.y: ${botRightPad.y}`);
  console.log('computeRectifyTransform + applyHomography: PASS');
}

// barSplit: a clean synthetic RECT_W x RECT_H grayscale image, white
// everywhere except a solid black horizontal bar at row 130 -- the peak
// must land unambiguously at that row regardless of minor Sobel
// border-handling differences from cv2's default.
{
  const rows = [];
  for (let y = 0; y < RECT_H; y++) {
    const isBar = y >= 128 && y < 132;
    rows.push(new Array(RECT_W).fill(isBar ? 0 : 255));
  }
  const { splitRow, tier } = barSplit(rows);
  assert.strictEqual(tier, 'sobel', `tier: ${tier}`);
  assert.ok(Math.abs(splitRow - 130) <= 2, `splitRow: ${splitRow}`);
  console.log('barSplit: PASS');
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `node scanner/test/geometry.test.js`
Expected: `Error [ERR_MODULE_NOT_FOUND]` — `scanner/geometry.js` doesn't exist yet.

- [x] **Step 3: Write the implementation**

```js
// scanner/geometry.js
// Ported from train/domino_synth/rectify.py -- that file's own docstring
// calls for this port ("Ported to JS for on-device use at M2 -- keep it
// dependency-light"). RECT_W/RECT_H/PAD_FRAC match the Python constants
// exactly; changing either side without the other breaks Stage-2 pip
// counting (the model was trained on this exact aspect ratio/padding).
export const RECT_W = 128, RECT_H = 256;
const PAD_FRAC = 0.06;

function cross2d(o, a) { return o.x * a.y - o.y * a.x; }

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// Gaussian elimination with partial pivoting -- used to solve the 8x8
// linear system behind a 3x3 perspective transform (same underlying math
// as cv2.getPerspectiveTransform).
function solveLinearSystem(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function getPerspectiveTransform(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]); b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]); b.push(dy);
  }
  const h = solveLinearSystem(A, b);
  return [...h, 1]; // h33 fixed at 1
}

export function applyHomography(H, x, y) {
  const [a, b, c, d, e, f, g, h] = H;
  const w = g * x + h * y + 1;
  return { x: (a * x + b * y + c) / w, y: (d * x + e * y + f) / w };
}

// corners: 4 {x,y} in source-image pixel coords, in the tile detector's
// §5.4 winding order (any starting point works -- this re-derives its own
// canonical winding internally, exactly like rectify.py does). Returns
// {H, layout} where H maps OUTPUT (RECT_W x RECT_H) pixel coords back into
// SOURCE image coords (verified 2026-07-23: this is the same direction
// cv2.warpPerspective samples in internally, i.e.
// inv(cv2.getPerspectiveTransform(src, dst)) == cv2.getPerspectiveTransform(dst, src),
// so computing it directly in this direction needs no separate inversion step).
export function computeRectifyTransform(corners) {
  const cx = corners.reduce((s, p) => s + p.x, 0) / 4;
  const cy = corners.reduce((s, p) => s + p.y, 0) / 4;
  const withAngle = corners.map(p => ({
    x: p.x, y: p.y,
    angle: (Math.atan2(p.y - cy, p.x - cx) + 2 * Math.PI) % (2 * Math.PI),
  }));
  const q = [...withAngle].sort((a, b) => a.angle - b.angle); // wound quad

  const e01 = dist(q[0], q[1]), e12 = dist(q[1], q[2]);
  let ends = e01 >= e12 ? [[q[1], q[2]], [q[3], q[0]]] : [[q[0], q[1]], [q[2], q[3]]];

  let m0 = { x: (ends[0][0].x + ends[0][1].x) / 2, y: (ends[0][0].y + ends[0][1].y) / 2 };
  let m1 = { x: (ends[1][0].x + ends[1][1].x) / 2, y: (ends[1][0].y + ends[1][1].y) / 2 };
  let axis = { x: m1.x - m0.x, y: m1.y - m0.y };
  const layout = Math.abs(axis.y) >= Math.abs(axis.x) ? 'vertical' : 'horizontal';
  const key = layout === 'vertical' ? 'y' : 'x';
  if (m0[key] > m1[key]) { ends = [ends[1], ends[0]]; }

  m0 = { x: (ends[0][0].x + ends[0][1].x) / 2, y: (ends[0][0].y + ends[0][1].y) / 2 };
  m1 = { x: (ends[1][0].x + ends[1][1].x) / 2, y: (ends[1][0].y + ends[1][1].y) / 2 };
  axis = { x: m1.x - m0.x, y: m1.y - m0.y };
  const [tl, tr] = cross2d(axis, { x: ends[0][0].x - m0.x, y: ends[0][0].y - m0.y }) > 0
    ? [ends[0][0], ends[0][1]] : [ends[0][1], ends[0][0]];
  const [bl, br] = cross2d(axis, { x: ends[1][0].x - m1.x, y: ends[1][0].y - m1.y }) > 0
    ? [ends[1][0], ends[1][1]] : [ends[1][1], ends[1][0]];

  const p = PAD_FRAC * RECT_W;
  const src = [tl, tr, br, bl];
  const dst = [{ x: p, y: p }, { x: RECT_W - p, y: p },
               { x: RECT_W - p, y: RECT_H - p }, { x: p, y: RECT_H - p }];
  const H = getPerspectiveTransform(dst, src);
  return { H, layout };
}

function sample(src, x, y, ch) {
  x = Math.max(0, Math.min(src.width - 1, x));
  y = Math.max(0, Math.min(src.height - 1, y));
  return src.data[(y * src.width + x) * 4 + ch];
}

function bilinear(src, x0, y0, fx, fy, ch) {
  const v00 = sample(src, x0, y0, ch), v10 = sample(src, x0 + 1, y0, ch);
  const v01 = sample(src, x0, y0 + 1, ch), v11 = sample(src, x0 + 1, y0 + 1, ch);
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}

// src: {data: Uint8ClampedArray (RGBA), width, height}. Returns a
// RECT_W x RECT_H RGBA image in the same shape.
export function warpPerspective(src, H) {
  const out = new Uint8ClampedArray(RECT_W * RECT_H * 4);
  for (let oy = 0; oy < RECT_H; oy++) {
    for (let ox = 0; ox < RECT_W; ox++) {
      const { x: sx, y: sy } = applyHomography(H, ox, oy);
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      const oi = (oy * RECT_W + ox) * 4;
      for (let ch = 0; ch < 4; ch++) out[oi + ch] = bilinear(src, x0, y0, fx, fy, ch);
    }
  }
  return { data: out, width: RECT_W, height: RECT_H };
}

// Direct port of bar_split(): Sobel-Y edge-magnitude profile, strongest
// peak within the middle 38%-62% band, geometric-midpoint fallback if no
// peak clearly beats the crop's typical edge response.
// grayRows: array of RECT_H rows, each an array/typed-array of RECT_W values.
export function barSplit(grayRows) {
  const h = grayRows.length, w = grayRows[0].length;
  const profile = new Array(h).fill(0);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
    let sum = 0;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
      const g = -grayRows[y0][x0] - 2 * grayRows[y0][x] - grayRows[y0][x1]
              + grayRows[y1][x0] + 2 * grayRows[y1][x] + grayRows[y1][x1];
      sum += Math.abs(g);
    }
    profile[y] = sum / w;
  }
  const lo = Math.floor(h * 0.38), hi = Math.floor(h * 0.62);
  let peak = lo, peakVal = -Infinity;
  for (let y = lo; y < hi; y++) if (profile[y] > peakVal) { peakVal = profile[y]; peak = y; }
  const sorted = [...profile].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (peakVal > 2.5 * (median + 1e-6)) return { splitRow: peak, tier: 'sobel' };
  return { splitRow: Math.floor(h / 2), tier: 'midpoint' };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node scanner/test/geometry.test.js`
Expected:
```
computeRectifyTransform + applyHomography: PASS
barSplit: PASS
```

- [x] **Step 5: Commit**

```bash
git add scanner/geometry.js scanner/test/geometry.test.js
git commit -m "Add scanner/geometry.js: rectify + bar-split ported from rectify.py"
```

---

### Task 7: `scanner/index.js` — `init()` / `scanImage()`

**Files:**
- Create: `scanner/index.js`

**Interfaces:**
- Consumes: `scanner/preprocess.js`, `scanner/decode.js`, `scanner/nms.js`,
  `scanner/geometry.js` (Tasks 3-6); `onnxruntime-web`'s global `ort` object
  (loaded by the page that imports this module — see Task 9)
- Produces: `init({tileModelUrl, pipModelUrl}) -> Promise<void>`,
  `scanImage(imageData, canvasFactory) -> Promise<Array<{bbox, corners, predicted}>>`
  (matches the §5.4 shape `predict.py` already emits: `predicted: {first, second, confidence, firstConfidence, secondConfidence}`)

This task has no isolated unit test (it depends on `onnxruntime-web`, only
available in a browser/harness context) — it's verified end-to-end by
Task 10's parity check. Write it directly against the exact thresholds
verified in the Global Constraints section above.

- [x] **Step 1: Write the implementation**

```js
// scanner/index.js
// Public scanner API (CLAUDE.md architecture note): init() loads/caches the
// ONNX models, scanImage() runs the full two-stage pipeline. No DOM, no
// storage -- both are the caller's responsibility.
import { computeLetterboxParams, unletterboxPoint, letterboxImage } from './preprocess.js';
import { decodeDetections } from './decode.js';
import { nms, dedupConfidentDuplicates } from './nms.js';
import { computeRectifyTransform, applyHomography, warpPerspective, barSplit, RECT_W, RECT_H } from './geometry.js';

// Exact production thresholds -- verified 2026-07-23 against train/predict.py.
const TILE_IMGSZ = 640, TILE_CONF = 0.50, TILE_NMS_IOU = 0.75;
const PIP_IMGSZ = 384, PIP_CONF = 0.85, PIP_NMS_IOU = 0.7;

let tileSession = null, pipSession = null;

export async function init({ tileModelUrl, pipModelUrl }) {
  tileSession = await ort.InferenceSession.create(tileModelUrl);
  pipSession = await ort.InferenceSession.create(pipModelUrl);
}

function imageDataToTensor(imageData) {
  const { data, width, height } = imageData;
  const chw = new Float32Array(3 * width * height);
  for (let i = 0; i < width * height; i++) {
    chw[i] = data[i * 4] / 255;                         // R
    chw[width * height + i] = data[i * 4 + 1] / 255;     // G
    chw[2 * width * height + i] = data[i * 4 + 2] / 255; // B
  }
  return new ort.Tensor('float32', chw, [1, 3, height, width]);
}

async function detectTiles(imageData, canvasFactory) {
  const { imageData: letterboxed, params } = letterboxImage(imageData, TILE_IMGSZ, canvasFactory);
  const tensor = imageDataToTensor(letterboxed);
  const outputs = await tileSession.run({ images: tensor });
  const data = outputs.output0.data;
  const numAnchors = outputs.output0.dims[2];
  let dets = decodeDetections(data, 17, numAnchors, TILE_CONF, 4);
  dets = nms(dets, TILE_NMS_IOU);
  dets = dedupConfidentDuplicates(dets);
  // map box + keypoints from letterboxed space back to original image space
  return dets.map(d => ({
    bbox: unletterboxBox(d.box, params),
    corners: d.keypoints.map(k => unletterboxPoint(k.x, k.y, params)),
    confidence: d.score,
  }));
}

function unletterboxBox([x0, y0, x1, y1], params) {
  const p0 = unletterboxPoint(x0, y0, params);
  const p1 = unletterboxPoint(x1, y1, params);
  return { x: p0.x, y: p0.y, width: p1.x - p0.x, height: p1.y - p0.y };
}

async function countPips(tileImageData, corners, canvasFactory) {
  const { H, layout } = computeRectifyTransform(corners);
  const rectified = warpPerspective(tileImageData, H);

  const grayRows = [];
  for (let y = 0; y < RECT_H; y++) {
    const row = new Array(RECT_W);
    for (let x = 0; x < RECT_W; x++) {
      const i = (y * RECT_W + x) * 4;
      row[x] = 0.299 * rectified.data[i] + 0.587 * rectified.data[i + 1] + 0.114 * rectified.data[i + 2];
    }
    grayRows.push(row);
  }
  const { splitRow } = barSplit(grayRows);

  const { imageData: letterboxed, params } = letterboxImage(rectified, PIP_IMGSZ, canvasFactory);
  const tensor = imageDataToTensor(letterboxed);
  const outputs = await pipSession.run({ images: tensor });
  const data = outputs.output0.data;
  const numAnchors = outputs.output0.dims[2];
  let dets = decodeDetections(data, 5, numAnchors, PIP_CONF, 0);
  dets = nms(dets, PIP_NMS_IOU);

  let first = 0, second = 0, firstConfSum = 0, secondConfSum = 0;
  for (const d of dets) {
    const cy = (d.box[1] + d.box[3]) / 2;
    const backY = unletterboxPoint(0, cy, params).y; // back into rectified-crop space
    if (backY < splitRow) { first++; firstConfSum += d.score; }
    else { second++; secondConfSum += d.score; }
  }
  const firstConfidence = first ? firstConfSum / first : 0.9;
  const secondConfidence = second ? secondConfSum / second : 0.9;
  return {
    first: Math.min(first, 12), second: Math.min(second, 12),
    firstConfidence, secondConfidence,
    confidence: Math.min(firstConfidence, secondConfidence),
    layout,
  };
}

// imageData: {data: Uint8ClampedArray (RGBA), width, height} for the full
// source photo. canvasFactory: (w,h) => {canvas, ctx}, injected (Task 9
// supplies an OffscreenCanvas-backed one).
export async function scanImage(imageData, canvasFactory) {
  const tiles = await detectTiles(imageData, canvasFactory);
  const results = [];
  for (const tile of tiles) {
    let predicted = { first: 0, second: 0, confidence: tile.confidence };
    if (tile.corners.length === 4) {
      const pip = await countPips(imageData, tile.corners, canvasFactory);
      predicted = {
        first: pip.first, second: pip.second,
        firstConfidence: pip.firstConfidence, secondConfidence: pip.secondConfidence,
        confidence: tile.confidence * pip.confidence,
      };
    }
    results.push({ bbox: tile.bbox, corners: tile.corners, predicted });
  }
  return results;
}
```

- [x] **Step 2: Commit**

```bash
git add scanner/index.js
git commit -m "Add scanner/index.js: init()/scanImage() tying the ported pipeline together"
```

(No test-run step here — this module needs `ort` and canvas APIs that only
exist in a browser context. Task 10's parity check is its real test.)

---

### Task 8: Python reference-output generator

**Files:**
- Create: `train/gen_parity_reference.py`
- Create (generated): `train/data/parity_photos.json` (list of chosen photo IDs, committed so Task 10 uses the exact same set)

**Interfaces:**
- Consumes: `train/predict.py` (unchanged, existing module)
- Produces: `runs/parity_reference.json` — same shape as `predict.py`'s
  `--out` JSON, restricted to the chosen sample

- [x] **Step 1: Write the photo-selection + reference-generation script**

```python
#!/usr/bin/env python3
"""Select ~12 representative eval photos and generate the Python reference
output for the M2 ONNX parity check (Task 10). Reuses the EXISTING,
unmodified predict.py pipeline -- this is the "ground truth" the JS harness
gets compared against.

Usage:
  .venv/bin/python train/gen_parity_reference.py
"""
import json
import subprocess
from collections import Counter
from pathlib import Path

truth = json.load(open("eval/corpus_merged.json"))

# Pick photos covering a range of tile counts (1, few, many) and a spread of
# pip values (not all-low, not all-high), deterministic (sorted, not random).
by_count = sorted(truth, key=lambda r: len(r["tiles"]))
chosen = set()
for rec in by_count[:3]:       # smallest photos (1-2 tiles)
    chosen.add(rec["imageId"])
for rec in by_count[len(by_count) // 2 - 1: len(by_count) // 2 + 2]:  # mid-size
    chosen.add(rec["imageId"])
for rec in by_count[-3:]:      # largest photos (most tiles)
    chosen.add(rec["imageId"])
# a few more spread through the middle for pip-value variety
step = len(by_count) // 6
for i in range(0, len(by_count), step):
    chosen.add(by_count[i]["imageId"])
    if len(chosen) >= 12:
        break

chosen = sorted(chosen)[:15]
print(f"selected {len(chosen)} photos: {chosen}")
Path("train/data/parity_photos.json").write_text(json.dumps(chosen, indent=1))

# Copy just these photos into a temp dir so predict.py only processes them.
import shutil
tmp = Path("runs/parity_photos")
tmp.mkdir(parents=True, exist_ok=True)
for rec in truth:
    if rec["imageId"] in chosen:
        src = Path(rec["imagePath"])
        shutil.copy(src, tmp / src.name)

subprocess.run([
    ".venv/bin/python", "train/predict.py",
    "--weights", "runs/pose/touch/weights/best.pt",
    "--pip-detector-weights", "runs/detect/pipdet_hn/weights/best.pt",
    "--pip-detector-conf", "0.85",
    "--images", str(tmp),
    "--out", "runs/parity_reference.json",
], check=True)
```

- [x] **Step 2: Run it**

Run: `.venv/bin/python train/gen_parity_reference.py`

Expected: prints the selected photo IDs, then `predict.py`'s usual
per-image detection counts, ending with `wrote runs/parity_reference.json: <N> images, <M> detections`.

- [x] **Step 3: Commit**

```bash
git add train/gen_parity_reference.py train/data/parity_photos.json
git commit -m "Add M2 parity-check photo selection + Python reference generator"
```
(`runs/parity_reference.json` and `runs/parity_photos/` are gitignored under
the existing `runs/` pattern — regenerated by running the script.)

---

### Task 9: `harness.html` — throwaway browser test page

**Files:**
- Create: `harness.html` (repo root)

**Interfaces:**
- Consumes: `scanner/index.js` (Task 7), `onnxruntime-web` (CDN),
  `runs/pose/touch/weights/best_int8.onnx` + `runs/detect/pipdet_hn/weights/best_int8.onnx` (Task 2)
- Produces: an on-page JSON dump of `scanImage()` results per photo, plus
  per-photo and total timing, for Tasks 10-11 to read

- [x] **Step 1: Write the harness page**

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>M2 scanner harness (throwaway)</title>
<script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js"></script>
</head>
<body>
<h1>M2 scanner harness</h1>
<p>Loads the int8 ONNX models, runs scanImage() on each listed photo, and
logs per-photo results + timing. Not part of the shipped app -- M3 builds
the real UI separately.</p>
<input type="file" id="files" multiple accept="image/*">
<pre id="out"></pre>
<script type="module">
import { init, scanImage } from './scanner/index.js';

function canvasFactory(w, h) {
  const canvas = new OffscreenCanvas(w, h);
  return { canvas, ctx: canvas.getContext('2d') };
}

async function fileToImageData(file) {
  const bitmap = await createImageBitmap(file);
  const { canvas, ctx } = canvasFactory(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

const out = document.getElementById('out');
const log = (msg) => { out.textContent += msg + '\n'; console.log(msg); };

let ready = init({
  tileModelUrl: 'runs/pose/touch/weights/best_int8.onnx',
  pipModelUrl: 'runs/detect/pipdet_hn/weights/best_int8.onnx',
}).then(() => log('models loaded'));

document.getElementById('files').addEventListener('change', async (e) => {
  await ready;
  const results = {};
  let totalMs = 0;
  for (const file of e.target.files) {
    const imageData = await fileToImageData(file);
    const t0 = performance.now();
    const tiles = await scanImage(imageData, canvasFactory);
    const ms = performance.now() - t0;
    totalMs += ms;
    const imageId = file.name.replace(/\.[^.]+$/, '');
    results[imageId] = tiles;
    log(`${file.name}: ${tiles.length} tiles, ${ms.toFixed(0)}ms`);
  }
  log(`\ntotal: ${totalMs.toFixed(0)}ms over ${e.target.files.length} photos, avg ${(totalMs / e.target.files.length).toFixed(0)}ms/photo`);
  log('\nJSON:\n' + JSON.stringify(results, null, 1));
});
</script>
</body>
</html>
```

- [x] **Step 2: Serve it locally and smoke-test**

Run: `cd /Users/peterabeln/Documents/github/petr0n/domino-counter-app && python3 -m http.server 8765`

Open `http://localhost:8765/harness.html` in a desktop browser, pick 1-2
photos from `eval/corpus_photos/` via the file input.
Expected: "models loaded" logs, then per-photo lines like
`1000012917.jpg: 8 tiles, 340ms`, no console errors. If `ort` fails to
load, check the CDN URL/version is reachable; if `scanImage` throws, the
error message names which module/function failed — fix before continuing
to Task 10.

**2026-07-23 note:** static resources verified serving correctly (200 on
harness.html, both `best_int8.onnx` models, scanner/index.js). A headless
Chrome smoke test (via a throwaway `harness_autotest.html`, since deleted
— not part of this plan) confirmed `init()` successfully loads both ONNX
models through `onnxruntime-web` in a real browser engine. Full
end-to-end automated verification (fetch photo → scanImage → results)
was not reliably achievable — headless Chrome's `--dump-dom` +
`--virtual-time-budget` proved unreliable against real WASM/fetch async
work (one run hung entirely), and no browser-automation tool (e.g.
Playwright/CDP client) is available in this environment. **The
interactive open-and-click check as written above still needs to happen**
— either manually, or via a proper CDP-based automation tool if one
becomes available — before trusting Task 10's parity numbers.

- [x] **Step 3: Commit**

```bash
git add harness.html
git commit -m "Add throwaway harness.html for M2 parity check + phone perf probe"
```

---

### Task 10: Parity verification

**Files:**
- Modify: `harness.html` (add a comparison mode)
- Create: `train/compare_parity.py`

**Interfaces:**
- Consumes: `runs/parity_reference.json` (Task 8), a JSON export of the
  harness's own results (Task 9, copy-pasted or saved from the page)

- [x] **Step 1: Run the harness on the exact parity photo set**

Run: `.venv/bin/python3 -c "import json; print(' '.join(json.load(open('train/data/parity_photos.json'))))"`
to list the chosen photo IDs, then in the browser (harness open at
`http://localhost:8765/harness.html`) select those exact files from
`eval/corpus_photos/` via the file input.

Expected: the page logs a JSON blob at the end. Copy it and save as
`runs/harness_output.json` (a plain `{imageId: [...]}` object).

- [x] **Step 2: Write the comparison script**

```python
#!/usr/bin/env python3
"""Compare the browser harness's output against the Python reference for
the M2 parity check (Task 10). Match = same tile identities, same pip
counts, confidences in the same ballpark -- per the design spec, this is
verifying the ONNX/JS port is numerically faithful, not re-measuring
accuracy against ground truth.

Usage:
  .venv/bin/python train/compare_parity.py
"""
import json

reference = {p["imageId"]: p["tiles"] for p in json.load(open("runs/parity_reference.json"))}
harness = json.load(open("runs/harness_output.json"))

mismatches = 0
for image_id, ref_tiles in reference.items():
    harness_tiles = harness.get(image_id, [])
    if len(harness_tiles) != len(ref_tiles):
        print(f"{image_id}: tile count mismatch — reference {len(ref_tiles)}, harness {len(harness_tiles)}")
        mismatches += 1
        continue
    # match by nearest bbox center (both should be in the same order/count if all is well)
    for i, (ref_t, h_t) in enumerate(zip(ref_tiles, harness_tiles)):
        rp, hp = ref_t["predicted"], h_t["predicted"]
        ref_pair = sorted([rp["first"], rp["second"]])
        h_pair = sorted([hp["first"], hp["second"]])
        if ref_pair != h_pair:
            print(f"{image_id} tile {i}: reference {rp['first']}/{rp['second']} "
                  f"vs harness {hp['first']}/{hp['second']}")
            mismatches += 1

print(f"\n{mismatches} mismatches across {len(reference)} photos")
```

- [x] **Step 3: Run it and interpret**

Run: `.venv/bin/python train/compare_parity.py`

If `0 mismatches`: parity confirmed, move to Task 11.

If mismatches are reported: read each one — a tile-count mismatch usually
means the tile-detector NMS/conf/letterbox path has a bug (check
`TILE_CONF`/`TILE_NMS_IOU` in `scanner/index.js` match `predict.py` exactly,
and re-verify the letterbox math against Task 3's fixture on that specific
photo's real dimensions). A pip-count mismatch on a matched tile usually
means the rectify/bar-split port has a bug (check `computeRectifyTransform`
against a hand-traced example for that tile's real corners) or the pip
detector's `PIP_CONF`/`PIP_NMS_IOU` don't match. Fix the specific module,
re-run Steps 1-3 until `0 mismatches` (or a small, understood, documented
residual — e.g. a single tile at a known-hard angle already flagged
elsewhere in the eval corpus).

- [x] **Step 4: Commit**

```bash
git add train/compare_parity.py
git commit -m "Add M2 parity comparison script; parity confirmed on the sample set"
```
(Only commit once Step 3 passes clean or with an understood, documented
residual — do not commit with silent unexplained mismatches.)

---

### Task 11: Real-phone performance probe

**Files:**
- Create: `docs/superpowers/notes/2026-07-23-m2-perf-results.md` (results write-up)

**Interfaces:** none — this task produces a measurement, not code.

- [x] **Step 1: Serve the harness reachable from a phone on the same network**

Run: `cd /Users/peterabeln/Documents/github/petr0n/domino-counter-app && python3 -m http.server 8765 --bind 0.0.0.0`

Find the Mac's local IP (`ipconfig getifaddr en0` on macOS) and note the URL:
`http://<mac-ip>:8765/harness.html`.

(HTTPS note: `getUserMedia`/camera isn't needed here since the harness uses
file upload, not the live camera — plain HTTP over the local network is
fine for this probe. Camera-specific HTTPS requirements are M3's concern.)

- [x] **Step 2: Open on the phone and run**

Open the URL on your phone's browser, select the same parity photo set
(or a few representative ones) via the file input, let it run.

- [x] **Step 3: Record the results**

```markdown
# M2 phone performance probe — 2026-07-23

**Device:** [phone model, browser + version]
**Network:** local Wi-Fi, harness served from Mac via `python3 -m http.server`

**Per-photo timing (from harness.html's on-page log):**
[paste the logged per-photo ms lines]

**Against §8 budgets:**
| Metric | Budget | Measured | Pass? |
|---|---|---|---|
| End-to-end scan | ≤ ~2s | | |
| Detection pass | ≤ ~300-500ms | | |
| Per-crop pip count | ≤ ~30-50ms | | |
| Total model download | ≤ ~10-15MB | [sum of the two .onnx file sizes] | |

**Verdict:** [pass / fail / marginal — and what that means for M3]
```

Fill in the actual measured numbers from Step 2. If total end-to-end time
per photo isn't directly comparable to "one detection + one pip count" (a
multi-tile photo runs the pip detector once per tile), note that in the
write-up and estimate the per-stage breakdown from the timing if possible
(e.g., single-tile photos isolate detection-pass-only timing cleanly).

- [x] **Step 4: Commit**

```bash
mkdir -p docs/superpowers/notes
git add docs/superpowers/notes/2026-07-23-m2-perf-results.md
git commit -m "Record M2 real-phone performance probe results"
```

This is the milestone's actual answer — per the design spec, a failure here
is a legitimate, useful outcome (surfaces a perf dead-end before M3 UI work
is built on top of it), not something to silently work around within this
task.

---

## Self-Review Notes

- **Spec coverage:** int8 export (Tasks 1-2) ✓, JS geometry port (Tasks 3-6)
  ✓, harness (Task 9) ✓, parity verification (Task 10) ✓, phone perf probe
  (Task 11) ✓, calibration from real photos not synthetic (Task 1) ✓,
  explicitly-out-of-scope items (camera/UI/storage/Vite) not touched by any
  task ✓.
- **Placeholder scan:** no TBD/TODO; Task 11's write-up template has blanks
  by design (they're measurement results, filled in during that task's own
  Step 3, not deferred implementation).
- **Type/interface consistency:** checked `decodeDetections`'s signature
  matches between Task 4's definition and Task 7's two call sites (plain:
  `numKeypoints` omitted/0 for the pip detector; pose: `numKeypoints=4` for
  the tile detector). Checked `nms`/`dedupConfidentDuplicates` signatures
  match between Task 5 and Task 7's usage. Checked `RECT_W`/`RECT_H` are
  imported from `geometry.js` everywhere they're used (Task 7, Task 9's test
  fixtures) rather than re-declared.
