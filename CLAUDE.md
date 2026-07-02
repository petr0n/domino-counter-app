# Claude Code Rules for This Project

## ⚠️ Direction change — read this first

**This project is being rewritten.** The previous approach — a deterministic
OpenCV.js pipeline (`detect.js` + the HTML pages) — was abandoned after weeks of
effort because it could not be made reliable (it failed on tile *detection* across
too many backgrounds/lighting conditions to hand-tune). **We are not fixing or
extending it.**

**The active direction is a machine-learning rewrite. The source of truth for it
is [`docs/scanner-phase1-plan.md`](docs/scanner-phase1-plan.md).** Read that plan
before doing scanner work. Its spine (§3 decisions):

1. **Synthetic-data-first** — render labeled training tiles from the known pip-grid
   layouts; real photos are held-out eval only.
2. **Detect, don't classify** — two simple object classes (`tile`, `pip`) + known
   grid geometry to count pips per half, instead of memorizing 91 tile faces.
3. **Accuracy before deployment** — prove model accuracy anywhere (Colab/desktop)
   first, then port to on-device ONNX Runtime Web.
4. **A numeric kill-gate up front** (M0) — test the sim-to-real assumption cheaply
   before building app plumbing.

**Do not invest in the legacy OpenCV code.** It stays in the repo as reference
until the rewrite replaces it (see "Current repo state" below).

---

## One Goal

**Turn a phone-camera image of domino tiles into accurate pip counts, every time.**
Every change must serve this. If a change doesn't make tile detection or pip
reading more accurate, more consistent, or more reliable — or directly support
*measuring* those (eval, synthetic data, the training loop) — don't make it.

### Pursue it cheaply — token cost is a first-class constraint

Wasted context and tokens are a real cost the user pays. Being economical is never
an excuse to cut an accuracy corner; it means landing the same *verified* result
with less waste.

- **Read narrowly.** Use `offset`/`limit` and targeted search; never read a large
  file in full when part will do. Never re-read a file already read this session
  unless it changed.
- **Mute noisy commands.** Pipe anything that can dump huge output through
  `tail`/`head`.
- **Fewer loops.** Think a change through and verify locally before iterating.
- **Keep files small and replies concise.** Don't pad, re-explain settled
  decisions, or re-derive established facts.

---

## Working rules (direction-agnostic — always apply)

### Do NOT assume anything
Check facts against the actual code, docs, or a real source before acting. Cite the
file/line or the doc you read. Never state something about the code or an API (e.g.
a YOLO/ONNX Runtime Web/PyTorch call) without verifying it exists.

### Use the internet; own your mistakes
When stuck on an API, technique, or error you don't know cold, search the web for a
working example *before* guessing — then verify it against the real API. No excuses:
diagnose the real cause, don't hand-wave past a failure or ship something
unverified. If you screw up, produce a concrete fix, not an apology.

### Accuracy is measured, not guessed
No accuracy number ships that you didn't run. Evaluate on the **real held-out set**
(`docs/scanner-phase1-plan.md` §7). No milestone advances without its gate measured
(§6). **Regressions are unacceptable** — confirm a metric held or improved before
pushing.

### Get cost approval before spending money
Do not incur paid cloud/compute/API charges (training runs, hosted inference, any
paid API) without the user's explicit per-task approval. In particular, the legacy
Claude-vision experiments (`eval/eval.mjs`, `model-test.html`, any
`api.anthropic.com` call) cost money and are **not** part of the shipped scanner —
do not run them for validation. The ML scanner's accuracy is validated on the eval
set, locally and free where possible.

### DRY — don't repeat yourself
Before writing any function/constant/logic, search for it first; reuse or extend it
rather than pasting a second copy. One responsibility → one place.

### Keep CLAUDE.md and the plan in sync with the code
This file and `docs/scanner-phase1-plan.md` are guardrails — a wrong statement here
sends the next session down the wrong path (it has happened before). When a change
makes either inaccurate, update it in the **same PR**. Don't document aspirational
behavior as if it ships; verify before you write.

---

## Locked domain facts (carry over — do not revisit without instruction)

These are truths about dominoes, independent of CV vs ML:

- **Pip color is NEVER a signal.** Sets use many pip colors (yellow, orange, green,
  blue, purple, black, …). Count every pip regardless of color; never base
  detection, counting, thresholds, prompts, or training labels on a color. Any
  approach must be fully color-agnostic. (For ML: randomize pip color in synthetic
  data; never condition on it.)
- **These are DOUBLE-12 tiles.** Each half holds **0–12 pips**. 91 unique tiles.
  Counting logic must handle the full 0–12 range per half — never assume ≤6.
- **The pip-grid model is deterministic and known.** Every half lays pips on one of
  two grids: **0–9 → 3×3**; **10–12 → 4×3** (top/bottom rows full at 4 each; middle
  row = 10:2 outer, 11:3 spaced left/centre/right with the centre NOT column-aligned,
  12:4). This is reused as **geometry** in the ML plan (render training data from it;
  validate predicted counts against it) — not as a hand-tuned counter.
- **Tiles NEVER overlap.** They may touch edge-to-edge but never sit on top of each
  other. Detection and synthetic scene generation may rely on this.

---

## Current repo state

**Legacy OpenCV app (reference only — do not extend):**
- `detect.js` — the abandoned OpenCV.js detection module (`window.DominoCV`).
- `index.html`, `quick.html` / `quick.js`, `scan.html`, `catalog.html`,
  `test.html`, `model-test.html` — legacy pages.
- `catalog.json`, `config.js`, `sessions/` — legacy data/config.

**Backend:** `worker/` — Cloudflare Worker proxy (GitHub session/catalog
persistence + a legacy `/anthropic` route the app no longer uses). The ML rewrite
is **local-first** (`IndexedDB` + `localStorage`, per the plan) and does not need
this for the scan path.

**Eval / dev tooling (`eval/`):** Node harness + reference crops from the old
pipeline. `grid_eval.cjs` / `detect_eval.cjs` scored the *OpenCV* counter; they do
not evaluate an ML model. The forward-looking eval methodology is in the plan (§7);
build the new eval against the real held-out set there. `capture.sh`,
`log-server.cjs`, `corpus_*.html` are dev capture tools. `eval.mjs` /
`model-test.html` are the **paid** Claude-vision experiments — do not run without
approval.

**Plans (`docs/`):**
- `scanner-phase1-plan.md` — **active source of truth** for the rewrite.
- `web-first-phased-ml-plan-checklist.md` — operator checklist companion.
- `vite-react-ts-migration.md` — **out of date** (assumed OpenCV stayed locked);
  kept for history only.
- `superpowers/` — older detection-corpus spec/plan (legacy).

Note: `docs/` is listed in `.gitignore`, but these files are already tracked — edit
and commit them normally (git keeps tracked files even when gitignored).

---

## Triple-check before pushing

- Verify any external API you call (OpenCV.js, ONNX Runtime Web, a training
  framework, GitHub/Worker) actually exists and is used correctly — don't assume.
- Run the relevant eval and confirm accuracy held or improved before pushing a
  change that touches the scanner.
- The Stop hook (`.claude/hooks/js-check.sh`) syntax-checks changed JS/HTML — fix
  any reported errors before pushing.

---

## PR workflow

Develop on the branch the task specifies. After pushing, open a PR **ready for
review** (not draft). Because this is a deliberate architectural rewrite, **do not
auto-merge** — leave PRs for the user to review unless they say otherwise.
(Legacy cache-bust test links like `localhost:8765/quick.html?v=<PR>` refer to the
old app and no longer apply.)

---

## Project overview

**Domino Counter App** — a phone-first tool to scan domino tiles and read pip
counts, with a lightweight local round/game flow. Currently a static vanilla-JS app
(the legacy OpenCV build) being rewritten around an on-device ML scanner per
`docs/scanner-phase1-plan.md`. Local-first storage; no accounts, no server-side
multiplayer in Phase 1.
