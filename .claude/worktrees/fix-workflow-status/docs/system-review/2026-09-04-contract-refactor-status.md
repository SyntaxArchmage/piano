# Worker Contract Refactor Status — 2026-09-04

## Status

The worker-owned contract path is now the canonical path for new workflows and
is stable enough to remain the migration target.  It is **not** yet evidence
that the deprecated named-contract path can be removed.  Keep the legacy
adapter as a compatibility fallback while the new path accumulates real-run
evidence and gains an independent conformance corpus.

The precise status is **migration-stable, not deletion-stable**:

| Claim | Status | Why |
| --- | --- | --- |
| The canonical TopSOP JSON contracts express the intended legacy stage semantics. | Green | Direct content review found no lost field or invariant; the old estimate arithmetic gap is now explicit. |
| The executor reaches, snapshots, validates, and hands off the selected worker contract. | Green | The canonical path is exercised by dedicated workflow/dataflow guards. |
| Agents will reliably satisfy every conditional contract in representative real runs. | Amber | The full schema is injected, but this needs observation across real models, tasks, and failure modes. |
| Legacy code can be removed without losing a semantic oracle or a user fallback. | Red | The independent case corpus and observation window do not yet exist. |

"Stable" in this report therefore means that the new architecture is the
correct path to operate and extend today.  It does not mean that two active
architectures should continue to evolve in parallel, nor that deletion of the
legacy adapter is safe today.

This report records a read-only review of the TopSOP contract refactor.  It is
not a claim based only on a passing validator or test run: the review compared
the historical branch's TypeScript schemas, its actual worker manifests, and
the current worker-owned JSON manifests.

## Core architectural judgement

The refactor is sound only if it remains a **one-way migration**:

1. `contract.json` is the sole owner of a worker's domain schema, business
   invariants, examples, and executor-visible projections.  The TypeScript
   runtime may parse JSON Schema and evaluate generic assertions, but must not
   regain worker-name or contract-ID-specific business logic.
2. Legacy named contracts are a quarantine boundary: they are a reader,
   migration oracle, and fallback for old workflow source.  They are not a
   second source of truth and must receive no new product behavior.
3. Correctness is more than JSON acceptance.  For one stage it includes the
   accepted payload, normalization, projections, snapshot lineage, prompt
   visibility, and the downstream handoff record.  A schema change is only
   safe when all of those surfaces remain coherent.
4. Removing the legacy registry is a test-data migration, not merely a code
   deletion.  Its useful behavioral knowledge must first become independent,
   reviewable fixtures owned beside the worker contracts.

This judgement reconciles compatibility with the new design: preserve old
users without retaining a branching execution design.  New behavior goes into
worker-owned JSON plus generic engine capabilities; old syntax is only adapted
at the boundary.

## Scope and historical baseline

The reviewed historical revision is `d0bcce48` (`topsop-tuning` branch tip).
The relevant workflow and contract files are unchanged in the merge commit
`6c5624c`.

There are two distinct historical counts which must not be conflated:

| Scope | Count | Meaning |
| --- | ---: | --- |
| TypeScript named registry | 17 | All legacy `CONTRACT_SCHEMAS` values, including generic CUDA/Triton contracts. |
| TopSOP worker manifests used by the old workflow | 6 | `validate: true` already loaded worker-local `contract.json` files. |
| TopSOP stage-output semantics | 9 | The old six manifests served nine roles because estimate, optimize, and verify were two-mode unions. |

The nine TopSOP stage semantics are environment, exploration, theory,
profiling, proposal, implementation, verification, measured round, and
summary.  `topsop-asm-report` is an additional nested evidence schema used
inside a measured round, not a separate workflow stage.

The old multi-mode manifests were:

| Historical worker | Modes |
| --- | --- |
| `topsop-estimate` | theory or profile |
| `topsop-optimize` | idea/proposal or measure/round |
| `topsop-verify` | verification or summary |

The historical workflow did not use string-valued named validation for these
stages: it used `validate: true`.  Therefore the worker JSON was already the
runtime authority, while the TypeScript schemas described the intended legacy
semantics and remained a compatibility oracle.

## Current canonical shape

`recipes/workflows/topsop-tuning.yml` now uses one worker and one contract per
stage:

| Stage | Worker | Contract ID |
| --- | --- | --- |
| setup-env | `topsop-setup-env` | `topsop-env-report` |
| explore | `topsop-explore` | `topsop-explore-report` |
| theory | `topsop-theory` | `topsop-theory-report` |
| profile | `topsop-profile` | `topsop-profile-report` |
| idea | `topsop-idea` | `optimization-proposal` |
| implement | `topsop-implement` | `topsop-implementation-report` |
| verify | `topsop-verification` | `verification-report` |
| measure | `topsop-measure` | `topsop-round-result` |
| summary | `topsop-summary` | `summary-report` |

The three former multi-mode workers remain as worker-owned compatibility unions
for old workflows.  New workflows must not select them.

For `validate: true`, the executor resolves the selected worker's
`contract.json`, snapshots its exact source into the run, validates the result
with the generic worker-contract runtime, and transports that manifest's
declared projections.  The TypeScript named registry is only reached by the
deprecated string-valued `validate: "<name>"` path.

## Evidence matrix

The conclusions above rest on the following concrete code and artifact
boundaries, not on an assumption that a refactor with a passing build is
equivalent:

| Reviewed claim | Historical evidence | Current evidence | Judgment |
| --- | --- | --- | --- |
| What the old workflow actually selected | `d0bcce48:recipes/workflows/topsop-tuning.yml` uses six workers and `validate: true`. | `recipes/workflows/topsop-tuning.yml` selects nine stage-specific workers and `validate: true`. | The migration split actors; it did not change the validation selector into a named builtin lookup. |
| Where runtime validation comes from | Historical worker folders already contained `contract.json`. | `workflow-file.ts` resolves `recipes/<worker>/contract.json`; `workflow-execution.ts` calls `validateWorkerContract` for `validate: true`. | Worker JSON is the new runtime authority. |
| What named schemas contributed | `d0bcce48:packages/contract/src/schemas.ts` contains 17 named Zod schemas and cross-field refinements. | The nine canonical manifests materialize field structure, conditionals, and generic assertions. | Domain semantics can live in JSON without adding a new TS builtin schema. |
| Whether output/handoff meaning was retained | Historical manifests mostly lacked semantic projection declarations. | Current manifests declare `outputs.projections`; accepted payload, projections, and contract snapshot are persisted in handoff records. | Handoff information is more explicit on the new path. |
| Whether a worker can see its complete contract | Legacy guidance was a named-schema example. | The exact JSON snapshot is injected as a worker context file; the prompt also supplies the accepted example and result path. | The agent can inspect the full source of truth, not merely a contract name. |
| Whether data reaches the intended stages | No equivalent nine-stage split guard existed in the reviewed branch. | `topsop-tuning-dataflow.guard.test.ts` checks the user task, snapshot, accepted payload, projections, loop feedback, and producer list for every invocation. | Transport topology is guarded independently of schema acceptance. |

The review did not rely on a single evidence type: source comparison establishes
semantic intent, generic runtime code establishes the execution path, and
workflow guards establish transport behavior.

## Content review: legacy semantics versus current JSON

No field or domain invariant from the nine canonical TopSOP stage contracts
was found missing from the current worker-owned JSON declarations.

| Semantic contract | Concrete field/invariant review | Review result |
| --- | --- | --- |
| Environment | Required `status,target,device,toolchain`; nested target/device/toolchain fields; ready forbids blocker and blocked requires it. | Preserved. |
| Exploration | Ready requires `call_chain` plus `architecture.pipeline/l1_buffers/sip_allocation/variant_selected`; blocked requires blocker. | Preserved. |
| Theory | `target_operator`, baseline/build evidence, theory fields, blocked/timing-only behavior; LLC 3:1 classification, 2500/3000 limit, utilization ±0.02, theory time ±3%. | Preserved; stronger than the historical worker union. |
| Profile | Required target/device/latency/analysis; ready requires LLC sum plus 1D or 2D efficiency; utilization rule follows the same LLC limit. | Preserved; stronger than the historical worker union. |
| Proposal | Non-empty strategy records with speedup/risk fields; any structural variable requires non-empty premise rechecks. | Preserved. |
| Implementation | `compiled`/`compile_failed`/`blocked` state machine, non-empty safe `changed_files` for compiled work, and block scope only on blocked work. | Preserved. |
| Verification | Compile/run `exit_code` must agree with `passed`; combined evidence determines `pass` or `fail` verdict. | Preserved. |
| Measured round | Required identity/promotion/record fields; compile/verify failure rules; measured evidence; KEEP/DISCARD/CONVERGED constraints; nested asm report rules. | Preserved. |
| Summary | Required run id/summary; improved or neutral outcome requires a complete progress-record proof. | Preserved. |

Important improvements made by the refactor:

1. The old `topsop-estimate/contract.json` explicitly treated the LLC balance,
   utilization, and theory-time arithmetic as agent self-checks.  The legacy
   TypeScript theory/profile schemas did enforce them.  Current
   `topsop-theory`, `topsop-profile`, and the compatibility estimate union
   express these rules through generic `x-piano-assertions`; this closes the
   historical gap without adding worker-specific TypeScript logic.
2. The manifests use `x-piano-unknown-properties: "strip"` so their accepted
   normalized values match the historical Zod `z.object()` behavior.
3. Conditional schemas now add required-presence checks where JSON Schema's
   `properties` predicate alone would match an absent field.  In particular,
   summary does not require a progress record when optional `outcome` is absent.
4. Each canonical contract owns explicit `outputs.projections` for the
   executor-visible handoff/progress surface.  This includes proposal map
   items, implementation changed files, measured-round evidence, and summary
   progress-record path.

The full contract snapshot is injected into each validating worker's context.
The inline prompt shows a concrete accepted example; the worker can read the
snapshot for the complete schema and its conditional rules.

### Explicit handoff surface after the split

Raw accepted payloads remain available through immutable handoff records.  The
projection list is not a lossy replacement for that payload; it is the small,
stable semantic surface that executor and progress logic may consume without
understanding a worker-specific JSON shape.

| Producer contract | Declared semantic projections | Why this is significant |
| --- | --- | --- |
| Environment / exploration / theory | `workflow.status` | Makes readiness/blocking state transport explicit without parsing prose. |
| Profile | `workflow.status`, latency, LLC read/write sum | Gives later stages structured performance evidence while retaining the full profile payload. |
| Proposal | `workflow.map-items` from `/strategies` | Preserves the generic fan-out/map item interface. |
| Implementation | status, block scope, changed files, build target, change summary | Supplies loop control and safe winner-change evidence without a worker-name switch. |
| Verification | no special projection | The full verification payload is handed to measure; no executor-level shortcut is required. |
| Measured round | decision, hypothesis, profile evidence, regression, verification pass state | Represents the loop feedback and progress surface explicitly. |
| Summary | progress-record path | Preserves the write-back proof as structured final evidence. |

This is the key information-handover judgement: the new design does not ask
the executor to rediscover payload meaning from worker IDs.  It receives only
declarations that the producing contract chooses to make generic.

## What is validated today

The generic worker-contract runtime currently validates:

- manifest shape, JSON parsing, and supported JSON Schema dialect;
- `x-piano-assertions` syntax and safe unknown-property normalization;
- the manifest's accepted example;
- actual worker payloads, metrics, and declared projections;
- immutable contract snapshots and contract digest lineage in run evidence.

There are also three useful test layers:

1. Differential migration tests compare current same-ID worker contracts with
   the still-present legacy registry, including field deletion, type mutation,
   unknown-field normalization, and selected arithmetic boundaries.
2. A hand-authored frozen conditional corpus records representative accepted
   modes and projections rather than generating those cases from the current
   worker manifests.
3. The shipped TopSOP dataflow guard verifies that the full user task,
   contract snapshot, accepted payload, projections, loop feedback, and
   declared handoff producers reach each stage.

## Remaining validation boundary

Schema validity is not semantic completeness.  A contract that accidentally
removes a necessary field or business assertion can still be valid JSON,
compile under AJV, and accept its own edited positive example.  No generic
validator can infer a missing business requirement from the manifest alone.

The current differential test is the right migration guard, but it cannot be
the permanent solution because it depends on the registry that is intended to
be removed.  The frozen corpus is a useful seed for the successor, but it is
not yet a complete independent accept/reject specification: it is mostly
accepted branch data and still calls the legacy validator in its current test.

Additional boundaries to address later:

- Optional projection pointers are checked against examples at load time, but
  an optional typo can be absent in an example and silently yield no runtime
  projection.  A schema-aware projection-pointer/type lint would make this
  statically visible.
- Contracts currently declare outputs, not formal upstream input requirements.
  The dataflow guard proves the configured transport topology, but cannot prove
  that every downstream business requirement is supplied by an upstream
  contract.

## Recommended next refinement

Keep `contract.json` as the only runtime business-schema authority.  Do not
replace it with new worker-name switches or TypeScript builtin schemas.

Add a generic, test-only sidecar for each worker, for example:

```text
recipes/<worker>/
  contract.json
  contract.cases.json
```

The sidecar should declare independently reviewed cases:

- accepted ready / fallback / blocked / boundary payloads;
- rejected counterexamples for every business invariant;
- expected normalized payloads and projections where they matter;
- cases covering every conditional branch, union branch, and custom assertion.

A generic conformance runner can compile every manifest, execute those cases,
check expected projections, and report branch/assertion coverage.  This adds no
worker-specific TypeScript contract definition.  Before deleting the legacy
registry, freeze the existing migration-oracle behavior into these sidecars and
make the generic suite the required CI gate.

The corpus must be intentionally independent of the runtime schema.  Generating
all cases from the current `contract.json` would only prove that the runtime
implements its own declaration; it would not detect an omitted requirement.
The migration-period named schemas are valuable precisely because they can be
used once to freeze accepted and rejected legacy behavior before they cease to
be an oracle.

For whole-workflow completeness, a later generic input/projection requirement
surface may be considered.  That is separate from the current migration and
must not be inferred from worker name or encoded as a TopSOP-only branch.

## Observation plan during deprecation

The deprecation window should collect evidence that distinguishes a schema
problem from an agent/prompt problem and from a transport problem.  At minimum,
future review should inspect run evidence for:

| Signal | Failure it detects | Existing evidence source |
| --- | --- | --- |
| Contract load/compile failure | Invalid manifest, unsupported assertion/dialect, or bad example. | Workflow load failure and contract snapshot records. |
| Validation repair count and error path | Agent did not satisfy a required field, conditional branch, or assertion. | Stage attempt / validation repair records. |
| Accepted payload versus declared projections | Projection type/pointer failure or unintended loss of executor-visible state. | Accepted stage and handoff records. |
| Contract digest and snapshot path | A result was judged under a different mutable schema than the one the agent saw. | Accepted evidence and `contracts/<digest>.json`. |
| Handoff producer list and feedback iteration | Missing root evidence, loop feedback, or a stage-specific predecessor. | Handoff context and dataflow guard. |
| Legacy fallback usage | New workflow accidentally depends on the deprecated architecture. | Workflow `validate` declarations and deprecation warnings. |

The observation question is not merely "did the run succeed?"  It is "did the
canonical contract path carry the same task, evidence, and decision semantics
without invoking a legacy fallback or relying on an undocumented prompt
assumption?"

## Recommended operating decision and exit criteria

Recommended current operating decision:

- New workflows use `validate: true` and worker-local `contract.json`.
- The named registry and string-valued validation remain deprecated
  compatibility only.
- The legacy TopSOP union workers remain available for existing workflows.
- No removal is authorized by this review.

Removal should wait until all of the following are true:

1. An independent contract-case corpus replaces the live legacy registry as
   the semantic test oracle, with accepted and rejected fixtures for every
   TopSOP mode and boundary invariant.
2. The generic runner demonstrates condition/union/assertion coverage, and
   projection-pointer/type linting is in CI.
3. The old differential test has been deliberately retired only after its
   behavioral cases are frozen elsewhere; it is not silently deleted together
   with the registry.
4. Representative real workflows have been observed through an agreed
   workload/model stability window with no contract/prompt/handoff divergence
   that requires a legacy fallback.
5. The deprecation migration has a documented user-facing replacement path and
   no supported workflow still requires string-valued validation.

The duration, workload matrix, and quantitative observation threshold are
intentionally not invented in this report; future work should choose them based
on the workflows being supported.
