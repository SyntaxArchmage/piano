# Topsop tuning V2 canonical workspace identity

Date: 2026-09-16

## Trigger

Tournament session `/home/wsj/.piano/runs/20260916T152806-b870ea`
finished after only prepare, characterize, and summary. Prepare returned
`durable_state_incompatible` before entering either tournament round.

The state recorded:

```text
workspace_diff_digest = sha256:804d342cfa3ea490203a1355ee203ca6eac1eeb5a5588a332df333794cb3c6e2
```

The new prepare fast path compared it with:

```text
sha256(git diff HEAD) = sha256:d604975f09b416b8804856860827cf9037d821c53b4279b871afd7607f96c735
```

These values represent different objects. Promotion had recorded the digest of
a manifest containing the tracked-diff digest plus every non-ignored untracked
path and its content digest. Prepare treated the tracked-diff component as the
final workspace digest.

Recomputing the documented promotion manifest over the current workspace gives
exactly `sha256:804d342c...`, proving that the workspace still matches the
existing durable state. The block was therefore a false incompatibility, not a
user workspace change or damaged state.

Prepare also tried more than 354 alternative serializations and made 29 tool
calls. That behavior violated the bounded fast-path design and still could not
recover because no single executable definition owned the identity algorithm.

## Root correction

`recipes/topsop-v2-workspace-identity.py` is now the only implementation of
`topsop-v2-workspace-manifest-v1`.

The algorithm is:

1. capture the raw bytes of `git -C <workspace> diff HEAD`;
2. compute their SHA-256 as `tracked_diff_sha256`;
3. enumerate `git ls-files --others --exclude-standard -z`;
4. sort decoded UTF-8 repository-relative paths;
5. append one manifest line for the tracked digest and one line per untracked
   path/content digest;
6. compute `workspace_diff_digest` over the complete UTF-8 manifest.

The helper emits the algorithm version, resolved workspace root, HEAD, tracked
component, sorted untracked entries, dirty flag, and final workspace digest. An
optional output is written atomically and must live outside the measured
workspace so evidence creation cannot change the identity being measured.

## Worker changes

### Common V2 evidence protocol

The evidence-protocol copies for the five state-identity consumers—prepare,
characterize, implement, promote, and summary—point to the same recipe-owned
helper by a fixed relative path. They prohibit substituting
`tracked_diff_sha256`, writing another implementation, or probing historical
serialization variants. Analyze, evaluate, and tournament partition do not
compute workspace identity and therefore do not receive extra prompt material.

### `topsop-v2-prepare`

- Calls the helper once before reading the unique state path.
- Compares state `source_commit` with helper `head` and state
  `workspace_diff_digest` with helper `workspace_diff_digest`.
- Does not enumerate alternate algorithms on mismatch.
- Retains the existing four-batch blocked-path limit.

### `topsop-v2-characterize`

- Uses the helper when rechecking a continued state.
- Does not independently reinterpret workspace identity.

### `topsop-v2-implement`

- Uses the helper when verifying that the candidate base still equals the
  durable current-best workspace.

### `topsop-v2-promote`

- Runs the helper after KEEP commit or DISCARD restoration.
- Writes helper `head` and `workspace_diff_digest` into the durable transaction
  and receipt, ensuring the next prepare computes the same identity.

### `topsop-v2-summary`

- Uses the helper for normal-path final workspace verification.
- The pre-loop blocked propagation path remains unchanged and does not recheck
  workspace identity.

## Compatibility and scope

- Existing V2 state is compatible because the helper reproduces the already
  recorded manifest algorithm; no deletion or migration is required.
- No Piano package/framework code is changed.
- No V1 worker or workflow is changed.
- The user's local `topsop-tuning-v2-tournament.yml` iteration override is
  intentionally left untouched and is not part of this fix.

## Regression coverage

`tests/workflow/topsop-v2-workspace-identity.test.ts` creates real temporary Git
repositories and verifies:

- tracked and untracked inputs are both represented;
- untracked paths use stable sorted order;
- repeat execution is deterministic;
- changing an untracked file changes the final digest;
- evidence output is atomic and outside the measured workspace.

The knowledge-routing test also verifies that every V2 worker receives the same
canonical identity definition and that state-owning workers reference the
helper explicitly.

## Verification

- Canonical helper against the affected real workspace/state:
  `workspace_diff_digest=sha256:804d342c...`, exact match.
- Helper and worker-ownership tests: 29 passed.
- Workflow suite excluding the two tournament tests coupled to the user's local
  `iterations: 2` override: 537 passed / 6 skipped.
- The unfiltered workflow suite had only those two expected fixture mismatches:
  one expects five iterations and one expects three analyze calls rather than
  six. They are unrelated to workspace identity.
- TypeScript typecheck and ESLint passed.
