# Domino Scanner — Build Plan v2

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

**This is a two-phase project.** **Phase 1** (this document) builds, tests,
validates, and confirms the tile/pip scanner in isolation — the app's biggest
current weakness and the reason this plan exists. **Phase 2** builds the full
multiplayer game app around the proven scanner — join-by-code sessions, a game
manager, cross-device standings — as described in
[`README.md`](../README.md), which is the Phase 2 product vision (not
Phase 1 scope). Phase 2 doesn't start until Phase 1's accuracy gates (§6) are
met; its tech stack/implementation details get written up once it does.

**Mission (Phase 1):** from a phone photo of domino tiles, detect every tile
and read its pip values as accurately as practical, surfacing uncertain
results for fast human correction.

**In scope (Phase 1):** the scanner (detection + pip reading), Quick Scan as
the iteration surface, an editable review/correction step, local scan history,
and a minimal single-device round/game flow (§9.3) — just enough to exercise
the scanner end-to-end, not the Phase 2 multiplayer product.

**Phase 1's hand-off to Phase 2:** the scanner must be built as a
**self-contained module** — models + pre/post-processing behind the §5.4 stage
contracts as its public API, with Quick Scan as merely its first consumer.
Concretely: scanner code lives in its own directory (`scanner/`), exposes
`init()` (loads/caches the ONNX models) and `scanImage(image) → §5.4 JSON`,
and touches **no DOM and no storage** — UI and persistence belong to the
consumer. Phase 2 then embeds the module in the multiplayer app without
reworking scanner internals. Any Phase 1 shortcut that welds detection or
counting logic into Quick Scan's page code violates this and gets rejected in
review.

**Deferred to Phase 2** (see §14): catalog, accounts/auth, server-side
multiplayer sync (join codes, shared sessions, game manager), Postgres.
Phase 1 is local-first (`localStorage` + `IndexedDB`) only.

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
| D1 | Training data | **Copy-paste real tile faces onto real backgrounds (primary) + rendered variety + small real fine-tune. Real *scenes* = held-out eval only** | Proven recipe for flat card-like objects; only patch-level realism needed; labels are free and exact. Real tile-face crops are cheap source material and don't touch the eval set | Pure photorealistic rendering (harder, larger sim-to-real gap); or manual scene labeling (highest labor) |
| D2 | Pip reading | **Count (detect pips + geometry), not identity classification** | Data-efficient; "a pip" is a trivial, uniform object synthetic data nails; validates against the known pip-grid geometry | Classify the ordered pair directly (simplest inference code, most data-hungry) |
| D3 | Deployment timing | **Decouple: accuracy milestone anywhere → on-device port later** | Removes integration tax from every early experiment; isolates the real risk (model quality) from the runtime risk (ONNX-in-browser) | Client-side ONNX from day one (every experiment runs in-browser) |

---

## 4. Data strategy

### 4.1 Data generation: copy-paste-first — D1

The pipeline synthesizes labeled multi-tile scenes by compositing tiles onto real
backgrounds. Labels (boxes, per-pip points, per-half counts, orientation,
**corner keypoints in a fixed deterministic winding order — §5.4**) are
emitted for free and exactly. This is the proven recipe for flat, card-like
objects — see the evidence at the end of this section.

**Tier 1 (primary) — copy-paste real tile faces.** One-time source material:
real photos covering all 91 tile faces, in diverse arrangements (touching,
askew, spaced — but never overlapping). Individual tile-face crops are extracted
via the detection/segmentation pipeline (or assisted annotation), not by
assuming clean backgrounds. These real patches are composited onto a diverse
background pool with randomized rotation, perspective, brightness/relight, blur,
and sharpen. Cut-Paste-Learn shows *patch-level* realism is enough to train
competitive detectors for this kind of object.

**Tier 2 (variety) — rendered tiles.** Procedurally draw tiles from the canonical
grid (0–9 → 3×3; 10–12 → 4×3, incl. the centred 11-middle-row), randomizing
appearance **color-agnostically**: pip color (full spectrum, excluding pure
black — real sets never use literal black pips, only dark tones), gloss,
divider style, edge rounding, wear. **Body color is fixed white and the
divider is fixed black** — a universal domino fact, not randomized. This
cheaply covers the long tail and tile finishes the real captures miss
(domain-randomization rationale, Tremblay et al.).

**Tier 3 — fine-tune on a small real set.** After Tier 1+2 training, fine-tune on
a small hand-labeled set of real *scenes*. Synthetic + real fine-tuning beats
either alone (Tremblay et al.; Cut-Paste-Learn: >21% relative gain combined with
real).

**Scene composition:** 1–N tiles, non-overlapping (tiles may touch edge-to-edge
but **never overlap** — a hard domain rule), random positions/rotations, random
perspective homography, plus capture-condition noise (color cast/white balance,
motion/defocus blur, sensor noise, JPEG compression).

**Implementation musts (from the evidence):**
- **Blend paste boundaries** (Gaussian/Poisson blending, edge blur). Naive paste
  leaves boundary artifacts that measurably hurt the detector (Cut-Paste-Learn).
- **Curate backgrounds** — context matters; bad context can hurt. Gather a few
  hundred diverse real surfaces (texture sets + hard cases: white cloth, glare,
  grass, wood grain). Never uniform.
- **Scale to ~10–20k composited images**, in line with comparable card-detector
  datasets.
- **Include 0–10% "background" images (no tiles)** to cut false positives (COCO
  uses ~1%; Ultralytics [tips](https://docs.ultralytics.com/yolov5/tutorials/tips-for-best-training-results)).

**Evidence base:**
- Cut, Paste and Learn — Dwibedi et al., ICCV 2017: <https://arxiv.org/abs/1708.01642>
- Simple Copy-Paste — Ghiasi et al., CVPR 2021: <https://arxiv.org/abs/2012.07177>
- Domain Randomization for detection — Tremblay et al., CVPR-W 2018: <https://arxiv.org/abs/1804.06516>
- Analogous playing-card YOLO datasets (paste cards onto textures, ~20k imgs):
  <https://universe.roboflow.com/augmented-startups/playing-cards-ow27d>,
  <https://github.com/DanielGonzalezAlv/PlaycDC>

### 4.2 Real data — two distinct kinds (no eval contamination)

Two separate pools of real imagery, never mixed:
- **Real tile-face crops (training source):** the flat single-tile captures used
  by Tier 1 copy-paste (§4.1). Cheap, bounded (~91 tiles × a few variants).
- **Real *scenes* (held-out eval + Tier-3 fine-tune):** multi-tile photos as the
  app will see them.
  - The **49-photo eval set** is **held out** and never trained on — our honest
    read on the sim-to-real gap. It is a smoke-test *floor*, not enough for
    per-tile precision (plan to grow it; see §7).
  - **This set already exists from the prior (archived) OpenCV-heuristic
    effort** — 49 real photos, 190 tiles, hand-verified pip identities
    (`eval/corpus_photos/` locally; ground truth recovered from branch
    `tooling/corpus-benchmark` into `eval/corpus_truth.json`). Reuse it rather
    than recapturing from zero — but it has **no bounding boxes or
    orientation**, so it must be extended (not just imported) before it can
    back the IoU/orientation metrics in §6/§7 (see M-1).
  - A **separate** small labeled scene set is used for Tier-3 fine-tuning, kept
    strictly disjoint from the eval set.

### 4.3 User capture sessions (the schedule's external dependency)

Several inputs require the **user physically photographing tiles** — nothing
else on the plan can substitute for them, so they gate the schedule. (Checked:
the old catalog branch stored only pip *values* in `catalog.json`, no photos —
none of this is already done.)

1. **Tier-1 source capture (before M0) — still required.** Checked
   (2026-07-11): `eval/photos/` holds 68 images, but 49 of them are
   **byte-identical to the held-out eval corpus** (`eval/corpus_photos/` —
   same photos, renamed), and the rest are screenshots/web scraps plus one
   extra phone photo. **Eval photos cannot be Tier-1 training source:**
   training on crops cut from eval scenes means the model is graded on tiles
   it trained on, and the benchmark becomes a lie. (This is the universal
   train/test split rule, and this project already saw the soft version of
   the failure: the old scanner was tuned against its own benchmark one
   photo at a time until it looked good there and still missed tiles in real
   use.) It's also no loss: eval photos are angled multi-tile scenes — the
   *wrong shape* for Tier-1, which wants flat, close, well-lit face shots to
   cut clean crops from. So one new capture session is needed — all 91
   faces, small groups per photo, a few arrangements/lighting variants;
   roughly 30–60 minutes — and it produces *better* training material than
   reusing eval photos would.
2. **Eval-set growth (during M0→M1):** more real multi-tile scenes on diverse
   backgrounds, toward the §7 sizing target (every identity multiple times).
   **Reserve ~15–20% of each new capture batch as a calibration split**
   (disjoint from both eval and training) — this happens unconditionally as
   part of eval-set growth, so calibration data collection doesn't depend on
   whether Tier-3 fine-tuning (below) ends up triggered. Feeds the temperature
   scaling in §5.4.
3. **Tier-3 fine-tune scenes (only if M0/M1 shows the gap needs it):** a
   separate small batch of real scenes, kept disjoint from eval (§4.2).
4. **Phone access for perf probes:** the M1 feasibility probe and M2 budgets
   (§8) need runs on the user's real mid-range phone.

### 4.4 Domain-randomization checklist (must all vary)

Background · lighting/shadows · white balance/color cast · pip color (never
pure black) · gloss · tile count · position · rotation · perspective · blur ·
noise · JPEG artifacts · partial tiles at frame edge.

(Tile body color and divider color are **not** randomized — universal domino
fact: body is always white, divider always black, §4.1.)

### 4.5 Sim-to-real gap — the top risk

Synthesized models can overfit to paste artifacts or miss real texture.
Mitigations, in order of preference:
1. Real tile-face pixels (Tier 1 copy-paste) — the strongest defense; the tiles
   themselves are already real.
2. Blended paste boundaries + aggressive domain randomization (§4.1, §4.4).
3. Tier-3 fine-tune on a small real scene set (§4.1) if 1–2 aren't enough.
4. Always measure on the **real** held-out set so the gap is visible, never hidden.

The M0 gate (§6) exists specifically to measure this gap before we over-invest.

---

## 5. Model architecture — D2

Two object classes, then deterministic geometry. This keeps the learned part
trivial and the brittle part (counting/assignment) reuses the known grid model.

### 5.1 Stage 1 — tile detection (YOLO)

- **Task:** detect full domino tiles on the whole image. One class: `domino_tile`.
- **Output per tile:** a standard **axis-aligned bounding box** + confidence,
  plus the tile's **4 corners as keypoints** — Ultralytics **YOLO-Pose** head, a
  first-class, documented task with standard ONNX export
  ([Ultralytics Pose docs](https://docs.ultralytics.com/tasks/pose)).
  **Chosen over YOLO-OBB** (the earlier plan): OBB's angle output has a
  boundary-discontinuity pitfall, and — the deciding factor — its rotated-box
  NMS has **no existing JS/ONNX-Runtime-Web library**; porting rotated NMS by
  hand is real, unscoped engineering (verified: no off-the-shelf npm package
  handles rotated NMS or OBB angle decode in-browser; `onnxruntime-web` only
  runs the model graph). Pose keeps NMS **completely standard** — the same
  axis-aligned pattern every plain-YOLO browser demo already uses — while the
  4 corners feed §5.2's perspective-rectify step directly, more precisely than
  a single angle value.
  **Trade-off inherited from the OBB discussion, not eliminated by switching to
  Pose:** tiles are 2:1 rectangles that touch edge-to-edge at arbitrary angles,
  and an axis-aligned box around a rotated tile is looser than a tight OBB —
  two touching, rotated tiles' axis-aligned boxes can overlap heavily even
  though the tiles themselves never overlap (§1). **Mitigation:** a permissive
  NMS threshold (or soft-NMS, a standard technique — no custom rotated-IoU
  math needed) so a real touching tile isn't wrongly suppressed; consistent
  with the recall-over-precision priority below and the fact that the review
  UX (§9.2) already exists to clean up duplicate/false-positive detections.
  **Fallback:** a plain box-only detector (no keypoints), with orientation
  resolved by classical CV on the Stage-2 crop instead (viable since tile body
  is always white, §4.1 — guaranteed high contrast against most backgrounds),
  if Pose keypoint accuracy underperforms.
- **Priority:** **recall over precision.** Missed tiles hurt the user more than
  easily-removable false positives (review handles extras).
- **Variant:** smallest YOLO-Pose variant that clears accuracy; size/latency
  matter for the eventual phone target (§8). Exact version = TBD (M0/M1).

### 5.2 Stage 2 — pip reading (count, not classify)

**Why crop first (not single-pass pip detection on the full image).** Pips are
*small objects*; at a detector's ~640px working resolution they occupy few pixels
and become "nearly invisible" — a well-known weakness that slicing/higher-res crops
specifically fix (the SAHI principle;
[Ultralytics](https://docs.ultralytics.com/guides/sahi-tiled-inference),
[Labellerr](https://www.labellerr.com/blog/small-object-detection/)). Cropping each
tile restores the resolution pips need, so detecting pips across a full multi-tile
photo is **explicitly rejected**.

**Crop preparation (removes the crop-quality failure mode).** Using the 4
corner keypoints (§5.1), **perspective-rectify** each tile to a canonical upright, fixed-size
rectangle and **pad slightly** so tight boxes don't clip edge pips. Stage 2 then
always sees a consistent, high-res, upright, low-background tile with no bleed from
adjacent touching tiles.

Two framings for the counter; **prove the baseline first, upgrade if needed.**

- **Baseline (simplest that could work):** on the rectified crop → split at the
  divider bar (edge-detection-first, learned fallback, §5.3) → a small CNN
  classifies each half's pip count as **0–12 (13-way softmax per half)**, and
  opportunistically doubles as the §5.3 bar-centre fallback regressor. Trained
  on synthetic crops. Counting generalizes better than identity memorization.
- **Target (more robust):** a **pip detector** (detect each pip as an object, or
  as keypoints) across the tile; assign pips to halves by geometry and count.
  Elegant because a "pip" is a uniform, trivial object synthetic data saturates,
  it yields natural per-pip confidence, and all counting is deterministic. The
  known grid model is a sanity check (counts must fit a valid 3×3/4×3 layout).

Recommendation: ship the baseline to clear M1, adopt the pip-detector target if
the baseline plateaus below the per-half accuracy gate.

### 5.3 Orientation & ordering — deterministic, not learned

The value model does **not** learn orientation. Geometry handles it:
- Orientation comes from the **4 corner keypoints** (§5.1): the long edge
  between two adjacent corners gives the long axis directly (the tile is a 2:1
  rectangle; the long axis is unambiguous) — no angle value to decode, no
  periodicity to handle.
- **Split at the physical divider bar, not at pips.** Every tile has a real centre
  line (the "bar") dividing it into two square ends, present regardless of pip
  count — so blank halves (0 pips) split cleanly. This step is **critical**:
  a misplaced bar shifts both halves' pip counts, so bar-localization error
  propagates directly into the product metric.
  **Approach — layered, not a single deterministic pass:**
  1. **Primary: edge detection, not raw intensity averaging.** A plain 1D
     intensity-profile average is fooled by anything merely darker-than-average
     (a shadow, a worn patch, a dark-toned pip near the centre) even though the
     bar's real signature is a sharp light→dark→light *transition*, not just
     low brightness. Run a lightweight edge-detection pass (a **Sobel filter**)
     perpendicular to the long axis and find the strongest gradient-magnitude
     peak along the long axis — this targets the bar's actual edge signature
     directly, rather than "whatever's darkest." Contrast is still
     **guaranteed, not merely typical** (tile body always white, divider
     always black — universal domino fact, §4.1), which is exactly what makes
     the Sobel peak reliably strong. Validate the found peak is centred within
     a tolerance (domino bars are manufactured at the geometric midpoint).
  2. **Secondary fallback — learned, opportunistic:** if the deterministic
     Sobel pass doesn't find a confident peak (e.g. extreme glare, heavy wear,
     an occluding shadow), let Stage 2's per-crop CNN (already running for pip
     counting, §5.2) also regress the bar's centre position as a cheap
     auxiliary output — negligible extra inference cost since the crop is
     already being processed. Used only when the deterministic pass is
     inconclusive, never as the primary source.
  3. **Tertiary fallback — geometric default:** if both the deterministic pass
     and the learned fallback are inconclusive, default to the geometric
     midpoint of the rectified crop and flag the reading as lower-confidence.
  **Eval metric:** bar-localization error in pixels (distance between detected
  bar position and true centre), **tracked separately per tier** (Sobel edge
  detection vs. learned fallback vs. geometric-midpoint default) — this
  catches regressions that silently degrade pip accuracy, and surfaces how
  often each fallback tier actually fires (a rising fallback rate signals a
  data/domain-randomization gap worth investigating).
- Ordered halves: **left→right** when horizontal, **top→bottom** when vertical.
- **180° ambiguity doesn't matter for scoring:** the hand's pip total is
  order-invariant (§7), so which end is "first" only affects observed-order
  *display*, never the total.

This shrinks what Stage 2 must learn to just "how many pips in this half."

### 5.4 Stage output contracts

**Detector (Stage 1) — per tile**
```json
{ "detectionId": "det_001", "sourceImageId": "img_001",
  "bbox": { "x": 120, "y": 240, "width": 88, "height": 176 },
  "corners": [ { "x": 128, "y": 242 }, { "x": 200, "y": 248 },
               { "x": 196, "y": 408 }, { "x": 124, "y": 402 } ],
  "detectionConfidence": 0.95 }
```
`bbox` is the axis-aligned box (NMS operates on this); `corners` are the 4
keypoints. **Winding order must be rigid and deterministic, not arbitrary** —
without a fixed, consistent semantic per keypoint index, the training signal
contradicts itself across examples (the same physical corner landing at a
different index depending on how a given synthesis run happened to enumerate
it), and keypoint-regression heads can't learn cleanly from that. **Rule,
enforced by the data-synthesis pipeline (§4.1), not left for the model to
discover:** sort the 4 corners by polar angle relative to the tile's bounding
box centre, starting from a fixed reference (e.g. index 0 = smallest angle
from centre, proceeding clockwise). Apply this identically to every synthetic
training label, so keypoint index has a consistent geometric meaning across
the whole dataset regardless of the tile's actual rotation. §5.3 still derives
orientation from the resulting ordered corners; this rule only fixes *which*
corner is index 0, not what orientation means. Replaces the earlier OBB
`rotationDegrees` field.

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

**Confidence must be calibrated — what that means and exactly what we do.**
The review UI (§9.2) flags tiles as "check this one" based on the model's
confidence score. Problem: raw neural-net confidence is inflated — a model
that says "90% sure" is often right only ~70–75% of the time
([Guo et al. 2017](https://arxiv.org/abs/1706.04599)). Use raw scores and the
app will fail to flag exactly the tiles the user needed to check. The fix is
**temperature scaling**, the standard one-parameter method:
1. Set aside a **calibration set** — a few hundred real tile readings that are
   in **neither** training **nor** the eval set. Concretely: reserve ~15–20% of
   each eval-set-growth capture batch (§4.3 item 2) for calibration — this
   happens unconditionally as eval-set growth proceeds, so it doesn't depend on
   whether Tier-3 fine-tuning ends up triggered.
2. After training, run the model on the calibration set and fit the single
   constant **T** that makes stated confidence match observed accuracy. A few
   lines of scipy; no retraining.
3. Bake **T** into the app as a constant applied to every confidence score
   before the review UI sees it. Refit T for each model release — it is
   specific to one trained model.

Track calibration error (ECE) in eval (§7) to confirm the fix holds.

### 5.5 Training & compute

- **Framework:** **Ultralytics YOLO** — the standard, well-documented package for
  object detection; has the **Pose head** (§5.1) and **one-line ONNX export** (§8).
  The Stage-2 pip counter is a small CNN, trivial to train.
- **Compute is free for Phase 1** (satisfies the cost rule — no paid compute
  without approval). A nano model trains fast — **YOLOv8n ≈ 2.5 h / 100 epochs on a
  free GPU** — which fits comfortably in free cloud GPU quotas:
  - **Kaggle** (primary): NVIDIA P100, **30 h/week guaranteed**, 9 h/session
    ([quota](https://www.kaggle.com/general/108481)).
  - **Colab free** (overflow): T4, ~12 h sessions but *variable* weekly availability
    ([guide](https://www.hivenet.com/post/google-colaboratory-gpu-complete-guide-to-free-cloud-gpu-access-and-limitations)).
  - Training-time anchor: [YOLOv8 custom-training guide](https://learnopencv.com/train-yolov8-on-custom-dataset/).
- **Iteration cadence:** ~2.5 h per train→eval loop → a handful of full loops per
  week within free quota. Reinforces "fewer, better-informed loops."
- **Experiment tracking:** log each run's dataset + config → eval numbers (Ultralytics
  auto-logs runs; optionally Weights & Biases free tier) so every accuracy figure is
  traceable to a model version (feeds `scannerVersion`, §11).
- **Where code & artifacts live:**
  - Synthetic-generation + training code: a `train/` directory in this repo
    (Python; runs on Kaggle/Colab by cloning the repo or uploading the dir).
  - Datasets: versioned in the annotation tool (Roboflow) / regenerated from
    `train/` scripts — composited images are **not** committed to git.
  - Trained weights (`.pt`) and ONNX exports: attached to **GitHub Releases**,
    one release per model version, tag = `scannerVersion` (§11), e.g.
    `scanner-v0.3.0` — never committed to the repo (binary bloat).
  - How the app gets the model: the deploy step copies the release's ONNX
    files into the site's static assets (e.g. `models/`), so the PWA service
    worker can precache them (§9.0) and offline scanning works. The app never
    fetches from the GitHub Release URL at runtime.
- **Revisit paid compute only** if a run genuinely exceeds free quota — and only with
  explicit approval.

---

## 6. Milestones & acceptance gates

Every gate is numeric and measured on the **real held-out eval set** (§7).
Targets below are proposed starting points — adjust once M0 gives a baseline.

**Statistical power note:** eval metrics are point estimates over a finite
sample; report a 95% confidence interval (Wilson score interval for
proportions) alongside every recall/precision/accuracy figure. A gate is
**provisionally met** if the point estimate clears the target; **confirmed
met** requires the CI lower bound to clear it. Per-identity metrics (exact-tile
accuracy) are directional only until the eval set clears the §7 growth target
(every identity ≥3–5 occurrences) — don't treat them as pass/fail before that.

### M-1 — Eval infrastructure (prerequisite to M0)
You cannot measure a gate without a held-out set and a scorer, and industry
guidance is explicit that test images must never leak into training (Ultralytics,
[tips](https://docs.ultralytics.com/yolov5/tutorials/tips-for-best-training-results)).
Deliverables, before any training:
- **Start from the existing 49-photo/190-tile corpus (§4.2), don't rebuild
  from zero.** It already has real photos + verified pip identities; it's
  missing bounding boxes and orientation. Extend it:
  - **Annotation tool chosen and set up.** Recommended: **Roboflow** free tier
    (AI-assisted labeling, dataset versioning, YOLO/COCO export); **CVAT** as
    the fully self-hosted open-source alternative. **Note:** Roboflow's free
    "Public" tier requires datasets to be open-sourced on Roboflow
    Universe — publicly visible/downloadable — unlike a paid tier's
    private-to-workspace storage. Accepted for this project (domino tile
    photos aren't sensitive); revisit CVAT if that changes. Import the 49
    photos and add boxes + 4 corner keypoints on top of the existing
    pip-identity labels (don't relabel identities that are already verified).
    **Corner keypoints must follow the same deterministic winding order as
    the synthetic labels (§5.4)** — sorted by polar angle from the box
    centre, fixed starting reference — whether the annotation tool assigns
    that automatically or a post-processing script re-sorts its raw export;
    mixing winding conventions between real and synthetic labels would
    reintroduce the exact inconsistency §5.4 exists to prevent. **Verify
    before committing to a tool** that it supports keypoint/pose annotation
    (4 points per tile) and exports a format the YOLO-Pose trainer accepts
    (§5.1 depends on corner-keypoint labels).
  - **Combine the two label files (small script — schedule it).** After
    annotation we'll have two files describing the same 49 photos: the old
    `eval/corpus_truth.json` says **what** is in each photo (pip values per
    tile), and the annotation tool's export says **where** (box + 4 corner
    keypoints per tile). The scoring harness needs both merged into one record per photo
    (the §11 format). Write a ~50-line script that pairs each box with a
    pip-value label (same photo; flag any count mismatch for manual fix) and
    emits the §11 JSON. About half a day — and it's on the critical path to
    M0, because no merged file means no measurable kill-gate.
  - **Grow the set** toward the §7 sizing target (every identity appears
    multiple times) — the 49 photos are the floor, not the ceiling. Requires
    user capture sessions (§4.3).
- **Scoring harness** that computes the §7 metrics from model output vs.
  labels. The old `eval/corpus_eval.cjs` is a template for the matching/scoring
  logic (tile-count, exact-pair matching, batching, confusion table) but its
  detector hook (`window.runDetect`, the old OpenCV heuristic) is not reused —
  swap in the new YOLO/pip-count model's output.
- Note: copy-paste/rendered training data is auto-labeled (§4), so manual
  annotation here is scoped to eval scenes + the Tier-3 fine-tune set only.

### M0 — Sim-to-real spike (the kill-gate) · target: days, not weeks
Build the minimal copy-paste/render pipeline (§4) + train a small tile detector on
**synthetic only** → measure on the real eval scenes.
- **Pass:** tile detection **recall ≥ 0.70 @ IoU 0.5** on real photos. (n≈190
  tile instances at current eval-set size — treat as directional pass/fail per
  the statistical power note above, re-confirm after eval-set growth, §7.)
- **✅ MEASURED PASSED 2026-07-16 — confirmed met (CI rule):** recall **1.000**
  (95% CI 0.98–1.00, 0/194 tiles missed) on the full 49-photo/194-tile eval
  set; precision 0.761 at conf 0.20, and recall holds 1.000 through conf
  0.65 — chosen operating point conf 0.50 gives precision 0.826. Model: yolo11n-pose, 60 epochs, 2,000 rendered
  scenes (Tier 2 only — no real tile pixels) composited onto 51 real
  background photos with drop shadows. Run log: `runs/pose/realbg`.
  Sim-to-real transfer is settled for detection; remaining work is Stage-2
  accuracy (per-half 0.69 at this checkpoint) and precision.
- **Fail → pivot decision**, not more grinding: add a real fine-tune set (§4.2),
  improve rendering realism (§4.1), or reconsider the approach.
- This tests the single riskiest assumption (transfer) before any app work.

### M1 — Accuracy proven (anywhere; no app integration)
- Tile detection **recall ≥ 0.95 @ IoU 0.5**, precision reported (recall-biased OK).
- **Per-half pip accuracy ≥ 0.97.**
- **Exact-tile (identity) accuracy ≥ 0.90.** (Provisional until eval-set
  growth, §7 — see statistical power note above.)
- **Hand-total (product gate): ≥ 65% of hands with the exact correct pip total
  pre-correction; ≥ 99% post-correction.** (Provisional: 65% follows from the
  per-half math below for a 7-tile hand; revise once M0/M1 give a real
  baseline. The post-correction number is the one the game experience rides
  on — it measures scanner + review UX together.) This is the metric the game
  actually uses.
- Orientation/order accuracy reported.

**Status 2026-07-19 (eval set grown to 78 photos/388 tiles, up from the 49/194
floor, in three passes):**
- Detection recall **0.995** (CI 0.981–0.999, n=388) — **confirmed met** (≥0.95).
- Per-half pip accuracy **0.973** (CI 0.959–0.982, n=772) — **provisionally
  met** (point estimate clears 0.97; CI lower bound 0.959 — not confirmed met
  by the §6 CI rule). Slipped slightly from the prior pass's 0.978/0.965 —
  the third batch got more rigorous per-tile review (full-resolution crop
  checks, not just the compressed contact sheet) and surfaced more real
  model errors than the shallower first two passes caught. Treat this as the
  more trustworthy estimate, not a regression in the model.
- Exact-tile identity **0.956** (CI 0.931–0.972, n=386) — clears 0.90 on both
  point estimate and CI, still directional per §6 until every identity has
  3–5+ occurrences.
- Hand-total exact rate **0.782** (CI 0.678–0.859, n=78) — **confirmed met**
  (≥0.65 pre-correction).
- **Data-quality finding, not just a value-accuracy one:** rigorous per-tile
  review of the third batch caught 2 cases the shallow pass missed —
  a detector false positive (background wood grain boxed as a tile) and a
  duplicate detection (two overlapping boxes for one physical tile, an NMS
  gap on touching tiles) — both excluded from ground truth rather than
  guessed at. Same family of issue as the touching-tile corner-precision fix
  in #161; worth a closer look if precision/duplicate-detection matters more
  as this moves toward product integration.
- Caveat unchanged from prior passes: box/corner ground truth for newly-added
  photos comes from the trained tile detector's own output (spot-checked by
  eye), valid for pip-value accuracy but not an independent detection-recall
  re-check.

**Grey-pip investigation, 2026-07-22 (correction of a prior misdiagnosis):**
a single real photo (one 4/4 grey-pip tile, `20260718_183256.jpg`) read 0/0,
which #166 attributed to a pip-detector color blind spot — the synthetic
trainer's `_pip_color()` never sampled desaturated/grey hues (saturation
floor 0.2), so the working theory was that grey pips needed to be added to
the synthetic color range. Two independent widened-color-range fixes were
built and each trained fully (4 total 60-epoch runs across MPS/CPU) — both
collapsed real-photo per-half accuracy to ~0.13–0.16 despite perfect
synthetic-val metrics (mAP50 0.995) every time, an unrelated regression
introduced by the fix itself. A control retrain on the untouched dataset
reproduced ~0.95, isolating the collapse to the color-range change, not MPS,
not crash/resume, not other drift. Rather than abandon the pip-color theory
as merely counterproductive, the underlying premise was checked directly:
the *unmodified* baseline model (`runs/detect/pipdet_hn`) was run against
all 3 real photos containing true 4/4 grey tiles. It correctly read 4/4 at
0.88–0.89 confidence on **2 of 3** — grey pips are not a color blind spot.
The 1 failure is `20260718_183256.jpg` specifically: a steep viewing angle
under overhead light with strong specular glare washing the pips toward
white, visibly different from the other two (crisp, well-shaded) photos —
a lighting/glare problem, not a hue the model never saw. No fix was shipped;
`render.py` is unchanged from the validated baseline. If pursued further,
the correct lever is glare-specific (stronger/more frequent specular
highlight simulation in synthetic training, or app-level capture guidance
to avoid steep angles under bright overhead light), not the pip color
range. One tile out of ~390 in the corpus; current baseline metrics above
already account for this miss and clear/provisionally-clear their gates.
A reusable side-effect of this investigation: `train/autoresume_pip_train.py`,
a supervisor that health-checks a training checkpoint and auto-resumes on
crash — added after the PyTorch MPS backend was observed to crash silently
(no traceback, no OOM) roughly every 10–20 epochs on long training runs on
this machine (confirmed unrelated to data/correctness: identical runs are
stable on CPU).

**Accuracy math — why review is load-bearing, not optional.** Exact-tile ≈
(per-half)². At 0.97/half → ~0.94/tile. For a 7-tile hand, P(all correct) ≈
0.94⁷ ≈ **0.65**. So even a strong model gets a full hand perfectly only ~2 of 3
times — **the correction UX (§9.2) is a first-class part of the product, not an
admission of failure.** This is why detection is recall-biased and every result
is editable. **Caveat:** this treats per-tile errors as independent draws; in
practice errors correlate within a photo (shared lighting/blur/angle), so real
hand-accuracy may run below this naive estimate — this is why §7 measures the
hand total directly and empirically per photo rather than deriving it from the
per-half math.

### M2 — On-device deployment
Port M1 models to **ONNX Runtime Web**; verify:
- Output parity with the M1 (server) models on the eval crops.
- **§8 target budgets met** on a real mid-range phone (end-to-end ≤ ~2 s, model
  download ≤ ~10–15 MB, plus cold-load/memory), via the WASM baseline path with
  WebGPU benchmarked opportunistically. (A nano-pose feasibility probe already ran
  in M1, so this confirms rather than discovers.)

### M3 — Quick Scan integration
Wire the on-device scanner into Quick Scan: camera + photo upload, multi-tile
detection, review/correction (§9.2), local history (§10). No regression vs. M1
accuracy on the eval set (now measured end-to-end through the real capture path).

### M4 — Minimal round/game flow
Lightweight local rounds (§9.3). Only after the scanner is stable.

**No milestone advances without its gate measured — never a number we didn't run.**

---

## 7. Evaluation methodology

- **Held-out real set:** real *scenes* only (synthetic can't validate sim-to-real),
  JSON annotations in-repo (§11). Never trained on; kept disjoint from the Tier-3
  fine-tune set. Class distributions matched across splits (Ultralytics).
- **Eval set size:** the 49 photos are a smoke-test **floor** — far below a credible
  measurement bar for 91 identities (only a handful of instances each). Grow toward
  enough real scenes that **every identity appears multiple times** (practically a
  few hundred scenes). Sizing rationale: Ultralytics recommends ≥1500 images /
  ≥10k instances *per class* for training (met synthetically); eval must be large
  enough for stable per-identity estimates.
  ([Ultralytics tips](https://docs.ultralytics.com/yolov5/tutorials/tips-for-best-training-results))
- **Metrics reported every run:**
  - **Hand-total pip count (the product metric):** the sum of all pip counts
    across every tile detected in the photo (raw scanner output — blank half = 0,
    double-blank = 0). This is *not* house-rule-adjusted (e.g. double-blank = 50
    lives in the app's scoring layer, §7 scope note). Report **MAE on the hand
    total**, **% of hands with the exact correct total**, and **% within ±N pips**
    — measured both **pre-correction** (raw model) and **post-correction** (what
    the user submits). Per-tile errors can cancel or compound, so this is not
    implied by per-tile accuracy. **Stratify** hand-total accuracy by capture
    condition (lighting bucket, tile count, background type) in addition to
    the aggregate — this distinguishes uniform per-tile noise from a
    systematic per-photo failure mode that tanks whole hands at once.
  - Detection: recall & precision @ IoU 0.5; count of missed tiles / false positives.
  - Value: per-half pip accuracy; **exact-tile identity accuracy** (`12/2` ==
    `2/12` for identity); orientation/order accuracy (scored *separately* from
    identity); full-photo exact-hand rate.
  - **Calibration:** Expected Calibration Error (ECE) + a reliability diagram for
    the confidence that drives review triage (§5.4, §9.2). Overconfident scores make
    the triage lie; track this so calibration holds.
- **Identity vs. orientation are scored separately** so "found the right tile" and
  "read its order right" are distinguishable.
- **Scope note:** the scanner reports actual pip counts (blank half = 0);
  house-rule scoring (e.g. double-blank = 50) lives in the app's scoring layer, not
  the scanner.
- **Face-down tiles are NOT tiles (truth-set convention, decided 2026-07-13):**
  a face-down tile shows a bar-less white back; a genuine face-up 0/0 always
  shows the black divider bar. Face-down backs are excluded from eval truth
  (photos `1000012930`/`1000012936` each contain one) — a detector that boxes
  one scores a false positive, consistent with training data containing only
  faces. If real-world scans hit this often, promote backs as explicit hard
  negatives via §12 rather than relabeling them as 0/0.
- **Regression rule:** no change ships that lowers a gate metric without an
  explicit, measured justification.

---

## 8. Deployment / runtime (M2) — D3

- **Where:** client-side, in-browser, on the phone. No required inference server
  for the scan path (privacy + no backend cost + offline-capable).
- **Runtime:** export to **ONNX**, run via **ONNX Runtime Web**. **WASM +
  SIMD, single-threaded, is the *required baseline* path.** Deliberately
  **not** multithreaded: multithreaded WASM needs `SharedArrayBuffer`, which
  needs `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` response
  headers — and **GitHub Pages cannot set custom response headers** (verified;
  no ETA on GitHub's side). SIMD alone needs no special headers and works on
  GitHub Pages natively. This is a safe trade: multithreading typically buys
  roughly a 2–4x speedup over single-threaded SIMD, but the int8 nano-model
  anchor below (~40ms) already has 7–12x headroom against the ≤300–500ms
  detection budget — single-threaded is expected to clear it comfortably.
  **Multithreading is opportunistic**, benchmarked only if the deployment
  environment happens to support the required headers (same treatment as
  WebGPU below) — never assumed, never required. Many phones also have no
  WebGPU (Android Chrome 121+ / Android 12+ only, ~78% of Chrome-Android by Q1
  2026; **iOS Safari only from iOS 26+**). **WebGPU is opportunistic** and
  must be **benchmarked per model, never assumed faster** — the wrong backend
  is a 10–15× swing and WebGPU is sometimes *slower*.
  ([web.dev](https://web.dev/blog/webgpu-supported-major-browsers),
  [SitePoint](https://www.sitepoint.com/webgpu-vs-webasm-transformers-js/))
- **Quantize to int8.** Hard anchor: YOLOv8-nano ~40 ms int8 vs ~110 ms fp32 on a
  recent phone, mAP@50 0.350 → 0.347 (negligible).
- **Target budgets (starting points — validate on a real mid-range phone):**
  - End-to-end scan (1 detection pass + up to ~15 rectified crop counts): **≤ ~2 s**.
  - Detection: **≤ ~300–500 ms**. Per-crop count: **≤ ~30–50 ms**.
  - Total model download: **≤ ~10–15 MB**. Plus cold-load and memory within mobile
    limits. Smaller variants preferred even at some accuracy cost if they're what
    fits.
- **Early feasibility probe (in M1):** time a **nano Pose** model in ORT-Web
  **WASM+SIMD, single-threaded** (the required baseline, above) on a real
  mid-range phone *before* locking the two-model + Pose architecture, so a
  perf dead-end surfaces early rather than at M2. Confirms the 7–12x headroom
  assumption actually holds for this specific model/phone combination. The
  probe should also confirm the keypoint-decode + standard axis-aligned NMS
  path (§5.1) works end-to-end in JS — this is expected to be low-risk (it's
  the same well-documented pattern plain-YOLO browser demos already use, just
  carrying 4 extra corner points through surviving boxes), unlike the rotated
  NMS the earlier OBB approach would have required.
- **Explicitly deferred, not decided:** a server-side inference fallback remains a
  possible *later* pivot if phone performance proves unacceptable — a deliberate
  change, not the default.

---

## 9. Product surfaces

### 9.0 App stack & platform constraints

**Hard constraints (get these wrong and the camera or offline mode simply won't work):**
- **Serve over HTTPS.** The camera API (`getUserMedia`) works only in a secure
  context (HTTPS or localhost); otherwise `navigator.mediaDevices` is undefined
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)).
  Use static HTTPS hosting (e.g. GitHub Pages / Netlify).
- **Camera from a user gesture.** iOS Safari requires camera access to be triggered
  by a tap and granted by permission (supported since iOS 11). Always provide the
  **photo-upload fallback** when the camera is denied/unavailable.
- **Offline via PWA.** A service worker + Cache Storage API precache the app shell
  and the **ONNX model** so scanning works offline; a web app manifest enables
  install-to-homescreen
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching)).
  Large blobs (images, history) live in **IndexedDB** (§10); the model lives in
  Cache Storage. **Robust fallback required, not just the happy path:** mobile
  Cache Storage isn't guaranteed to have the model — quota pressure, more
  aggressive eviction on some browsers, or a precache interrupted mid-install
  (e.g. a flaky connection) can all leave it missing or unreadable at scan
  time. On a Cache Storage read/precache failure, don't fail silently or show
  a frozen/broken UI: fall back to fetching the model directly from static
  hosting, with an explicit **loading indicator + progress bar** — the model
  is ~10–15 MB (§8), large enough on mobile data that a bare spinner reads as
  a hang, not a fetch. Re-attempt the precache in the background after a
  successful fallback fetch so the *next* scan is offline-capable again.

**Softer call (reversible preference):**
- Build with **Vite**; keep the UI **lightweight** (vanilla or a small library such
  as Preact/Svelte) to minimize mobile bundle size. The round/game UI is simple
  enough that minimal wins; revisit only if the UI grows.

### 9.1 Quick Scan (primary iteration surface)
The Quick Scan feature baseline: camera scan, photo upload/load, multi-tile
detection from one image, review before confirm, per-tile edit, remove detection,
per-tile + aggregate totals, visible history, reset/clear, scan guidance
messaging. Quick Scan is where scanner iteration
happens first; Round-end Scan (§9.3) may lag and converges on the same pipeline
later.

### 9.2 Review / correction UX (load-bearing — see M1 math)
After a scan:
- Each detection shown as its own thumbnail with editable values + confidence.
- **Triage uses *calibrated* confidence (§5.4):** high/medium/low bands are set from
  calibrated confidence mapped to observed accuracy (e.g. "high" = the band where
  empirical accuracy ≥ target), combined with the `gridValid` guard — so "low →
  please check" is trustworthy, not overconfident noise.
- **Edit existing detection:** two separate numeric inputs (map to left/right or
  top/bottom by orientation).
- **Add missing tile:** single slash-notation text input, e.g. `2/12` (fastest on
  phone).
- **Not Tile:** explicit action to invalidate a false positive (normalized
  internally to `status: "not_tile"`); a `.` placeholder may also mark invalid.
- **Possibly-cut-off tiles flagged deterministically, not just by confidence:**
  if a detection's box touches the source image boundary, flag it
  `reviewFlags.possiblyPartial` (§11) and show a specific message — "Tile may
  be cut off — check this one or rescan" — instead of a generic low-confidence
  flag. Purely geometric (boundary-coordinate comparison), no model change
  needed; gives the user actionable guidance (reframe) rather than ambiguous
  uncertainty.
- False positives stay visible in history — they are valuable hard cases (§12).
- **Review preserves observed order** — never normalized to a canonical sort for
  display (canonical identity exists only for matching/eval).
- **Known, accepted quirk:** the 180° orientation ambiguity (§5.3) means
  re-scanning the same unmoved tile can display it as `2/12` one time and
  `12/2` another — both correct (order-invariant for scoring), but it can
  read as a bug. Not fixed by changing the ordering logic (would contradict
  the "preserve observed order" decision above); mitigated with user-facing
  microcopy near the review UI, e.g. "Which end shows first can vary between
  scans of the same tile — both are correct; only the total matters."

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
  "reviewFlags": { "notTile": false, "manuallyAdded": false, "possiblyPartial": false } }
```
`reviewFlags.possiblyPartial` — set when the detection's `bbox` touches the
source image boundary (§9.2); drives the "tile may be cut off" review message,
distinct from a generic low-confidence flag.

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

**Eval annotation convention:** `observedOrder.firstMeaning` / `secondMeaning` use
image-relative positioning, not tile-relative: **"first" = the half whose center
is closer to the top of the image** (lower y-coordinate), regardless of tile
rotation. This is unambiguous for annotators at any angle and matches the
pipeline's output convention (§5.3: left→right when horizontal, top→bottom when
vertical).

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

- Exact YOLO version/size variant (M0/M1). *(Framework settled: Ultralytics, §5.5.)*
- Baseline per-half classifier vs. pip-detector target — which clears M1 (§5.2).
- How much rendered variety (Tier 2) and real fine-tune data (Tier 3) are needed to
  close the sim-to-real gap (§4).
- Final numeric gates (M1 targets are proposals; phone budgets set in M2).

*Resolved during review:* data strategy (§4, copy-paste-first) · eval infra &
annotation tooling (§M-1, Roboflow/CVAT) · tile orientation (§5.1, YOLO-Pose +
4 corner keypoints chosen over OBB — no JS library exists for rotated NMS) ·
training framework & free compute (§5.5) · two-phase scope split (§1/§14,
Phase 1 scanner / Phase 2 multiplayer per `README.md`) · eval-corpus reuse
(§4.2/M-1, extend the existing 49-photo corpus rather than rebuild).

---

## 14. Deferred to Phase 2

Catalog · accounts/auth · server-side multiplayer sync (join codes, shared
sessions, game manager) · Postgres · any feature that doesn't improve detection
accuracy, pip-reading accuracy, or scanner validation. These are the Phase 2
product (`README.md`'s vision), not rejected — just sequenced after Phase 1.
Do not expand Phase 1 scope until the M1 accuracy gate is met.

**Notes for Phase 2 design (not designed now, scope boundary above):**
- Round-finalization concurrency (a player disconnecting mid-round,
  simultaneous submissions across separate devices) has no analog in Phase 1's
  single-device §9.3 flow — it only becomes a real concern once Phase 2's
  networked join-code sync exists.
- Mid-game joiner scoring: `README.md` says players can join at any point, but
  doesn't say what a late joiner's cumulative score is for rounds missed
  (zero, null, or counting starts from whenever they joined) — needs a
  decision when Phase 2's scoring model is designed.
- Backend choice for join-code sync + live cross-device standings: a managed
  realtime store (Firebase/Firestore, Supabase) may fit this project's
  "no infra to run" spirit better than hand-rolled Postgres + WebSocket —
  worth weighing when Phase 2 tech stack is decided (§1), not before.
