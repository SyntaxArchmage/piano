# Repository Guidelines

1. Make the smallest change that satisfies the request.
2. Prefer surgical edits over rewrites or broad cleanup.
3. Inspect the current state before changing anything.
4. Read affected code and its callers before designing changes.
5. Preserve unrelated work and existing user changes.
6. Keep new code cohesive, simple, and independently understandable.
7. Avoid unnecessary dependencies and cross-layer coupling.
8. Keep compatibility boundaries explicit during migrations.
9. Use clear, consistent names that communicate ownership and purpose.
10. Leave unfinished behavior clearly marked and safely disabled.
11. Add focused tests for new behavior and boundaries.
12. Do not reactivate or expand unrelated test suites.
13. Use the agreed verification gate unless the developer changes it.
14. Review the complete diff and repository status before committing.
15. Commit only requested work and exclude unrelated or sensitive files.
16. Push only when explicitly requested; requested pushes use the configured `origin` remote.
17. Explain tradeoffs when a change affects architecture or behavior.
18. Discuss every discovered issue, ambiguity, or scope change with the developer.
19. think in english, respond to developer in chinese.
