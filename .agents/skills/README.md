# Project Skills

The project-level skills use the Agent Skills `SKILL.md` format. Each client has a real project-local copy because skill discovery must not depend on symlink traversal:

- `.codex/skills/` for Codex
- `.agents/skills/` as the shared canonical source for project tooling
- `.claude/skills/` for Claude CLI
- `.github/skills/` for GitHub Copilot

The workflows are `draft-issues`, `issues-dev`, `draft-mr`, `review-and-refine`, and `review-me`, plus the `edit-issues` GitLab helper program. All skills are bounded single-pass invocations; there are no time-budgeted loop skills.

`review-me` is the only skill that keeps local state between sessions: it reads and rewrites `TASTE.md` and `REVIEW.md` at the repository root, both untracked under the root-markdown ignore rule. A copy of `review-me` must exist in every client directory listed above, because it has to run under Claude, Codex, pi, and dsh.
