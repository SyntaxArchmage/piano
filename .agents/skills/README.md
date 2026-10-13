# Project Skills

The project-level skills use the Agent Skills `SKILL.md` format. Each client has a real project-local copy because skill discovery must not depend on symlink traversal:

- `.codex/skills/` for Codex
- `.agents/skills/` as the shared canonical source for project tooling
- `.claude/skills/` for Claude CLI
- `.github/skills/` for GitHub Copilot

The workflows are `draft-issues`, `issues-dev`, `draft-mr`, `review-and-refine`, `review-me`, `refactor-me`, `speedup-me`, and `teach-me`, plus the `edit-issues` GitLab helper program. All skills are bounded single-pass invocations; there are no time-budgeted loop skills.

Four skills keep local state between sessions, all at the repository root and untracked under the root-markdown ignore rule: `review-me` reads and rewrites `TASTE.md` and `REVIEW.md`, `refactor-me` reads and rewrites `REFACTOR.md`, `speedup-me` reads and rewrites `SPEEDUP.md`, and `teach-me` reads and rewrites `LEARN.md`. A copy of each must exist in every client directory listed above, because it has to run under Claude, Codex, pi, and dsh.
