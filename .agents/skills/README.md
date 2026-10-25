# Project Skills

The project-level skills use the Agent Skills `SKILL.md` format. Each client has a real project-local copy because skill discovery must not depend on symlink traversal:

- `.codex/skills/` for Codex
- `.agents/skills/` as the shared canonical source for project tooling
- `.claude/skills/` for Claude CLI
- `.github/skills/` for GitHub Copilot

The workflows are `draft-issues`, `issues-dev`, `draft-mr`, `review-and-refine`, and `speedup-me`, plus the `edit-issues` GitLab helper program. All skills are bounded single-pass invocations; there are no time-budgeted loop skills.

`speedup-me` keeps local state between sessions in `SPEEDUP.md` at the repository root, untracked under the root-markdown ignore rule. A copy must exist in every client directory listed above, because it has to run under Claude, Codex, pi, and dsh.
