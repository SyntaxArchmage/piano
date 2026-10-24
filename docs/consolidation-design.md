# Design note → superseded by the PRD

This scratch document hosted the discussion that produced the tournament
winner-carry design. It has been folded into
[`map-winnow-selection-prd.md`](./map-winnow-selection-prd.md) §6 ("Winner
carry — deterministic, program-applied") and its decision ledger (§15).

Canonical statement of the design (from that PRD §6):

- **Engine ranks** the winner only (pure, in-process, `selection.ts`) — no git.
  The `workspace.winner` option is the extension point a future decision model
  replaces; it changes *who wins*, never *how the winner is carried*.
- **Engine carries** it with one deterministic program route per container:
  a `git-worktree` lane is committed on its lane branch and fast-forwarded
  (`git merge --ff-only`); a `store-worktree` lane has its baseline-relative
  delta copied into the parent by `applyWorkspaceChangeSet`. No worker turn
  takes part in either route.
- **Engine verifies once**: every declared delta path must equal the winner's
  content, and no undeclared path may differ from the pre-apply snapshot. On
  failure the snapshot is restored and the carry reports `carry-failed`.

Key design points (do not re-litigate here):

1. **One decision site.** Rank + apply + verify live at the region exit, which
   for a single-region run is the end-of-run `finalize` point.
2. **The delta is the contract**, not a commit id: the winner delta is the git
   tree difference between the lane's fork commit and the winner slot's content.
   The parent's drift against the same fork commit is what makes a conflict
   loud.
3. **Conflict refusal.** If the parent changed any path the winner also changed
   since the fork, the carry refuses (`carry-failed`) and preserves every slot
   instead of overwriting a user edit.
4. **Snapshot-based rollback.** The parent is snapshotted before the first
   mutation; a failed apply restores and re-verifies it. The apply is idempotent,
   so a later `/continue` re-enters and re-applies the same delta safely.
5. **No Git metadata transaction.** The store route only copies files and never
   runs git inside the source, so the head/refs/index protection the worker
   revision needed is gone with the worker turn.
6. **Snapshot is not a special case.** A directory-snapshot (store) winner has
   no commit to merge; the same delta + verification contract covers it, so
   both containers report the same landed kinds (`git-merged` /
   `delta-applied`).

This file is intentionally kept short; the PRD is authoritative.
