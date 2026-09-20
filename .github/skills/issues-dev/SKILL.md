---
name: issues-dev
description: "Use when the user names or selects GitLab issues to implement in one bounded development task: understand the issue, design within repository and TypeScript conventions, implement, review, validate, and commit with /goal."
---

# Issues Dev

Implement one explicitly selected issue or a tightly coupled issue set. The issue is the authority; do not silently expand scope.

## Goal gate

Before editing, invoke `/goal` with an AND checklist:

- the specified issue target is understood and bounded;
- the design follows repository conventions and TypeScript best practices;
- implementation and focused tests are complete;
- the diff has passed a client-appropriate review;
- validation evidence is recorded;
- the commit is complete and scoped to the issue.

If compound goals are unsupported, keep this checklist visible in the `docs/` worklog and require every item.

## Procedure

1. Resolve the issue from the user's identifier or GitLab. For remote issues, use `GITLAB_TOKEN` from `~/.claude/.env` without printing it. Read repository instructions, status, recent history, relevant code, callers, tests, docs, and persistence/error boundaries.
2. State the issue's acceptance evidence, constraints, and one smallest coherent design. Confirm with the user only when the issue itself leaves a real product or compatibility choice open; otherwise proceed autonomously.
3. Implement using the existing TypeScript patterns. Use `Effect` for typed failure composition, async/cancellation/resource lifetime, or injected services; keep deterministic transformations plain. Do not add speculative abstractions or dependencies.
4. Immediately run focused tests/typecheck/lint. Fix local failures and rerun. Then review the full diff for behavior, contracts, edge cases, tests, docs, and unrelated changes.
5. Review gate: Codex `/review`, Claude CLI `/code-review`, or Copilot's review capability. An incomplete review fails the gate.
6. Rerun relevant validation after review fixes, record exact commands/results and remaining risks, then commit with a concise issue-linked message. Push is not automatic; only push when explicitly requested.

Preserve all unrelated work. Never use destructive git commands or close an issue based only on a passing aggregate test.
