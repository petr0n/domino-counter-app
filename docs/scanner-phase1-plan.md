# Domino Scanner Plan and Decision Log

## Purpose
Phase 1 should prioritize a reliable, improvable domino-scanning workflow before deeply wiring scanner behavior into the rest of the app.

This document records the agreed scanner/product decisions so they are not lost between sessions and can be reviewed by other agents.

## Product strategy

### Quick Scan vs Round-end Scan
- **Quick Scan** is the primary experimentation and validation surface.
- **Round-end Scan** may lag behind initially and does not need to stay tightly synced with Quick Scan at first.
- Quick Scan is the tester/experiment tool.
- Once Quick Scan is stable and accurate, the rest of the app should be wired to use the proven scanner pipeline.
- Long term, Quick Scan and Round-end Scan should converge on the same underlying scanner logic/model.

## Evaluation dataset
Phase 1 should include a **49-photo evaluation set**.

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

### Meaning of order
Tile order is orientation-aware:
- **left/right** when the tile is horizontal
- **top/bottom** when the tile is vertical

### Preservation of observed order
- Observed order should be preserved in scan review and annotation contexts.
- In review mode, preserve the detected/annotated order exactly as seen in the image.
- Do not normalize display to a canonical sorted order.

## Evaluation semantics

### Tile identity scoring
- A reversed tile such as `12/2` should count as the same tile identity as `2/12`.
- If the tile is a correct match, reversed order still counts as **correct** for identity.

### Orientation/order scoring
- Orientation/order should be scored separately from identity.

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

## Scan-history contents
Each saved Quick Scan history record should include:
- image reference
- full original image
- detections
- user corrections
- confidence data
- timestamp

The saved history should preserve enough information to understand why a scan failed, including image evidence.

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

## Scan-history labeling
Each saved scan may optionally be marked as:
- useful for training/improvement
- bad/noisy example
- favorite/important

Recommended simple flags:
- `usefulForTraining`
- `badExample`
- `starred`

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

## Notes for later review
These decisions were chosen to support scanner improvement first, especially through Quick Scan history, image retention, correction review, and an evaluation dataset that separates tile identity from orientation/order accuracy.
