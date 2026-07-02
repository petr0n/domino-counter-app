# Domino Scanner — Phase 1 Build Plan

> **Status:** Active source of truth for the scanner build.
> **Companion:** `docs/web-first-phased-ml-plan-checklist.md` (operator checklist).

---

## 0. Approach in brief

We build an on-device ML scanner for domino tiles. The whole plan **lives or dies
on data**: a learned detector handles the long tail of backgrounds, lighting, and
angles through *data coverage* rather than hand-coded special cases — so the data
strategy (§4) comes before everything else. Because domino tiles are rigid, planar
objects with a known, finite appearance space, we can generate that data
synthetically (§4) and lean on the deterministic pip-grid geometry (§5.3) for the
brittle counting/assignment step. Discipline is eval-driven with no regressions
(§7).

---

## 1. Mission & scope (Phase 1)

**Mission:** from a phone photo of domino tiles, detect every tile and read its
pip values as accurately as practical, surfacing uncertain results for fast
human correction.

**In scope:** the scanner (detection + pip reading), Quick Scan as the iteration
surface, an editable review/correction step, local scan history, and a minimal
round/game flow.

**Out of scope for Phase 1** (see §14): catalog, accounts/auth, server-side
multiplayer sync, Postgres. Local-first (`localStorage` + `IndexedDB`) only.

**Tiles:** double-12 set — each half is **0–12 pips**. 91 unique tiles.

**Non-negotiable inherited rule:** **pip color is never a signal.** Sets use many
pip colors; the model and any preprocessing must be fully color-agnostic.

---

## 2. Core strategy on one page

The plan hangs on four load-bearing decisions. Everything else is detail.

1. **Synthetic-data-first.** Domino tiles are rigid, planar, and have a *known,
   finite* appearance space (91 faces, canonical pip grids). We render
   near-unlimited, perfectly-labeled training data with heavy domain
   randomization. Real photos are held out for **eval only**. This is what
   breaks the bootstrap paradox without a manual-labeling slog. (§4)

2. **Detect, don't classify — count pips via geometry.** Split the problem into
   two dead-simple object-detection tasks (a *tile* and a *pip*), then use the
   known grid geometry to assign pips to halves and count. This is far more
   data-efficient than teaching a model to recognize 91 specific tile faces, and
   synthetic data saturates it easily. (§5)

3. **Accuracy before deployment.** Prove the model hits accuracy targets on real
   held-out photos *anywhere convenient* (Colab/desktop) first. Only then port
   to on-device ONNX Runtime Web. Do not pay the in-browser-inference tax while
   the core question — "can a model read these tiles at all?" — is still open. (§6, §8)

4. **A hard, numeric kill-gate up front.** The single riskiest assumption
   (synthetic-trained models transfer to real photos) is tested first, cheapest,
   with a concrete pass/fail number and a date. If it fails, we pivot
   deliberately at a defined checkpoint rather than grinding open-endedly. (§6)

---

## 3. Key decisions & rationale (flag these — easy to flip)

These three reshape the whole plan. Each is a recommendation with rationale; if
you disagree with one, only its section changes.

| # | Decision | Chosen | Why | Alternative if flipped |
|---|----------|--------|-----|------------------------|
| D1 | Training data | **Synthetic primary; real = held-out eval only** | Biggest lever against another manual-labeling slog; known tile geometry makes rendering cheap and labels free | Synthetic + a small hand-labeled real fine-tune set (more robust, more work); or manual-only (highest labor) |
| D2 | Pip reading | **Count (detect pips + geometry), not identity classification** | Data-efficient; "a pip" is a trivial, uniform object synthetic data nails; validates against the known pip-grid geometry | Classify the ordered pair directly (simplest inference code, most data-hungry) |
| D3 | Deployment timing | **Decouple: accuracy milestone anywhere → on-device port later** | Removes integration tax from every early experiment; isolates the real risk (model quality) from the runtime risk (ONNX-in-browser) | Client-side ONNX from day one (every experiment runs in-browser) |

---

## 4. Data strategy

### 4.1 Synthetic generation (primary) — D1

A renderer produces labeled scenes procedurally:

- **Tile face:** draw a tile with two halves; place pips on the **canonical grid**
  for each half's value (0–9 → 3×3; 10–12 → 4×3, with the special centred
  11-middle-row). This is deterministic and known.
- **Randomize appearance (color-agnostic):** pip color (full spectrum, incl.
  white/black), tile body color (white, black, colored, marbled), gloss/specular,
  divider style, edge rounding, wear/scratches.
- **Compose scenes:** 1–N tiles, non-overlapping (tiles may touch edge-to-edge
  but **never overlap** — a hard domain rule we can rely on), random positions,
  rotations, and a random perspective homography.
- **Randomize capture conditions:** background image (diverse real-surface pool —
  wood, cloth, felt, grass, glare/white surfaces), lighting + cast shadows,
  color cast/white balance, motion/defocus blur, sensor noise, JPEG compression.
- **Auto-emit labels:** tile bounding boxes (oriented), per-pip boxes/points,
  per-half pip counts, orientation, ordered values — all free and exact.

**Renderer options (pick during M0):** 2D canvas/SVG compositing (fast, simple,
likely sufficient since tiles are planar) vs. a lightweight 3D render (Blender)
for more realistic lighting/perspective. Start 2D; escalate only if the sim-to-
real gap (§4.4) demands it.

**Background pool:** the single most important randomization axis — backgrounds
are the hardest part of tile detection. Gather a few hundred diverse surface photos
(CC-licensed texture sets plus deliberately hard surfaces: white cloth, glare,
grass, wood grain). Never let backgrounds be uniform.

### 4.2 Real data — held-out eval only (+ optional fine-tune)

- The **49-photo real eval set** is **held out** and never trained on. It is our
  honest read on the sim-to-real gap. (It is a smoke-test *floor*, not enough for
  per-tile precision — plan to grow it; see §7.)
- **Optional (D1 alternative):** if M0 shows a large sim-to-real gap, add a small
  hand-labeled real *training* set for fine-tuning — kept strictly separate from
  the eval set to avoid contamination.

### 4.3 Domain-randomization checklist (must all vary)

Background · lighting/shadows · white balance/color cast · tile body color · pip
color · gloss · tile count · position · rotation · perspective · blur · noise ·
JPEG artifacts · partial tiles at frame edge.

### 4.4 Sim-to-real gap — the top risk

Synthetic-only models can overfit to render artifacts and miss real texture.
Mitigations, in order of preference:
1. Aggressive domain randomization (§4.3) — the primary defense.
2. Photorealistic-enough backgrounds (real surface photos, not solid colors).
3. A small real fine-tune set (D1 alternative) if 1–2 aren't enough.
4. Always measure on the **real** held-out set so the gap is visible, never hidden.

The M0 gate (§6) exists specifically to measure this gap before we over-invest.

---

## 5. Model architecture — D2

Two object classes, then deterministic geometry. This keeps the learned part
trivial and the brittle part (counting/assignment) reuses the known grid model.

### 5.1 Stage 1 — tile detection (YOLO)

- **Task:** detect full domino tiles on the whole image. One class: `domino_tile`.
- **Output per tile:** bounding box (oriented preferred; axis-aligned + downstream
  rotation acceptable to start) + confidence.
- **Priority:** **recall over precision.** Missed tiles hurt the user more than
  easily-removable false positives (review handles extras).
- **Variant:** smallest YOLO variant that clears accuracy; size/latency matter for
  the eventual phone target (§8). Exact version = TBD (M0/M1).

### 5.2 Stage 2 — pip reading (count, not classify)

Two framings; **prove the baseline first, upgrade if needed.**

- **Baseline (simplest that could work):** crop each detected tile → find the
  divider (deterministic, §5.3) → a small CNN classifies each half's pip count as
  **0–12 (13-way softmax per half)**. Trained on synthetic crops. Counting
  generalizes better than identity memorization.
- **Target (more robust):** a **pip detector** (detect each pip as an object, or
  as keypoints) across the tile; assign pips to halves by geometry and count.
  Elegant because a "pip" is a uniform, trivial object synthetic data saturates,
  it yields natural per-pip confidence, and all counting is deterministic. The
  known grid model is a sanity check (counts must fit a valid 3×3/4×3 layout).

Recommendation: ship the baseline to clear M1, adopt the pip-detector target if
the baseline plateaus below the per-half accuracy gate.

### 5.3 Orientation & ordering — deterministic, not learned

The value model does **not** learn orientation. Geometry handles it:
- Orientation (horizontal/vertical) from the tile box aspect + divider axis.
- Ordered halves: **left→right** when horizontal, **top→bottom** when vertical.
- Divider location via a column/row intensity scan across the crop.

This shrinks what Stage 2 must learn to just "how many pips in this half."

### 5.4 Stage output contracts

**Detector (Stage 1) — per tile**
```json
{ "detectionId": "det_001", "sourceImageId": "img_001",
  "bbox": { "x": 120, "y": 240, "width": 88, "height": 176, "rotationDegrees": 3 },
  "detectionConfidence": 0.95 }
```

**Crop (Stage 2 input) — per tile**
```json
{ "detectionId": "det_001", "sourceImageId": "img_001",
  "thumbnailImageId": "thumb_001", "cropImageId": "crop_001",
  "bbox": { "x": 120, "y": 240, "width": 88, "height": 176 } }
```

**Pip reading (Stage 2 output) — per tile** (orientation/order from geometry)
```json
{ "detectionId": "det_001",
  "orientation": { "layout": "vertical", "rotationDegrees": 91,
                   "orderedSidesMeaning": ["top", "bottom"] },
  "predicted": { "first": 2, "second": 12, "display": "2/12",
                 "firstConfidence": 0.94, "secondConfidence": 0.90,
                 "confidence": 0.90 },
  "gridValid": true }
```
`gridValid` = counts fit a legal 3×3/4×3 layout (a cheap deterministic guard;
false → flag low-confidence for review).

---

## 6. Milestones & acceptance gates

Every gate is numeric and measured on the **real held-out eval set** (§7).
Targets below are proposed starting points — adjust once M0 gives a baseline.

### M0 — Sim-to-real spike (the kill-gate) · target: days, not weeks
Build the minimal synthetic renderer + train a small tile detector on **synthetic
only** → measure on the 49 real photos.
- **Pass:** tile detection **recall ≥ 0.70 @ IoU 0.5** on real photos.
- **Fail → pivot decision**, not more grinding: add a real fine-tune set (§4.2),
  improve rendering realism (§4.1), or reconsider the approach.
- This tests the single riskiest assumption (transfer) before any app work.

### M1 — Accuracy proven (anywhere; no app integration)
- Tile detection **recall ≥ 0.95 @ IoU 0.5**, precision reported (recall-biased OK).
- **Per-half pip accuracy ≥ 0.97.**
- **Exact-tile (identity) accuracy ≥ 0.90.**
- Orientation/order accuracy reported.

**Accuracy math — why review is load-bearing, not optional.** Exact-tile ≈
(per-half)². At 0.97/half → ~0.94/tile. For a 7-tile hand, P(all correct) ≈
0.94⁷ ≈ **0.65**. So even a strong model gets a full hand perfectly only ~2 of 3
times — **the correction UX (§9.2) is a first-class part of the product, not an
admission of failure.** This is why detection is recall-biased and every result
is editable.

### M2 — On-device deployment
Port M1 models to **ONNX Runtime Web**; verify:
- Output parity with the M1 (server) models on the eval crops.
- Phone budgets met: total model size, cold-load time, per-scan latency, memory
  (concrete numbers = TBD; set them from a real mid-range phone in M2).

### M3 — Quick Scan integration
Wire the on-device scanner into Quick Scan: camera + photo upload, multi-tile
detection, review/correction (§9.2), local history (§10). No regression vs. M1
accuracy on the eval set (now measured end-to-end through the real capture path).

### M4 — Minimal round/game flow
Lightweight local rounds (§9.3). Only after the scanner is stable.

**No milestone advances without its gate measured — never a number we didn't run.**

---

## 7. Evaluation methodology

- **Held-out real set:** the 49 photos, JSON annotations in-repo (§11). Never
  trained on. Treat as a floor and grow it toward multiple examples per tile.
- **Metrics reported every run:**
  - Detection: recall & precision @ IoU 0.5; count of missed tiles / false positives.
  - Value: per-half pip accuracy; **exact-tile identity accuracy** (`12/2` ==
    `2/12` for identity); orientation/order accuracy (scored *separately* from
    identity); full-photo exact-hand rate.
- **Identity vs. orientation are scored separately** so "found the right tile" and
  "read its order right" are distinguishable.
- **Regression rule:** no change ships that lowers a gate metric without an
  explicit, measured justification.

---

## 8. Deployment / runtime (M2) — D3

- **Where:** client-side, in-browser, on the phone. No required inference server
  for the scan path (privacy + no backend cost + offline-capable).
- **Runtime:** export to **ONNX**, run via **ONNX Runtime Web** (WASM baseline;
  WebGPU where available).
- **Size:** int8 quantization as needed to meet the phone size budget.
- **Budgets (set in M2 from a real device):** model size, cold-load, per-scan
  latency, memory. Smaller detector variants preferred even at some accuracy cost
  if they're what fits the phone.
- **Explicitly deferred, not decided:** a server-side inference fallback remains a
  possible *later* pivot if phone performance proves unacceptable — a deliberate
  change, not the default.

---

## 9. Product surfaces

### 9.1 Quick Scan (primary iteration surface)
Carry forward the useful `quick.html` feature set as the baseline: camera scan,
photo upload/load, multi-tile detection from one image, review before confirm,
per-tile edit, remove detection, per-tile + aggregate totals, visible history,
reset/clear, scan guidance messaging. Quick Scan is where scanner iteration
happens first; Round-end Scan (§9.3) may lag and converges on the same pipeline
later.

### 9.2 Review / correction UX (load-bearing — see M1 math)
After a scan:
- Each detection shown as its own thumbnail with editable values + confidence.
- **Edit existing detection:** two separate numeric inputs (map to left/right or
  top/bottom by orientation).
- **Add missing tile:** single slash-notation text input, e.g. `2/12` (fastest on
  phone).
- **Not Tile:** explicit action to invalidate a false positive (normalized
  internally to `status: "not_tile"`); a `.` placeholder may also mark invalid.
- False positives stay visible in history — they are valuable hard cases (§12).
- **Review preserves observed order** — never normalized to a canonical sort for
  display (canonical identity exists only for matching/eval).

### 9.3 Minimal round/game flow (M4, secondary)
Local only: typed display names remembered on-device; numbered rounds; each
player submits per round; exactly one winner (`I won`); non-winners `Scan my
tiles` (one full-hand scan → review → submit); a player can edit until the round
auto-finalizes (one winner + all non-winners submitted); then `Start Next Round`
(any player). No partial multi-scan merge in Phase 1.

---

## 10. Storage (local-first)

- **IndexedDB:** full original images, scan-history entries, detections,
  corrections, confidence, timestamps, rich JSON records. (Images belong here,
  not localStorage.)
- **localStorage:** lightweight settings, flags, preferences, optional recent-scan
  pointers.
- Postgres / true multi-device sync: **later**, not Phase 1.

---

## 11. Data model / schemas

Planning drafts, not final code. (Stage outputs are in §5.4.)

**Reviewed detection record**
```json
{ "id": "det_001", "status": "detected", "source": "model",
  "sourceImageId": "img_001", "thumbnailImageId": "thumb_001", "cropImageId": "crop_001",
  "bbox": { "x": 120, "y": 240, "width": 88, "height": 176 },
  "orientation": { "layout": "vertical", "rotationDegrees": 91,
                   "orderedSidesMeaning": ["top", "bottom"] },
  "predicted": { "first": 2, "second": 12, "display": "2/12", "confidence": 0.90 },
  "userCorrection": { "first": 2, "second": 12, "display": "2/12", "status": "confirmed" },
  "reviewFlags": { "notTile": false, "manuallyAdded": false } }
```

**Not-tile / invalid** — `status: "not_tile"`, `reviewFlags.notTile: true`,
`userCorrection.display: "."` (kept in history as a hard negative).

**Manually added tile** — `source: "manual"`, `bbox/predicted: null`,
`userCorrection: { first, second, display, status: "added" }`,
`reviewFlags.manuallyAdded: true`.

**Quick Scan history record**
```json
{ "scanId": "scan_...", "createdAt": "2026-06-30T18:42:11Z",
  "sourceImage": { "imageId": "img_001", "storage": "indexeddb",
                   "mimeType": "image/jpeg", "width": 3024, "height": 4032 },
  "scannerVersion": { "detector": "yolo-<ver>", "pipReader": "count-<ver>" },
  "detections": [ { "id": "det_001", "status": "detected" } ],
  "finalReviewedTiles": ["2/12", "9/2", "0/0"],
  "metrics": { "detectionCount": 14, "confirmedTileCount": 11, "notTileCount": 3 },
  "tags": { "usefulForTraining": true, "badExample": false, "starred": true },
  "notes": "False positives on upside-down partial crops." }
```

**Eval-image annotation (held-out, in-repo)**
```json
{ "imageId": "eval_017", "imagePath": "eval/real/eval_017.jpg",
  "imageWidth": 3024, "imageHeight": 4032,
  "tiles": [
    { "tileId": "t01",
      "identity": { "first": 2, "second": 12, "display": "2/12", "unorderedKey": "2-12" },
      "observedOrder": { "firstMeaning": "top", "secondMeaning": "bottom" },
      "bbox": { "x": 210, "y": 388, "width": 120, "height": 232 },
      "orientation": { "layout": "vertical", "rotationDegrees": 89 } } ] }
```

**Tile notation:** slash strings (`2/12`); order is orientation-aware
(left/right horizontal, top/bottom vertical); identity is the unordered pair
(`unorderedKey` = `min-max`).

---

## 12. Improvement loop (history → training)

Phase A (bootstrap) is §4/§6. Phase B, once the scanner ships:
1. Scan → save rich history (image + detections + corrections + confidence).
2. Human review flags useful cases: `usefulForTraining`, `badExample`, `starred`
   (extendable later to detection-vs-value-training, `hardNegative`,
   `holdoutOnly`).
3. Promote curated real cases — **especially hard negatives and corrected
   mistakes** — into the *training* set (never the held-out eval set).
4. Retrain (synthetic + promoted real), re-export ONNX, re-measure on eval,
   confirm phone budgets, ship if no regression.

History is not a convenience feature — it's the fuel that closes the sim-to-real
gap over time.

---

## 13. Open questions / TBD

- Exact YOLO version/size variant (M0/M1).
- Baseline per-half classifier vs. pip-detector target — which clears M1 (§5.2).
- 2D vs. 3D synthetic renderer (§4.1); how large a real fine-tune set, if any (§4.4).
- Final numeric gates (M1 targets are proposals; phone budgets set in M2).
- Annotation tooling for growing the real eval set.
- Whether oriented boxes are needed from Stage 1 or axis-aligned + rotation suffices.

---

## 14. Out of scope for Phase 1

Catalog · accounts/auth · server-side multiplayer sync · Postgres · any feature
that doesn't improve detection accuracy, pip-reading accuracy, or scanner
validation. Do not expand scope until the M1 accuracy gate is met.
