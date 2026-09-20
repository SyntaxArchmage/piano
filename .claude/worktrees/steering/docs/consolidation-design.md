# Design note → superseded by the PRD

This scratch document hosted the discussion that produced the canonical
winner-consolidation design. It has been folded into
[`map-winnow-selection-prd.md`](./map-winnow-selection-prd.md) §6 (the 
"Winner consolidation — worker-invariant, engine checks only" section) and its
decision ledger (§15).

Canonical statement of the design (from that PRD §6):

- **Engine ranks** the winner only (pure, in-process, `selection.ts`) — no git.
- **The winner worker consolidates**: the orchestrator re-activates the winner's
  own coding-agent worker in the parent scope with a one-sentence "make the
  shared checkout match your winning state, then confirm" instruction. The worker
  harness does the real git/fs work (merge / rebase / patch / direct edit — any
  way it likes). Engine does no git/merge/copy helper.
- **The engine checks once** with a single read-only directory-diff gate
  (`git diff --no-index --exit-code <targetDir> <winnerDir>`) after the worker
  reports done; on inequality it rejects like a `validation_failed`, feeds the
  worker "what is still wrong", and repairs via the existing validate/repair
  loop.

Key design points the review converged on (do not re-litigate here):

1. **One decision site.** Rank + consolidate + gate live at the region exit,
   which for a single-region run is the end-of-run `finalize` point. No second
   "defense-in-depth" whole-run gate (two duelling decision sites are a hazard).
2. **Directory gate, not ancestry.** The predicate for "target branch files equal
   the winner" is a folder-to-folder content diff, materializing both sides as
   directories. Never use "commit id is ancestor of HEAD" — the worker may
   rewrite history (rebase/amend/force) to the same tree, which would false-neg
   an ancestry check; and a stale ancestor commit with a different tree is a
   false-pos.
3. **No `winnerCommit` concept in the gate.** Both worktree and snapshot winners
   present content as a directory; the primitive is strategy-agnostic.
4. **Snapshot is not a special case.** A directory-snapshot winner has no commit
   to merge — but the §6 flow and gate already handle "make files equal" with no
   engine content-copy fallback.
5. **Zero DSL change.** Corank/consolidate/gate are runtime behaviour of the
   existing `map`/`tournament`; the only load-visible addition is the
   (already-agreed) "exit contract declares 2+ metrics = validate error" — a
   schedule-time predicate over existing fields, not a schema element.
6. **Cleanliness is informational**, not a pass/fail member (avoids rejecting a
   correct result for a stray untracked file).

This file is intentionally kept short; the PRD is authoritative and
implementation-ready.
