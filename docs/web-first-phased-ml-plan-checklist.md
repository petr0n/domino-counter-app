# Domino Scanner — Operator Runbook (Build Plan v2 Companion)

**Source of truth:** `docs/build-plan-v2.md` — this file is the same plan in
checkbox form, for tracking execution. Section references (§) point there.
Per CLAUDE.md, when one changes the other updates in the same PR.

---

## Who does what (division of labor)

**Your jobs — only the things nobody else can do:**
1. **Camera:** the capture sessions in §1. Before M0 that's exactly one:
   the 91-face session (~30–60 min). The rest come later or conditionally.
2. **Boxes on the 49 eval photos:** ~1 hour in the annotation tool
   (AI-assisted — click a tile, it drafts the box, you accept/adjust).
   Claude sets the project up and gives you the link; you click through it.
3. **Phone:** hand it over for the two timing tests (M1 probe, M2 budgets).
4. **Approvals:** any spend (target is $0) and the review of accuracy
   reports at each gate.

**Claude's jobs — everything else:** annotation project setup, the label
merge script, the scoring harness, the synthetic-data pipeline, all training
runs (Kaggle free GPU), calibration, ONNX export/quantization, all app code,
and running/reporting every measurement. If a task isn't in your list above,
it's not yours.

**First two steps, runnable this week, in parallel:**
- You: the 91-face capture session (§1, Tier-1).
- Claude: annotation project + scoring harness (§2, M-1).

---

## 0) Standing rules (hold for every task)

- [ ] The eval set is never trained on — no exceptions, no "just this once"
- [ ] No milestone advances without its gate **measured** (§6)
- [ ] No regression ships without an explicit, measured justification (§7)
- [ ] No paid compute/API without explicit per-task approval (§5.5)
- [ ] Pip color is never a signal — everything color-agnostic (§1)
- [ ] Scanner code stays a self-contained module: `scanner/`, no DOM, no
      storage, §5.4 contracts as its API (§1)

---

## 1) User capture sessions (§4.3 — external dependency, schedule these)

- [ ] **Tier-1 faces (before M0):** one sitting, ~30–60 min — all 91 faces,
      small groups per photo, a few arrangements/lighting variants.
      (`eval/photos/` does NOT cover this — 49/68 of those ARE the eval set.)
- [ ] **Eval-set growth (M0→M1):** more real multi-tile scenes, toward every
      identity appearing multiple times (§7)
- [ ] **Tier-3 fine-tune scenes (only if M0/M1 show the gap needs them):**
      disjoint from eval; reserve ~20% of them as the calibration set (§5.4)
- [ ] **Phone access:** M1 feasibility probe + M2 budget runs on the real
      mid-range phone (§8)

---

## 2) M-1 — Eval infrastructure (before any training)

- [ ] Annotation tool chosen; **verified** it supports oriented boxes and
      exports a YOLO-OBB-compatible format (Roboflow free tier recommended;
      CVAT fallback)
- [ ] 49 corpus photos imported; boxes + orientation annotated (pip
      identities already verified in `eval/corpus_truth.json` — don't relabel)
- [ ] Merge script written: tool export + `corpus_truth.json` → §11 JSON
      (critical path to M0)
- [ ] Scoring harness computes every §7 metric from model output vs. §11 JSON
- [ ] (Ongoing) eval set grown per capture session above

## 3) M0 — Sim-to-real kill-gate (days, not weeks)

- [ ] Tier-1 crops extracted from the new capture session
- [ ] Copy-paste compositor: blended boundaries, curated backgrounds,
      randomization checklist (§4.4), 0–10% background-only images
- [ ] Nano OBB tile detector trained on **synthetic only** (Kaggle free GPU)
- [ ] Measured on real eval scenes:
  - **PASS = recall ≥ 0.70 @ IoU 0.5** → proceed to M1
  - **FAIL → pivot decision** (§6), not open-ended grinding

## 4) M1 — Accuracy proven (anywhere; no app integration)

- [ ] Tier-2 renderer added (procedural tiles, color-agnostic randomization)
- [ ] Crop pipeline: OBB → perspective-rectify → pad (§5.2)
- [ ] Divider-bar localizer + fallback + bar-error metric (§5.3)
- [ ] Stage-2 baseline counter trained (13-way softmax per half)
- [ ] Gates measured on real eval:
  - [ ] Tile recall ≥ 0.95 @ IoU 0.5
  - [ ] Per-half pip accuracy ≥ 0.97
  - [ ] Exact-tile identity ≥ 0.90
  - [ ] Hand-total exact ≥ 65% pre-correction (provisional, §6)
- [ ] Temperature T fit on calibration set; ECE reported (§5.4)
- [ ] Phone feasibility probe: nano OBB in ORT-Web WASM on the real phone (§8)
- [ ] If baseline counter plateaus below gate → switch to pip-detector target
      (§5.2)

## 5) M2 — On-device port

- [ ] ONNX export + int8 quantization
- [ ] Output parity vs. M1 models on eval crops
- [ ] Budgets on the real phone: e2e ≤ ~2 s, download ≤ ~10–15 MB, WASM
      baseline (WebGPU only if benchmarked faster)
- [ ] Model copied into site assets at deploy; precached by service worker
      (§5.5, §9.0)

## 6) M3 — Quick Scan integration

- [ ] `scanner/` module consumed by Quick Scan (camera + upload)
- [ ] Review/correction UX per §9.2 (calibrated-confidence triage, edit, add,
      not-tile)
- [ ] Local history per §10 (IndexedDB images, rich records)
- [ ] End-to-end eval through the real capture path: no regression vs. M1
- [ ] Hand-total post-correction ≥ 99% measured

## 7) M4 — Minimal round/game flow (single-device, §9.3)

- [ ] Typed names, numbered rounds, one winner, scan-my-tiles, auto-finalize,
      start-next-round
- [ ] No Phase 2 features (no join codes, no game manager, no sync)

---

## 8) Phase 2 (do not start until M1+ gates met)

The multiplayer product in `README.md` — join-by-code sessions, game manager,
cross-device standings. When it starts: add tech stack + implementation
details to `README.md`, and the scanner module ports over unchanged.
