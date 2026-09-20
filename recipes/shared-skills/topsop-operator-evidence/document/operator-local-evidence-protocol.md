# Operator-local evidence protocol for Topsop V2

## Purpose

Keep stable per-operator commands, cases, baselines, historical attempts, and
progress notes reusable across V2 stages without turning old notes into current
source, artifact, correctness, or measurement facts.

## Bounded discovery order

1. Use exact paths already present in the current accepted handoff.
2. Use the formal test or benchmark entry discovered by prepare and inspect only
   its adjacent header/progress record when one exists.
3. Inspect adjacent `op_dev/rule.md` and executable entries under `op_dev/cli`
   when the current workspace already uses that convention.
4. Use only the absolute V2 durable state/evidence paths supplied by the handoff.
   Do not rediscover state by scanning unrelated worktrees, other runs, or
   `$HOME`.
5. If none of these locations exists, report the evidence gap instead of
   inventing a convention during a read-only stage.

## Stable operator-local layout

Use existing project conventions when present. A commonly supported layout is:

```text
<operator-test-unit>/
├── <formal-test-or-benchmark-file>   # executable entry; may contain append-only progress notes
└── op_dev/
    ├── rule.md                       # short rules: situation → action → reason
    └── cli/                          # executable, reproducible evidence commands
```

Do not create a second hidden state tree inside the workspace. Durable workflow
state remains under the exact `$HOME/.piano/state/topsop-v2/...` path validated by
prepare; bulky logs remain in the current invocation evidence directory.

## V2 durable history and optional progress notes

The durable cross-session record is V2 `state.json`. Characterize may initialize
revision 0 after rebuilding and measuring the current source. Promote alone may
append a candidate history entry and advance the revision as part of an atomic
KEEP transaction. Other stages never edit durable state.

A human-visible progress note is optional, not an assumed V2 contract field.
Summary may append one compact record only when the mission or an accepted
handoff explicitly supplies the file path, format, and write permission. If no
such target exists, summary reports through its normal result/evidence outputs
and does not create a parallel memory file.

When a progress record is explicitly requested, preserve the applicable fields:

- run/operator/shape/dtype identity;
- workspace baseline source commit and workload fingerprint;
- final artifact path, digest, identity, and build target;
- metric name/unit/direction, baseline/final values, raw sample references, and
  acceptance threshold;
- target/guard/sanitizer verification identity when those checks ran;
- selected mechanism and verdict, or `null` when the baseline remains;
- rejected mechanism identities with reasons and evidence anchors;
- durable state revision/path/digest and a concrete next action.

Append once, re-read the file, and verify its digest. Never rewrite earlier
entries or infer missing fields from another run.

## Evidence identity

A reusable record states the fields relevant to its type:

- source: workspace-relative `file:line`, baseline commit, and selected variant;
- command: exact command, cwd/config basis, architecture, host, and exit status;
- case: operator, shape, dtype, seed/tolerance when relevant, and case selector;
- artifact: path, digest, build target, compiler mode, source commit, and mtime;
- metric: name, unit, direction, sample policy, raw artifact path, and values;
- history: mechanism/variable identity, fixed controls, outcome, and evidence
  anchors.

Missing identity fields stay missing. Do not merge values from different
artifacts, cases, hosts, workload fingerprints, or metric definitions.

## Authority and reuse

Current workspace source/build metadata and current tool/device output override
operator-local notes. A progress entry or rule can route investigation and
prevent exact dead-end repetition, but it cannot prove current dispatch,
correctness, performance, or resource usage. Revalidate every historical fact
required by the current stage contract.

## V2 stage ownership

- prepare records workspace, workload identity, source/test/build entry, state
  root, and existing operator-local paths; it does not infer performance.
- characterize may reuse commands and cases only after matching runtime,
  artifact, and metric identities; it always rebuilds and remeasures.
- tournament-partition and analyze may use prior attempts to avoid exact
  dead-end repetition or form hypotheses, never as proof of current behavior.
- implement follows the admitted mechanism and current source; it does not copy
  a historical patch without re-deriving applicability.
- evaluate uses the declared primary/guard/sanitizer cases and records raw logs;
  it does not weaken validation based on history.
- promote records the accepted transaction only after current evaluation and
  threshold checks; history cannot change KEEP/DISCARD.
- summary may append one verified progress note only under an explicit write
  target and must not rewrite historical entries.
