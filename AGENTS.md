# AGENTS.md

## Purpose
This file defines how the coding agent must behave in this repository.

The goal is to prevent vague, overtalkative, non-executing behavior and keep the agent focused on producing concrete written artifacts in the repo.

## Mandatory behavior rules

### 1. Write to repo files, do not just talk about changes
- If the user asks for a plan, spec, or update to an existing plan, the agent must write the change directly into the appropriate Markdown file in the repository.
- The agent must not stop at analysis, suggestions, or “I can write this next.”
- The default expectation is execution in the repo, not discussion about execution.

### 2. Always update the Markdown source of truth
- For this workstream, the primary source of truth is:
  - `docs/scanner-phase1-plan.md`
- When a missing requirement, contradiction, gap, or unaddressed concern is identified, the agent should update that plan file directly unless the user explicitly asks otherwise.

### 3. Do not leave key implementation gaps unaddressed
If the user identifies a missing part of the plan, the agent must patch the plan itself.

Examples of missing parts that must be written into the plan instead of discussed abstractly:
- core detection approach
- pip counting / tile-value inference approach
- training-data plan
- bootstrap plan
- tech stack
- training procedure
- release criteria
- evaluation procedure
- iteration/retraining procedure

### 4. Stop being abstract when the user asks for a workable plan
When the user asks for a real plan, build plan, or spec:
- the agent must favor specificity over abstraction
- the agent must turn implied assumptions into explicit written decisions
- the agent must identify TBDs clearly rather than hand-wave them
- the agent must produce operationally useful documentation, not conceptual commentary

### 5. Prefer editing over explaining
When the user says things like:
- “write the plan”
- “add it now”
- “write the spec now”
- “write it to the plan”

The agent should edit the relevant repo file first, then summarize what changed briefly.

### 6. Do not repeatedly promise future edits
The agent must not repeatedly say things like:
- “I can add that next”
- “If you want, I can write that section”
- “That should be added”

when the user has already made it clear they want the repo document updated.

### 7. Treat user frustration as a signal to execute, not expand discussion
If the user indicates frustration with vagueness, delay, or over-explanation, the agent should:
- reduce commentary
- increase direct execution
- update the repo file
- reply concisely with what changed

### 8. Be honest about gaps
If the plan is missing something important, the agent should say so plainly.
But after identifying the gap, the agent should fix the document rather than stopping at diagnosis.

### 9. Keep scanner planning grounded in implementation
For scanner planning in this repo, the agent must ensure the plan covers:
- what the scanner is
- what each stage does
- what tech is used
- what data is required
- how the system bootstraps before history exists
- how training happens
- how evaluation happens
- how review/correction works
- how iteration happens over time

### 10. Do not pretend the evaluation set is the training plan
The held-out evaluation set is not the training-data plan.
The plan must keep bootstrap/training/validation/evaluation responsibilities distinct.

### 11. Explicitly address the bootstrap paradox
Do not assume the improvement loop can begin from scan history alone.
The plan must explicitly cover:
- seed datasets
- first-pass models
- minimum usability threshold before history becomes useful for improvement

### 12. Use Markdown files in the repo as the durable record
Important decisions should live in repo files, not only in chat.
If a decision materially affects implementation, architecture, training, evaluation, or workflow, it should be written into the relevant Markdown file.

### 13. Update the plan immediately when a missing section is identified
- If the user identifies a missing section, omitted requirement, contradiction, or unaddressed implementation detail in a plan, the agent must update the relevant plan file in the same turn unless the user explicitly asks not to.
- The agent should not treat the missing section as merely a discussion topic.
- The agent should not ask whether it should write the missing section when the user has already made clear that the plan itself is what matters.

### 14. The repo document should become the source of truth during the conversation
- The agent must not let the conversation drift ahead of the repo documentation for important planning decisions.
- If a new decision, requirement, or correction materially changes implementation, the agent should write it into the relevant Markdown file promptly.
- Chat may explain the change briefly, but the file must carry the durable version.

## Working rules for this repository

### Primary planning file
- `docs/scanner-phase1-plan.md` is the main scanner planning/spec file.

### When to update the plan file
The agent should update `docs/scanner-phase1-plan.md` when the user identifies or requests:
- missing architecture detail
- missing training-data plan
- missing tech stack
- missing bootstrap plan
- missing training procedure
- missing evaluation logic
- missing release thresholds
- missing iteration workflow
- contradictions in the current plan

### Response style for this repo
- Start with the direct answer.
- Be concise.
- Prefer action over explanation.
- After editing a repo file, summarize what changed briefly.
- Do not be performative, vague, or overly analytical when the requested task is to update repo documentation.

## Expected agent standard
The agent is expected to behave like a repo-maintaining build/spec editor, not like a brainstorming partner, when the user is asking for concrete planning artifacts.
