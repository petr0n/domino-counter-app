# Domino Scanner Phase 1 Plan, Spec, and Decision Log

## Purpose
Phase 1 should prioritize a reliable, improvable domino-scanning workflow before deeply wiring scanner behavior into the rest of the app.

This document records the agreed scanner, product, evaluation, storage, and review decisions so they are not lost between sessions and can be reviewed by other agents.

## Why the first draft missed the mark
The first versions of this plan over-documented everything around the scanner while under-defining the scanner itself.

What went wrong:
- The plan captured review UX, history, storage, evaluation, and correction behavior before clearly defining what the scanner is.
- It treated scanner-adjacent decisions as if they were enough to explain the scanner.
- It failed to define the scanner as a concrete subsystem with a clear input/output contract.
- It did not sharply separate scanner responsibilities from review-layer responsibilities.
- It focused on preserving decisions from prior discussion more than on expressing the core architecture plainly.

What this means:
- The document was useful as a decision log, but incomplete as a scanner plan.
- A scanner plan must first explain the scanner itself, then explain the systems around it.

Corrective principle for this document:
- Define the scanner first.
- Then define how review, evaluation, persistence, and correction support that scanner.

## Core planning stance
- The goal of this plan is to capture the **gist of every meaningful product and implementation decision made so far**, not a verbatim transcript of all prior questions.
- The emphasis is on preventing gaps in scanner behavior, review behavior, evaluation design, storage design, and future improvement workflow.
- When a later implementation choice is ambiguous, this document should be treated as the current source of intent unless explicitly superseded.

## Scanner definition
The Phase 1 scanner is the image-to-tile-detections subsystem used first in Quick Scan.

Its job is to:
1. accept an input image
2. find candidate domino tiles in that image
3. isolate each candidate as its own reviewable tile crop/thumbnail
4. determine tile orientation and observed side order
5. predict the two pip values for each candidate tile
6. attach confidence/score information
7. return results in a form that can be reviewed, corrected, persisted, and evaluated

The scanner is not just “pip counting.” It is the full process from image input to structured tile detections that a human can verify.

## Scanner responsibilities
In Phase 1, the scanner is responsible for:
- image ingestion from the scan surface
- tile candidate detection
- per-tile crop/thumbnail generation
- per-tile value prediction
- per-tile orientation/order prediction
- per-tile confidence reporting
- returning structured detections for review

The scanner is not responsible for:
- being perfectly final without review
- full app-wide synchronization from day one
- replacing correction UX
- hiding uncertainty

## Scanner input/output contract

### Input
The scanner takes:
- a captured image from Quick Scan
- later, the same scanner contract should be reusable by other scanning surfaces

### Output
At minimum, each scanner detection should provide:
- a unique detection id
- a tile crop/thumbnail
- a bounding box in the source image
- predicted first-side value
- predicted second-side value
- orientation metadata
- observed-order meaning (left/right or top/bottom)
- confidence/score
- status suitable for later review normalization

The scanner as a whole should return:
- all detections for the image
- enough metadata for review and history
- enough structure for future evaluation against ground truth

## Scanner pipeline shape
The exact implementation may evolve, but the Phase 1 scanner conceptually has these stages:
1. input image capture
2. candidate tile detection/localization
3. tile crop extraction
4. orientation/order inference
5. pip-value prediction per tile
6. confidence attachment
7. handoff to review/correction flow

## Scanner success criteria
The Phase 1 scanner is successful if it:
- produces reviewable candidate tiles reliably enough to be useful
- makes correction fast rather than painful
- preserves enough evidence to diagnose why it failed
- can be benchmarked against a fixed evaluation set
- can improve over time through saved scans and corrections

## Scanner scope vs non-scope

### In scope for Phase 1
- image-to-detection pipeline
- candidate tile extraction
- tile value prediction
- orientation/order prediction
- reviewable outputs
- correction-loop support
- evaluation support
- history support for improvement

### Not required in scope for Phase 1
- full scanner automation with no human correction
- tightly synchronized behavior across every app surface immediately
- prematurely finalizing architecture before Quick Scan proves the workflow

## Product strategy

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

## Evaluation dataset
Phase 1 should include a **49-photo evaluation set**.

### Purpose of the evaluation set
- Benchmark scanner quality consistently.
- Compare scanner improvements over time.
- Diagnose whether changes improve tile identity detection, orientation correctness, and review usability.
- Support a disciplined improvement loop instead of guessing.

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

### Scanner product strategy
- **Quick Scan** is the primary experimentation and validation surface.
- **Round-end Scan** may lag behind initially and does not need to stay tightly synced with Quick Scan at first.
- Once Quick Scan is stable and accurate, the rest of the app should be wired to use the proven scanner pipeline.
- Long term, Quick Scan and Round-end Scan should converge on the same underlying scanner logic/model.

### Scanner definition requirements
The scanner should:
- accept an image
- detect candidate tiles
- extract reviewable tile crops
- infer orientation and observed order
- predict two values per tile
- attach confidence
- return structured detections suitable for review, persistence, and evaluation

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

### Detected tile record
```json
{
  "id": "det_001",
  "status": "detected",
  "source": "model",
  "thumbnailImageId": "img_crop_001",
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
  "thumbnailImageId": "img_crop_014",
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
    "pipeline": "quick-scan-v1",
    "modelVersion": "model-0.1.0"
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

### Local settings example
```json
{
  "storageStrategy": {
    "history": "indexeddb",
    "settings": "localstorage"
  },
  "recentScanIds": [
    "scan_2026_06_30_001",
    "scan_2026_06_30_000"
  ],
  "preferences": {
    "showConfidenceScores": true,
    "defaultReviewSort": "scan-order"
  }
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
Use this checklist to pressure-test the plan rather than just approving it.

### Scanner clarity
- Does the document now clearly define what the scanner is?
- Is the scanner input/output contract explicit enough?
- Are scanner responsibilities distinguished from review UX and storage responsibilities?
- Is the scanner scope for Phase 1 clear enough?

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
- Are the proposed detection objects too detailed, too sparse, or about right?
- Should `status`, `reviewFlags`, and `userCorrection` be simplified?
- Do we need both `display` and structured `first`/`second`, or is that redundant?
- Should manual entries and detected entries share the exact same schema?
- Is `unorderedKey` the right canonical identity helper?

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
1. scanner definition clarity
2. product logic
3. data model coherence
4. evaluation design
5. correction UX
6. risks of overengineering or missing architecture decisions

## Notes for later review
These decisions were chosen to support scanner improvement first, especially through Quick Scan history, image retention, correction review, and an evaluation dataset that separates tile identity from orientation/order accuracy.
