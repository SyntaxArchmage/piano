---
name: review-and-refine
description: "Use when the user asks for a bounded code review and refinement: find small, certain improvements that preserve behavior and have no unresolved design questions, implement the chosen fix, review it, verify it, and commit it."
---

# Review and Refine

Use this skill for one bounded refinement pass.

## Completion contract

Use `/goal` before editing. State the goal as one objective with all acceptance conditions joined by AND:

- the target is a small, behavior-preserving improvement;
- no design question remains unresolved with the user;
- the change follows repository conventions;
- focused validation passes;
- the completed diff has been reviewed;
- the commit exists and contains only this task.

`/goal` may represent multiple conditions. Treat them as a conjunction: do not declare success while any condition is incomplete. If the client cannot model compound conditions, keep the same AND checklist in the active goal or the `docs/` worklog and verify every item manually.

## Procedure

1. Inspect `git status`, the nearest implementation and callers, adjacent tests, repository instructions, and recent relevant history. Preserve unrelated user changes.
2. Find only issues that are clearly non-functional refinements. Stop and ask the user if behavior, API compatibility, product direction, or design intent is genuinely uncertain. Do not invent features or turn a preference into a fix.
3. Write a short local hypothesis, the cheapest falsifying check, and the smallest change. Implement it with existing TypeScript, Effect, testing, and naming conventions. Avoid broad cleanup and new dependencies.
4. Run the narrowest relevant test, typecheck, or lint command immediately after the edit. Repair only failures caused by this change, then rerun the same check.
5. Review the complete diff as a reviewer: regressions, error paths, public contracts, persistence, tests, docs, and unrelated changes. For Codex run `/review`; for Claude CLI run `/code-review`; in Copilot use the available code-review action or review the diff yourself. An interrupted or unavailable review is not a pass; record the limitation and do not claim a completed review.
6. Run the focused validation again after review fixes, then the appropriate broader check when the touched boundary warrants it.
7. Update relevant documentation or the repository worklog (under `docs/`) only when required by the change. Commit with a concise message only after every `/goal` condition passes. Never push unless the user explicitly asks.

## Stop conditions

Ask instead of editing when there is a real design choice, a behavior change, missing authority, or a need to invent a feature. Report blockers precisely. Never use destructive git commands, reset user work, or hide failing validation.
