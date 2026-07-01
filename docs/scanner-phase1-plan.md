# Domino Scanner Phase 1 Build Plan

## Purpose
Phase 1 should prioritize a reliable, improvable domino-scanning workflow before deeply wiring scanner behavior into the rest of the app.

This document is a build plan for the planned scanner system itself. It is intended to be concrete enough to implement, review, and revise. It should describe the scanner architecture, the technical approach for its core stages, the review workflow around it, and the evaluation/storage systems that support iterative improvement.

## Why earlier drafts were not workable enough
Earlier drafts captured many surrounding decisions but stopped short of specifying the core scanner mechanics deeply enough.

What was missing:
- the scanner’s concrete technical architecture
- how YOLO is used for tile detection
- how tile-value inference / pip counting is performed after detection
- the output contract of each stage
- what should be optimized first in Phase 1
- a separate training-data plan distinct from the evaluation set
- an explicit tech-stack section instead of leaving core technology choices implied

This build plan corrects that by defining the core detection and inference flow explicitly.

## Scanner purpose
The scanner exists to convert domino photos into structured, reviewable tile data.

The scanner is for:
- helping the user get tile values from a photo quickly
- producing outputs that are easy to review and correct
- preserving enough evidence to improve scanner quality over time

The scanner is not just a detector and not just a pip counter. It is the full image-to-reviewable-results subsystem.

## Tech stack spec
This section defines the technology choices for Phase 1 so implementation does not depend on implied assumptions.

### Core scanner tech
- **YOLO** for full-image domino tile detection/localization
- a separate downstream **tile-value inference / pip-counting model/stage** on each detected tile crop
- crop extraction between detection and tile-value inference

### Product/runtime tech
- **Quick Scan** as the primary scanner surface in the app
- app review/correction UI for scan output validation and editing

### Storage tech
- **IndexedDB** for full images, scan history, detections, corrections, confidence, timestamps, and rich local records
- **localStorage** for lightweight settings, flags, preferences, and optional recent scan pointers

### Dataset/annotation tech
- **JSON files in the repo** for held-out evaluation annotations
- curated training datasets derived from seed annotations and promoted Quick Scan history

### Explicitly chosen vs still TBD
Chosen now:
- detector family: **YOLO**
- detection scope: full-image domino-tile localization
- one initial detector class: `domino_tile`
- prediction representation: ordered observed pair for tile-value inference
- local persistence: IndexedDB + localStorage split
- evaluation annotation format: repo-stored JSON

Still TBD:
- exact YOLO version
- exact tile-value inference model architecture
- exact detector/inference training framework
- exact runtime placement of inference if later deployment decisions require it
- exact annotation tool used to create labels

## Core scanner architecture
The planned Phase 1 scanner has two core model stages and several supporting systems.

### Stage 1: YOLO tile detection/localization
Use **YOLO** on the full source image to detect full domino tiles.

Planned formulation:
- run **single-pass full-image object detection**
- detect **full domino tiles** as objects
- start with **one detector class**: `domino_tile`
- output one detection per likely tile with:
  - bounding box
  - confidence score

Phase 1 optimization priority for detection:
- prioritize **recall over precision**
- allow some false positives if they are easy to remove in review
- avoid missing tiles when possible, because missed tiles are harder on the user than removable extras

Detection-stage responsibilities:
- identify all likely tiles in the image
- localize each tile with a bounding box
- produce enough information for crop extraction, review, and evaluation

Detection-stage output contract per tile:
- `detectionId`
- `bbox`
- `detectionConfidence`
- `sourceImageId`

### Stage 2: crop extraction
After YOLO detection, extract one crop per detected tile.

Crop-stage responsibilities:
- cut out each detected tile region from the source image
- generate a reviewable thumbnail/crop
- preserve linkage back to the source image and bounding box

Crop-stage output contract per tile:
- `detectionId`
- `thumbnailImageId`
- `cropImageId`
- `bbox`
- `sourceImageId`

### Stage 3: orientation and tile-value inference
After crop extraction, run a downstream tile-level inference stage.

Phase 1 recommended formulation:
- treat this as **two-side ordered prediction** on the tile crop
- infer:
  - tile orientation metadata
  - observed order meaning
  - first-side value
  - second-side value
  - confidence

Recommended output strategy:
- predict the **ordered pair directly** as observed
- do **not** reduce to a canonical unordered identity in the prediction output
- preserve observed order for review and annotation alignment
- canonical identity can be derived later for evaluation matching if needed

Why this formulation is preferred for Phase 1:
- it maps directly to review UX
- it preserves what the user sees
- it aligns with the requirement that review display preserve observed order
- it avoids a second normalization step before review

Inference-stage responsibilities:
- determine whether the crop should be interpreted as horizontal or vertical
- determine left/right or top/bottom order meaning
- predict first-side value
- predict second-side value
- return confidence for the ordered prediction

Inference-stage output contract per tile:
- `detectionId`
- `orientation.layout` (`horizontal` or `vertical`)
- `orientation.rotationDegrees` (approximate is acceptable)
- `orderedSidesMeaning` (`[left,right]` or `[top,bottom]`)
- `predicted.first`
- `predicted.second`
- `predicted.display`
- `predicted.confidence`

### Stage 4: review/correction handoff
After inference, send all detections to the review layer.

Review-stage responsibilities:
- present each detection as a tile thumbnail
- show ordered predicted values
- show confidence
- allow edit, invalidation, and manual addition

## Why two-side ordered prediction is the chosen pip-counting approach
The key unresolved technical choice was how to represent tile-value inference.

Options included:
- direct full-tile identity classification
- unordered identity + separate order prediction
- two-side independent value prediction
- direct ordered-pair prediction

Chosen Phase 1 approach:
- **predict the ordered pair directly from the crop**
- represent that as `first/second` in observed order

Why:
- review UI needs ordered values anyway
- annotation format preserves observed order
- evaluation separately handles identity vs order, so ordered outputs are acceptable and useful
- user correction is simpler when the prediction already matches review semantics

## How tile detection is done in this plan
Tile detection is done by running **YOLO on the full input image**.

Detailed plan:
1. user captures or provides one image
2. YOLO runs on the full image
3. YOLO predicts bounding boxes for full domino tiles using a single `domino_tile` class
4. each box becomes a candidate tile detection
5. each candidate is cropped for downstream inference and review

Detection assumptions for Phase 1:
- boxes are axis-aligned unless later rotation-aware detection is explicitly added
- orientation can be inferred downstream from the crop
- some overlapping or imperfect boxes are acceptable if review remains usable

Detection success criteria:
- high enough recall to catch most tiles in a realistic photo
- boxes accurate enough to support tile-value inference and human review
- confidence useful for triaging low-quality detections

## How pip counting / tile-value inference is done in this plan
Pip counting is done as a **tile-level ordered value inference stage** on each crop.

Detailed plan:
1. take the tile crop produced from YOLO detection
2. infer whether the tile is horizontal or vertical
3. infer observed order semantics:
   - horizontal -> left then right
   - vertical -> top then bottom
4. infer the value of the first half
5. infer the value of the second half
6. output the ordered pair plus confidence

Important framing:
- even if users say “pip counting,” the plan treats this stage as **tile-value inference**
- the output is the observed ordered tile value, e.g. `2/12`
- canonicalization for identity comparison happens only later when needed for evaluation or analytics

Phase 1 prediction target:
- ordered observed pair, not just unordered identity

Phase 1 confidence target:
- one confidence score per predicted ordered tile
- optional future extension: per-side confidence

## False positives, misses, and review strategy
Phase 1 does not require perfect autonomous output.

Planned behavior:
- favor catching likely tiles even if some false positives slip through
- let review handle explicit invalidation through **Not Tile**
- let review handle missed detections through manual add
- preserve both mistakes in history so the scanner can improve later

This means the product strategy and model strategy are aligned:
- detector recall is more important than detector purity early on
- review is part of the system, not an admission of failure

## Quick Scan as the primary scanner surface
### Quick Scan vs Round-end Scan
- **Quick Scan** is the primary experimentation and validation surface.
- **Round-end Scan** may lag behind initially and does not need to stay tightly synced with Quick Scan at first.
- Quick Scan is the tester/experiment tool.
- Scanner iteration should happen in Quick Scan first.
- Once Quick Scan is stable and accurate, the rest of the app should be wired to use the proven scanner pipeline.
- Long term, Quick Scan and Round-end Scan should converge on the same underlying scanner logic/model.

### Product development sequence
- Do not over-wire the full app around an unstable scanner.
- First stabilize Quick Scan.
- Then reuse the proven scanner behavior across the rest of the app.
- The scanner should be designed for iterative improvement rather than one-shot perfection.

## Training-data plan
The training-data plan is separate from the evaluation set. The 49-photo evaluation set is for benchmarking and regression checking only. It should not be treated as the main training dataset.

### Training-data goals
Phase 1 training data should support both core model stages:
- YOLO tile detection/localization
- tile-value inference / pip counting on cropped tiles

### Training-data sources
Training data should come from three sources:
1. a manually annotated seed dataset created specifically for model training
2. corrected Quick Scan history promoted into training candidates
3. curated hard cases, including false positives, missed tiles, partial tiles, visually difficult scenes, and noisy images

### Detection training data
YOLO detection training data should include:
- full source images
- one bounding box per real domino tile
- one initial object class: `domino_tile`

Detection training data should be rich enough to cover:
- different table/background conditions
- different lighting conditions
- different camera angles and distances
- different tile layouts and overlaps
- cluttered scenes and distracting non-tile objects

### Tile-value inference training data
Tile-value inference training data should include:
- cropped tile images
- observed orientation metadata
- observed ordered values:
  - `first`
  - `second`
  - `display`
- optional derived canonical identity for evaluation/matching support

Tile-value inference data should cover:
- horizontal tiles
- vertical tiles
- mild rotation/skew
- edge cases where pips are hard to read
- crops that look tile-like but should later be treated as invalid or low-confidence

### Hard-negative and error-case data
The training-data plan should explicitly retain error cases.

Important examples:
- false positives incorrectly detected as tiles
- partial tiles
- visually confusing backgrounds
- blurry captures
- low-light captures
- overlapping or occluded tiles

Why this matters:
- detector quality improves from hard negatives
- review history is valuable not only for correct examples but for difficult failure cases

### Data-promotion workflow from Quick Scan history
Quick Scan history should not automatically become training data. It should first act as a candidate pool.

Recommended promotion states:
- `candidateDetectionTraining`
- `candidateValueTraining`
- `hardNegative`
- `needsReview`
- `holdoutOnly`

Promotion workflow:
1. user performs scan
2. scan history is saved with image, detections, corrections, and labels
3. later review identifies useful examples
4. selected scans or crops are promoted into curated training datasets

### Dataset split policy
Training and evaluation must remain separate.

Required split policy:
- the 49-photo evaluation set is **held out** for evaluation
- evaluation images should **not** be used for main training
- training, validation, and evaluation sets should be tracked separately
- curated hard examples can be added to training or validation, but not by contaminating the held-out evaluation benchmark

### Labeling implications
The current saved-scan labels are useful, but training-dataset promotion needs more specific labeling states over time.

Current scan labels:
- `usefulForTraining`
- `badExample`
- `starred`

Future training-oriented labels may include:
- suitable for detection training
- suitable for value-inference training
- hard negative
- low-confidence but valuable
- holdout only

### Phase 1 practical training-data stance
Phase 1 does not need a massive polished dataset before any testing starts.

But it does need:
- a seed training dataset for detection
- a seed training dataset for tile-value inference
- a clean held-out evaluation set
- a workflow for promoting corrected scans into future training data

## Evaluation dataset
Phase 1 should include a **49-photo evaluation set**.

### Purpose of the evaluation set
- benchmark scanner quality consistently
- compare scanner improvements over time
- diagnose whether changes improve tile identity detection, orientation correctness, and review usability
- support a disciplined improvement loop instead of guessing

### Source-of-truth requirements
Each evaluation image should support:
- tile identity annotations
- tile bounding-box annotations
- tile orientation annotations

### Bounding-box quality
- Bounding boxes should be **accurate annotation-grade boxes** suitable for trustworthy evaluation.

### Orientation annotation quality
Orientation annotations should support:
- horizontal vs vertical classification
- approximate/full rotation angle
- enough information to determine which half is first vs second

## Tile value representation
### User-facing notation
- Primary notation should be **slash-separated strings**, e.g. `2/12`, `9/2`.
- Slash notation should be used consistently in plan language, manual-add UX, and evaluation examples.

### Meaning of order
Tile order is orientation-aware:
- **left/right** when the tile is horizontal
- **top/bottom** when the tile is vertical

### Preservation of observed order
- Observed order should be preserved in scan review and annotation contexts.
- In review mode, preserve the detected/annotated order exactly as seen in the image.
- Do not normalize display to a canonical sorted order.

### Identity vs display
- A tile can have one canonical identity for matching/analytics while still preserving observed display order in the UI.
- Review UI should prioritize what was visually observed.
- Matching logic may later use canonicalization internally, but that should not overwrite review presentation.

## Evaluation semantics
### Tile identity scoring
- A reversed tile such as `12/2` should count as the same tile identity as `2/12`.
- If the tile is a correct match, reversed order still counts as **correct** for identity.

### Orientation/order scoring
- Orientation/order should be scored separately from identity.
- This allows scanner evaluation to separate “found the right tile” from “understood its order/orientation correctly.”

### Required metrics
Phase 1 evaluation should report both:
- tile identity accuracy
- orientation/order accuracy

### Example
If expected is `2/12` and detected is `12/2`, then:
- identity can be correct
- orientation/order can be incorrect

## Review-mode display
- Review UI should preserve the observed order exactly as seen in the image.
- Review UI should not normalize the tile to a canonical sorted order for display.
- Canonicalization can still exist later for matching or analytics, but review UI should preserve observed order.

## Post-scan correction UX
After a scan, the app should:
- show each detected tile as its own thumbnail
- show detected values in editable inputs
- let the user correct values directly
- provide a **Not Tile** action/button for detections that are not actually a valid tile
- allow the user to add missing tiles manually

### Detailed correction behavior
- The correction screen should show each detected tile thumbnail with its values and score/confidence.
- Existing detections should be editable directly.
- Missing tiles should be addable manually.
- Some false detections may effectively be marked by entering `.` as a placeholder value.
- The UX should support both explicit **Not Tile** and invalid placeholder entry if needed.
- Internally, invalid detections should ideally normalize to a structured state such as `status: "not_tile"`.

### False positive handling
- Some false detections may come from upside-down or otherwise invalid tile-like crops.
- The review workflow should make it easy to invalidate them without losing visibility into the fact that they were detected.
- False positives are important learning cases and should remain useful in history.

## Manual add UX
When the user adds a missing tile manually, the preferred Phase 1 flow is:
- a single text entry in slash notation, e.g. `2/12`

This is preferred because it is fastest, especially on phone.

## Detected-tile edit UX
When the user edits an existing detected tile:
- use **two separate numeric inputs**
- these map to left/right or top/bottom depending on orientation

This creates a deliberate split:
- add missing tile: single slash-string input
- edit existing detected tile: two separate numeric inputs

### Edit UX rationale
- Editing existing detections should be explicit and low-ambiguity.
- Adding missing tiles should be optimized for speed.
- These are different tasks and do not need identical inputs.

## Confidence visibility
- Confidence/scores should be shown during review for detected tiles.
- Confidence values help explain why a bad prediction happened.
- Confidence values are useful both for user review and future scanner diagnosis.

## Quick Scan history persistence
Quick Scan history should persist across app reloads.

### Purpose
History should support:
- reviewing earlier scans
- comparing scan outcomes over time
- identifying recurring failure cases
- supporting future model-improvement workflows
- referring back to prior examples to improve the scanner/model later

### General history philosophy
- Scan history is not just a convenience feature.
- It is part of the scanner-improvement workflow.
- Saved history should preserve enough evidence to help understand why scans failed and how the scanner should evolve.

## Scan-history contents
Each saved Quick Scan history record should include:
- image reference
- full original image
- detections
- user corrections
- confidence data
- timestamp

The saved history should preserve enough information to understand why a scan failed, including image evidence.

### Additional useful history characteristics
- History should be reviewable by humans later.
- Saved records should be rich enough to identify false positives, missed tiles, and confusing cases.
- History should support future filtering and triage of hard cases.

## Local storage architecture
Phase 1 should use split local persistence.

### IndexedDB
Use IndexedDB for:
- full original images
- scan history entries
- detections
- user corrections
- confidence data
- timestamps
- richer JSON records

### localStorage
Use localStorage for:
- lightweight settings
- preferences
- app flags
- optional recent scan pointers

### Storage rationale
- Full images matter for later scanner/model improvement.
- localStorage is not the right place for large image payloads.
- IndexedDB is the preferred local-first storage for history plus images.
- This split keeps settings simple while allowing richer local records.

## Scan-history labeling
Each saved scan may optionally be marked as:
- useful for training/improvement
- bad/noisy example
- favorite/important

Recommended simple flags:
- `usefulForTraining`
- `badExample`
- `starred`

### Labeling rationale
- These labels serve different purposes and should all be available.
- Some scans are useful for learning.
- Some are just noisy or bad examples.
- Some are worth pinning even if they are not explicit training examples.

## Evaluation annotation storage
For the 49-photo evaluation set, source-of-truth annotations should live as:
- **JSON files in the repo**

### Why
This format is:
- fast for tools to read
- structured
- version controlled
- easy to diff
- easy to validate
- reusable in future evaluation scripts

### Annotation storage philosophy
- Evaluation data should be easy for both humans and tools to work with.
- Repo-stored JSON is preferable to browser-only state or hard-to-parse markdown tables.

## Formal requirements/spec draft
### Project focus
Phase 1 should prioritize a reliable, improvable domino-scanning workflow before deeply wiring scanner behavior into the rest of the app.

### Tech-stack requirements
Phase 1 should use:
- **YOLO** for full-image tile detection/localization
- a separate downstream tile-value inference stage for ordered tile-value prediction
- **Quick Scan** as the main scanner surface for iteration and validation
- **IndexedDB** for images and rich scan-history persistence
- **localStorage** for lightweight local settings and flags
- **JSON files in the repo** for held-out evaluation annotations

The plan intentionally leaves the exact YOLO version and exact tile-value inference model architecture as TBD, but the above technology choices are fixed enough for Phase 1 planning.

### Scanner definition requirements
The scanner should:
- accept an image
- run YOLO-based tile localization on the full image
- extract reviewable tile crops
- run tile-level ordered value inference on each crop
- infer orientation and observed order
- predict two values per tile
- attach confidence
- return structured detections suitable for review, persistence, and evaluation

### Detection requirements
The detector should:
- use one `domino_tile` object class initially
- operate on the full source image
- output bounding boxes and detection confidence
- prioritize recall over precision in early Phase 1

### Tile-value inference requirements
The tile-value inference stage should:
- operate on each detected tile crop
- predict the ordered observed pair directly
- return first-side and second-side values
- return orientation/order metadata
- return confidence for the ordered prediction

### Training-data requirements
Phase 1 should include:
- a seed detection training dataset
- a seed tile-value inference training dataset
- a held-out evaluation set separate from training
- a workflow for promoting corrected Quick Scan history into curated future training data

The main evaluation set should not serve as the main training dataset.

### Evaluation dataset requirements
Phase 1 should include a **49-photo evaluation set**.

Each evaluation image should support:
- tile identity annotations
- tile bounding-box annotations
- tile orientation annotations

Bounding boxes should be **accurate annotation-grade boxes**.

Orientation annotations should support:
- horizontal vs vertical classification
- approximate/full rotation angle
- enough information to determine which half is first vs second

### Tile value representation requirements
- Primary notation should be **slash-separated strings**, e.g. `2/12`, `9/2`.
- Tile order is orientation-aware:
  - **left/right** when horizontal
  - **top/bottom** when vertical
- Observed order should be preserved in scan review and annotation contexts.

### Evaluation semantics requirements
- A reversed tile such as `12/2` should count as the same tile identity as `2/12`.
- Orientation/order should be scored separately from identity.
- Phase 1 evaluation should report both:
  - tile identity accuracy
  - orientation/order accuracy

### Review-mode display requirements
- Review UI should preserve the observed order exactly as seen in the image.
- Review UI should not normalize the tile to a canonical sorted order for display.

### Quick Scan history requirements
Quick Scan history should persist across app reloads and support:
- reviewing earlier scans
- comparing scan outcomes over time
- identifying recurring failure cases
- supporting future model-improvement workflows

Each saved Quick Scan history record should include:
- image reference
- full original image
- detections
- user corrections
- confidence data
- timestamp

### Local storage requirements
Phase 1 should use split local persistence.

Use IndexedDB for:
- full original images
- scan history entries
- detections
- user corrections
- confidence data
- timestamps
- richer JSON records

Use localStorage for:
- lightweight settings
- preferences
- app flags
- optional recent scan pointers

### Labeling requirements
Each saved scan may optionally be marked as:
- useful for training/improvement
- bad/noisy example
- favorite/important

### Post-scan correction requirements
After a scan, the app should:
- show each detected tile as its own thumbnail
- show detected values in editable inputs
- let the user correct values directly
- provide a **Not Tile** action/button for detections that are not actually a valid tile
- allow the user to add missing tiles manually

Invalid detections may also tolerate placeholder values such as `.` and should ideally normalize internally to `status: "not_tile"`.

### Manual add requirements
When the user adds a missing tile manually, the preferred Phase 1 flow is:
- a single text entry in slash notation, e.g. `2/12`

### Detected-tile edit requirements
When the user edits an existing detected tile:
- use **two separate numeric inputs**
- map these to left/right or top/bottom depending on orientation

### Annotation storage requirements
For the 49-photo evaluation set, source-of-truth annotations should live as:
- **JSON files in the repo**

## Data model draft
This is a planning schema draft, not final production code.

### Tile concepts
```json
{
  "displayNotation": "slash",
  "examples": ["2/12", "9/2"],
  "orderMeaning": {
    "horizontal": ["left", "right"],
    "vertical": ["top", "bottom"]
  },
  "identityComparison": "unordered-pair",
  "reviewDisplay": "preserve-observed-order",
  "evaluation": {
    "identityAccuracy": true,
    "orientationOrderAccuracy": true
  }
}
```

### Detector output example
```json
{
  "detectionId": "det_001",
  "sourceImageId": "img_full_001",
  "bbox": {
    "x": 120,
    "y": 240,
    "width": 88,
    "height": 176
  },
  "detectionConfidence": 0.95
}
```

### Crop-stage output example
```json
{
  "detectionId": "det_001",
  "sourceImageId": "img_full_001",
  "thumbnailImageId": "img_crop_thumb_001",
  "cropImageId": "img_crop_full_001",
  "bbox": {
    "x": 120,
    "y": 240,
    "width": 88,
    "height": 176
  }
}
```

### Inference-stage output example
```json
{
  "detectionId": "det_001",
  "orientation": {
    "layout": "vertical",
    "rotationDegrees": 91,
    "orderedSidesMeaning": ["top", "bottom"]
  },
  "predicted": {
    "first": 2,
    "second": 12,
    "display": "2/12",
    "confidence": 0.93
  }
}
```

### Reviewed detection record
```json
{
  "id": "det_001",
  "status": "detected",
  "source": "model",
  "sourceImageId": "img_full_001",
  "thumbnailImageId": "img_crop_thumb_001",
  "cropImageId": "img_crop_full_001",
  "bbox": {
    "x": 120,
    "y": 240,
    "width": 88,
    "height": 176
  },
  "orientation": {
    "layout": "vertical",
    "rotationDegrees": 91,
    "orderedSidesMeaning": ["top", "bottom"]
  },
  "predicted": {
    "first": 2,
    "second": 12,
    "display": "2/12",
    "confidence": 0.93
  },
  "userCorrection": {
    "first": 2,
    "second": 12,
    "display": "2/12",
    "status": "confirmed"
  },
  "reviewFlags": {
    "notTile": false,
    "manuallyAdded": false
  }
}
```

### Not-tile / invalid detection example
```json
{
  "id": "det_014",
  "status": "not_tile",
  "source": "model",
  "sourceImageId": "img_full_001",
  "thumbnailImageId": "img_crop_thumb_014",
  "cropImageId": "img_crop_full_014",
  "bbox": {
    "x": 510,
    "y": 190,
    "width": 94,
    "height": 180
  },
  "orientation": {
    "layout": "vertical",
    "rotationDegrees": 270,
    "orderedSidesMeaning": ["top", "bottom"]
  },
  "predicted": {
    "first": 8,
    "second": 11,
    "display": "8/11",
    "confidence": 0.41
  },
  "userCorrection": {
    "status": "not_tile",
    "display": "."
  },
  "reviewFlags": {
    "notTile": true,
    "manuallyAdded": false
  }
}
```

### Manually added missing tile example
```json
{
  "id": "manual_003",
  "status": "confirmed",
  "source": "manual",
  "thumbnailImageId": null,
  "cropImageId": null,
  "bbox": null,
  "orientation": null,
  "predicted": null,
  "userCorrection": {
    "first": 9,
    "second": 2,
    "display": "9/2",
    "status": "added"
  },
  "reviewFlags": {
    "notTile": false,
    "manuallyAdded": true
  }
}
```

### Quick Scan history record
```json
{
  "scanId": "scan_2026_06_30_001",
  "createdAt": "2026-06-30T18:42:11Z",
  "sourceImage": {
    "imageId": "img_full_001",
    "storage": "indexeddb",
    "mimeType": "image/jpeg",
    "width": 3024,
    "height": 4032
  },
  "scannerVersion": {
    "detector": "yolo",
    "tileValueInference": "ordered-pair-phase1"
  },
  "detections": [
    {
      "id": "det_001",
      "status": "detected"
    },
    {
      "id": "det_014",
      "status": "not_tile"
    }
  ],
  "finalReviewedTiles": [
    "2/12",
    "9/2",
    "0/0"
  ],
  "metrics": {
    "detectionCount": 14,
    "confirmedTileCount": 11,
    "notTileCount": 3
  },
  "tags": {
    "usefulForTraining": true,
    "badExample": false,
    "starred": true
  },
  "notes": "False positives on upside-down partial crops."
}
```

### Evaluation-image annotation file draft
```json
{
  "imageId": "eval_017",
  "imagePath": "evaluation/images/eval_017.jpg",
  "imageWidth": 3024,
  "imageHeight": 4032,
  "tiles": [
    {
      "tileId": "tile_01",
      "identity": {
        "first": 2,
        "second": 12,
        "display": "2/12",
        "unorderedKey": "2-12"
      },
      "observedOrder": {
        "firstMeaning": "top",
        "secondMeaning": "bottom"
      },
      "bbox": {
        "x": 210,
        "y": 388,
        "width": 120,
        "height": 232
      },
      "orientation": {
        "layout": "vertical",
        "rotationDegrees": 89
      }
    },
    {
      "tileId": "tile_02",
      "identity": {
        "first": 9,
        "second": 2,
        "display": "9/2",
        "unorderedKey": "2-9"
      },
      "observedOrder": {
        "firstMeaning": "left",
        "secondMeaning": "right"
      },
      "bbox": {
        "x": 470,
        "y": 420,
        "width": 210,
        "height": 104
      },
      "orientation": {
        "layout": "horizontal",
        "rotationDegrees": 2
      }
    }
  ]
}
```

## Review checklist
Use this checklist to pressure-test the build plan rather than just approving it.

### Tech-stack clarity
- Are the chosen Phase 1 technologies explicit enough?
- Is it clear which technologies are fixed vs still TBD?
- Is the YOLO choice stated clearly enough?
- Is the local storage split stated clearly enough?
- Is the evaluation annotation format stated clearly enough?

### Scanner architecture clarity
- Does the document clearly define what the scanner is for?
- Does the document clearly define what the scanner is?
- Is the YOLO detection stage concrete enough to implement?
- Is the tile-value inference stage concrete enough to implement?
- Is the ordered-pair prediction strategy the right Phase 1 choice?
- Are stage boundaries and outputs explicit enough?

### Training-data design
- Is the training-data plan clearly separate from the evaluation set?
- Do we have a workable seed-data strategy for detection training?
- Do we have a workable seed-data strategy for tile-value inference training?
- Is the promotion workflow from corrected scans into curated training data clear enough?
- Are held-out evaluation boundaries clear enough to avoid contamination?

### Product coherence
- Does the Quick Scan-first strategy make sense?
- Is it clear enough that Round-end Scan can lag behind until Quick Scan stabilizes?
- Are we avoiding premature wiring of unreliable scanner behavior into the rest of the app?
- Is the correction workflow realistic for phone use?

### Tile semantics
- Is the distinction between **tile identity** and **observed orientation/order** clear enough?
- Is it correct to treat `2/12` and `12/2` as identity-equal but orientation-order-different?
- Is slash notation the right user-facing standard?
- Is the left/right vs top/bottom interpretation defined clearly enough?

### Evaluation design
- Is the 49-photo evaluation set enough for early benchmarking?
- Are annotation-grade bounding boxes required, or is that too costly for Phase 1?
- Is the orientation annotation detail appropriate?
- Are the proposed metrics sufficient:
  - tile identity accuracy
  - orientation/order accuracy

### Correction UX
- Is thumbnail-per-detection review the right default?
- Are two separate numeric inputs for editing existing detections the right choice?
- Is single text slash input the right choice for manually adding missing tiles?
- Should `.` be supported explicitly, or should the UI push all invalid cases into **Not Tile** only?
- Does the plan need a separate delete/remove action distinct from **Not Tile**?

### Data model sanity
- Are the detector, crop, inference, and reviewed-detection records separated clearly enough?
- Do we need both `display` and structured `first`/`second`, or is that redundant?
- Should manual entries and detected entries share the exact same schema?
- Is `unorderedKey` the right canonical identity helper?
- Is the `scannerVersion` block describing the planned stack clearly enough?

### Storage strategy
- Is the IndexedDB/localStorage split the right Phase 1 design?
- Is full-image retention necessary for model improvement, or too heavy?
- Should thumbnails/crops be persisted separately, or generated on demand?
- Are there privacy/storage-size concerns with keeping full original images locally?
- Do we need export/import JSON early, or can it wait?

### Model-improvement usefulness
- Does the saved history include enough information to diagnose model failures?
- Are confidence values enough, or do we also want raw detection metadata later?
- Should scans support freeform notes?
- Are the three tags enough:
  - usefulForTraining
  - badExample
  - starred
- Should we add a way to surface hard cases automatically later?

### Repo annotation format
- Are JSON files in the repo clearly the best format for evaluation annotations?
- Should there be one JSON per image, or one larger manifest plus per-image files?
- Do we need a formal schema/validation script early?
- Do the JSON files need normalized keys/naming conventions now to avoid churn later?

### Risks / unresolved concerns
- Are there hidden contradictions between preserving observed order and counting reversed tiles as correct?
- Could users be confused by identity-correct but orientation-wrong scoring?
- Is the correction workflow too manual for the expected scan volume?
- Are we overspecifying before learning from a few real scan sessions?
- What is still missing that would block implementation?

## Suggested review package for another agent
Ask the reviewing agent to specifically evaluate:
1. tech-stack clarity
2. scanner purpose clarity
3. scanner architecture clarity
4. YOLO detection formulation
5. tile-value inference formulation
6. training-data plan quality
7. product logic
8. data model coherence
9. evaluation design
10. correction UX
11. risks of overengineering or missing architecture decisions
