# Web-First Domino ML Plan — Operator Checklist (Execution Runbook)

**Companion doc:** `docs/scanner-phase1-plan.md`  
**Scope:** Execute Phase 1 with strict focus on tile detection + pip reading first, while preserving a lightweight path for later round/game UX.  
**Rule:** No architecture or multiplayer expansion that distracts from scan accuracy until the scanner acceptance gates are met.

---

## 0) Operating Rules (Must Hold)

- [ ] Tile detection accuracy is the top priority
- [ ] Pip-reading accuracy is the top priority
- [ ] Nothing ships that reduces scanner reliability
- [ ] Keep implementation simple; avoid unnecessary complexity
- [ ] Use low-cost, local-first development paths where possible
- [ ] Do not spend major effort on multiplayer/backend architecture until scanner quality is proven
- [ ] Quick Scan remains available as a testing/validation surface during Phase 1

---

## 1) Phase 1 Product Direction

- [ ] Ground-up build
- [ ] Features are added only when explicitly specified
- [ ] Catalog is out of scope
- [ ] Auth/accounts are out of scope
- [ ] localStorage now; Postgres later
- [ ] Multiplayer syncing is deferred until after scanner quality is proven

---

## 2) Core Scanner Requirements

### 2.1 Success definition
- [ ] Detect all tiles present in an image as reliably as possible
- [ ] Correctly read the pip values for each detected tile as reliably as possible
- [ ] Reach as close to 100% combined tile detection + pip reading accuracy as practical

### 2.2 Behavior under uncertainty
- [ ] Show best guesses when uncertain
- [ ] Mark uncertain results for user review
- [ ] Use confidence labels: `high`, `medium`, `low`
- [ ] Avoid numeric confidence UI unless it becomes necessary later

### 2.3 Correction workflow
- [ ] Scanner results must be editable before final confirmation
- [ ] User can fix incorrect tile values
- [ ] User can remove incorrect detections
- [ ] Correction UX must stay simple and fast

---

## 3) Quick Scan (Required in Phase 1)

### 3.1 Purpose
- [ ] Provide a direct way to test scanner progress
- [ ] Confirm the scan model works end-to-end
- [ ] Serve as a playground for UX/UI decisions
- [ ] Support repeatable validation during implementation

### 3.2 Position in product
- [ ] Quick Scan is accessible in the app for now
- [ ] It is primarily a testing/validation surface during Phase 1
- [ ] It may be hidden or deprioritized later

### 3.3 Starting feature baseline
Carry forward the current `quick.html` feature set as the planning baseline:
- [ ] Camera-based scan flow
- [ ] Photo upload / load photo
- [ ] Multi-tile detection from a single image
- [ ] Review detected tiles before confirming
- [ ] Edit left/right values per detected tile
- [ ] Remove incorrect detected tiles
- [ ] Show per-tile totals
- [ ] Show aggregate total
- [ ] Keep a visible scanned-tile history/results area
- [ ] Reset / clear all
- [ ] Provide scan guidance/status messaging

---

## 4) Scanner Evaluation (Explicit Feature)

### 4.1 Available evaluation set
- [ ] Use the 49-photo evaluation set provided by the user
- [ ] Treat it as covering the full 91-tile double-12 set
- [ ] Use it to guide scanner iteration and regression testing

### 4.2 Expected results source of truth
- [ ] Store expected results in code/JSON
- [ ] Keep the dataset easy to revise as learning improves
- [ ] Make validation repeatable and comparable across revisions

### 4.3 Evaluation needs
- [ ] Compare detected vs expected tiles for known test images
- [ ] Highlight missed tiles
- [ ] Highlight incorrect tile reads
- [ ] Highlight false-positive/extra detections
- [ ] Make Quick Scan useful for regression testing, not just manual play

---

## 5) Lightweight Round/Game Flow (Secondary to Scanner)

### 5.1 Scope guardrail
- [ ] Implement only the minimum round/game flow needed while scanner work is active
- [ ] Do not let game architecture distract from scan accuracy work

### 5.2 Player identity
- [ ] Players use typed display names
- [ ] Player names are remembered locally on that device

### 5.3 Round model
- [ ] Support numbered rounds
- [ ] Each player must submit something each round
- [ ] Exactly one winner per round
- [ ] Winner submits `I won`
- [ ] Non-winners submit via `Scan my tiles`
- [ ] Show winner and all player scores after round completion

### 5.4 Round-end scan UX
- [ ] Non-winner taps `Scan my tiles`
- [ ] One full-hand scan attempt is the intended flow
- [ ] User reviews detected result
- [ ] User edits/fixes scanned values if needed
- [ ] User submits corrected final hand
- [ ] No partial multi-scan merge workflow in Phase 1

### 5.5 Editing and locking
- [ ] A player can edit their own submission until the round is finalized
- [ ] A round auto-finalizes when exactly one winner exists and all non-winners have submitted
- [ ] No manual finalize step is required

### 5.6 After finalization
- [ ] Show completed round results
- [ ] Require explicit tap on `Start Next Round`
- [ ] Any player can start the next round

---

## 6) Storage and Architecture Direction

### 6.1 Near-term
- [ ] Use localStorage in Phase 1
- [ ] Treat create/join game as local-first prototype behavior for now

### 6.2 Later
- [ ] Plan for Postgres-backed persistence later
- [ ] Plan true multi-device synchronization later
- [ ] Do not over-design backend decisions before scanner quality is proven

---

## 7) Acceptance Gates (Scanner First)

- [ ] Tile detection recall reaches agreed target
- [ ] Exact tile-read accuracy reaches agreed target
- [ ] Combined scanner behavior is stable across the provided test-photo set
- [ ] Uncertain results are clearly surfaced and easy to correct
- [ ] No regression is accepted without measurement

**If any fail:** remain focused on scanner iteration and do not expand scope.

---

## 8) Iteration Rules

- [ ] Use evaluation data to drive changes
- [ ] Prefer fewer, better-informed iteration loops over trial-and-error churn
- [ ] Keep files and changes small where practical
- [ ] Preserve or improve scanner accuracy with every accepted change
- [ ] Avoid spending effort on features that do not improve detection reliability, pip-reading reliability, or scanner validation
