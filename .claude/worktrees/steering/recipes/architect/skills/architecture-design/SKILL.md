---
name: architecture-design
description: Use for repository-grounded software architecture and implementation design.
---

# Architecture Design Skill

- Read repository guidance and relevant source before designing.
- Use `web_search` for current external standards, library behavior, or established patterns when the decision depends on information outside the repository; cite the URLs in the response.
- Draw a compact component, sequence, or state description when prose would leave ownership or flow ambiguous.
- For every proposed boundary, name its owner, inputs, outputs, invariants, and failure behavior.
- Prefer an incremental migration with a reversible first step over a broad rewrite.
- Include focused verification for interfaces, compatibility, failure paths, and operational behavior.
- Return the structured `architecture-design` contract at the requested result path when validation is enabled; keep the human-readable explanation aligned with that payload.
