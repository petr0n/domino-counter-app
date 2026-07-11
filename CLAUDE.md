# Claude Code Rules for This Project

## ⚠️ Working environment & file paths — settle BEFORE writing (TOP PRIORITY)

The device the user chats from and the machine where commands run are **different
things**. What matters for file paths is **where Claude Code is actually
executing**, not which device the user is looking at.

- **Running locally on the user's Mac** (VS Code extension, or the `claude` CLI in a
  Mac terminal) → write to the local checkout:
  `/Users/peterabeln/Documents/github/petr0n/domino-counter-app/`
- **Running in the cloud / remote** (web, phone, remote session) → the Mac disk is
  unreachable; work in the cloud checkout and **push to GitHub**.

**How to tell (detect first, don't guess):** check the execution environment — macOS
(Darwin) with the `/Users/peterabeln/...` path present = local Mac; a Linux container
(e.g. `/home/user/...`) = remote/cloud. **If it's genuinely ambiguous, or before the
first file write when unsure, ASK the user** ("Is this running on your Mac, or
remote?") — never assume.

**GitHub `main` is the single source of truth.** Local Mac work and remote work both
sync through it, so nothing is lost switching between Mac and phone: remote sessions
push to GitHub; on the Mac, `git pull` brings that work down.

---

## Source of truth

**The build plan is [`docs/build-plan-v2.md`](docs/build-plan-v2.md).
Read it before doing scanner work.** Its four load-bearing decisions (§3):

1. **Synthetic-data-first** — render labeled training tiles from the known pip-grid
   layouts; real photos are held-out eval only.
2. **Detect, don't classify** — two simple object classes (`tile`, `pip`) + known
   grid geometry to count pips per half, instead of memorizing 91 tile faces.
3. **Accuracy before deployment** — prove model accuracy anywhere (Colab/desktop)
   first, then port to on-device ONNX Runtime Web.
4. **A numeric kill-gate up front** (M0) — test the sim-to-real assumption cheaply
   before building app plumbing.

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

## Working rules

### Do NOT assume anything
Check facts against the actual code, docs, or a real source before acting. Cite the
file/line or the doc you read. Never state something about the code or an API (e.g.
a YOLO/ONNX Runtime Web/training-framework call) without verifying it exists.

### Use the internet; own your mistakes
When stuck on an API, technique, or error you don't know cold, search the web for a
working example *before* guessing — then verify it against the real API. No excuses:
diagnose the real cause, don't hand-wave past a failure or ship something
unverified. If you screw up, produce a concrete fix, not an apology.

### Accuracy is measured, not guessed
No accuracy number ships that you didn't run. Evaluate on the **real held-out set**
(`docs/build-plan-v2.md` §7). No milestone advances without its gate measured
(§6). **Regressions are unacceptable** — confirm a metric held or improved before
pushing.

### Get cost approval before spending money
Do not incur paid cloud/compute/API charges (training runs, hosted inference, any
paid API) without the user's explicit per-task approval. Validate accuracy on the
real held-out eval set — locally and free where possible.

### DRY — don't repeat yourself
Before writing any function/constant/logic, search for it first; reuse or extend it
rather than pasting a second copy. One responsibility → one place.

### Keep CLAUDE.md and the plan in sync with the code
This file and `docs/build-plan-v2.md` are guardrails — a wrong statement here
sends the next session down the wrong path. When a change makes either inaccurate,
update it in the **same PR**. Don't document aspirational behavior as if it ships;
verify before you write.

---

## Domino facts (first principles — do not revisit without instruction)

- **Pip color is NEVER a signal.** Sets use many pip colors (yellow, orange, green,
  blue, purple, black, …). Count every pip regardless of color; never base
  detection, counting, thresholds, or training labels on a color. Everything must
  be fully color-agnostic — randomize pip color in synthetic data; never condition
  on it.
- **These are DOUBLE-12 tiles.** Each half holds **0–12 pips**. 91 unique tiles.
  Counting logic must handle the full 0–12 range per half — never assume ≤6.
- **The pip-grid layout is deterministic and known.** Every half lays pips on one
  of two grids: **0–9 → 3×3**; **10–12 → 4×3** (top/bottom rows full at 4 each;
  middle row = 10:2 outer, 11:3 spaced left/centre/right with the centre NOT
  column-aligned, 12:4). Use this as geometry — render training data from it and
  validate predicted counts against it.
- **Tiles NEVER overlap.** They may touch edge-to-edge but never sit on top of each
  other. Detection and synthetic scene generation may rely on this.

---

## Current repo state

The scanner is **to be built** per the plan — the ML detector + pip reader, the
Quick Scan UI, local storage (`IndexedDB` + `localStorage`), and the eval harness
against the real held-out set. Nothing is implemented yet.

**Present:**
- `CLAUDE.md` — this file.
- `AGENTS.md` — agent behavior rules for planning work.
- `docs/build-plan-v2.md` — the build plan (source of truth).
- `docs/web-first-phased-ml-plan-checklist.md` — operator checklist companion.
- `.claude/` — Stop hook (`hooks/js-check.sh`) that syntax-checks changed JS/HTML.
- `.gitignore` and repo config.

Note: `docs/` is listed in `.gitignore`, but tracked plan files commit normally;
force-add new docs (`git add -f docs/<file>.md`).

---

## Triple-check before pushing

- Verify any external API you call (ONNX Runtime Web, a training framework, a
  detector library, GitHub) actually exists and is used correctly — don't assume.
- Run the relevant eval and confirm accuracy held or improved before pushing a
  change that touches the scanner.
- The Stop hook (`.claude/hooks/js-check.sh`) syntax-checks changed JS/HTML — fix
  any reported errors before pushing.

---

## PR workflow

Develop on the branch the task specifies. After pushing, open a PR **ready for
review** (not draft). Do not auto-merge — leave PRs for the user to review unless
they say otherwise.

---

## Project overview

**Domino Counter App** — a phone-first tool to scan domino tiles and read pip
counts, with a lightweight local round/game flow. Built around an on-device ML
scanner per `docs/build-plan-v2.md`. Local-first storage; no accounts, no
server-side multiplayer in Phase 1.
