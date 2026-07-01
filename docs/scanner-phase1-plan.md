# Plan Draft: Domino Scanner Phase 1

## Purpose
Phase 1 should prioritize a reliable, improvable domino-scanning workflow before deeply wiring scanner behavior into the rest of the app.

## Scanner product strategy
- **Quick Scan** is the primary experimentation and validation surface.
- **Round-end Scan** may lag behind initially and does not need to stay tightly synced with Quick Scan at first.
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

## Evaluation semantics
### Tile identity scoring
- A reversed tile such as `12/2` should count as the same tile identity as `2/12`.

### Orientation/order scoring
- Orientation/order should be scored separately from identity.

### Required metrics
Phase 1 evaluation should report both:
- tile identity accuracy
- orientation/order accuracy

## Review-mode display
- Review UI should preserve the observed order exactly as seen in the image.
- Review UI should not normalize the tile to a canonical sorted order for display.

## Quick Scan history persistence
Quick Scan history should persist across app reloads.

### Purpose
History should support:
- reviewing earlier scans
- comparing scan outcomes over time
- identifying recurring failure cases
- supporting future model-improvement workflows

## Scan-history contents
Each saved Quick Scan history record should include:
- image reference
- full original image
- detections
- user corrections
- confidence data
- timestamp

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

## Scan-history labeling
Each saved scan may optionally be marked as:
- useful for training/improvement
- bad/noisy example
- favorite/important

## Post-scan correction UX
After a scan, the app should:
- show each detected tile as its own thumbnail
- show detected values in editable inputs
- let the user correct values directly
- provide a **Not Tile** action/button for detections that are not actually a valid tile
- allow the user to add missing tiles manually

### Invalid/false detection handling
- The UX may also tolerate placeholder invalid values such as `.`
- Internally, invalid detections should ideally normalize to a structured state such as `status: "not_tile"`

## Manual add UX
When the user adds a missing tile manually, the preferred Phase 1 flow is:
- a single text entry in slash notation, e.g. `2/12`

## Detected-tile edit UX
When the user edits an existing detected tile:
- use **two separate numeric inputs**
- these map to left/right or top/bottom depending on orientation

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
