# Worklog — model support and doctor connectivity (#49, #50)

`/goal` is unavailable in this client, so per the `issues-dev` skill the goal
checklist lives here and every item is required.

## Goal checklist (AND — all must hold)

### #49 — config template carrying the tested-OK model list

- [x] issue target understood and bounded
- [x] design follows repository conventions and TypeScript best practices
- [x] implementation and focused tests complete
- [x] diff passed a client-appropriate review
- [x] validation evidence recorded
- [x] commit complete and scoped to the issue

### #50 — `doctor --model all` real sweep

- [x] issue target understood and bounded
- [x] design follows repository conventions and TypeScript best practices
- [x] implementation and focused tests complete
- [x] diff passed a client-appropriate review
- [x] validation evidence recorded
- [x] commit complete and scoped to the issue

### Pi registry activation at mission bootstrap (no issue yet)

Raised by the developer after #50, not from a drafted issue: "we should replace
pi model.json config by a new model.json and save the original backup", "this is
a bootstrap process for piano, after launch workflow, the harness used by workflow
should be activated with piano config", and "setup is only piano installation,
never use it for our runtime function".

- [x] target understood and bounded
- [x] design follows repository conventions and TypeScript best practices
- [x] implementation and focused tests complete
- [x] diff passed a client-appropriate review
- [x] validation evidence recorded
- [x] commit complete and scoped — shipped as `f530cd8`, then superseded
- [x] issue filed retroactively, or explicitly waived by the developer
      — waived: "no need to add new issue, just append comments after prior"

### Superseded by: Piano-owned harness configuration home

The copy-and-backup activation above was replaced before commit, on the
developer's proposal: "if we can use non-default agent folder, we can skip
override and restore of prior user's own model config file. we can place it
under ~/.piano/ that not default. maybe this resolves every hussle things",
"we do not need restore maybe", "keep simple implementation, as we find such a
simple way to support piano-only config, keep it fixed and simple".

- [x] target understood and bounded
- [x] design follows repository conventions and TypeScript best practices
- [x] implementation and focused tests complete
- [x] diff passed a client-appropriate review
- [x] validation evidence recorded
- [x] commit complete and scoped — `7536952`

## Decisions

1. All eight models are reached through the in-process `pi` adapter with the
   single provider `enflame`.
2. Connectivity is proven through the real harness path (`executeAgent`), never
   an HTTP POST from a shell: a shell POST can be sandbox-blocked, and even when
   it succeeds it proves nothing about Piano's harness path.
3. Scope is the doctor connectivity check only — no workflow or stage model
   selection changes.
4. The sweep flag is `doctor --model all`, mirroring `--harness all`, rather
   than a separate `--models` flag. The no-argument `doctor --model` endpoint
   listing is unchanged.
5. The proven-model list lives in the agent config file. The repository ships
   `scripts/agent.config.template.json`; `scripts/setup.sh` installs it only
   when `~/.piano/agent.config.json` is absent. Both sides are synced by hand.
6. The list is a sweep range, not a whitelist: `--model <unlisted>` still runs.
7. Evidence is a local manual doctor run. With a credential it makes real
   requests; without one every model reports `unconfigured`. No CI live calls.
8. Pi's model registry is activated from Piano's config at **mission bootstrap**,
   not at install time. `scripts/setup.sh` installs Piano and nothing else; it
   never carries runtime function. The activation point is the harness config
   scope every mission already acquires.
9. **Superseding 8's mechanism.** Every harness accepts a non-default config
   directory, so Piano owns its harness configuration outright instead of
   copying, rewriting, and restoring the user's: `agentDir` for the in-process
   Pi SDK, `PI_CODING_AGENT_DIR` for `pi-cli`, `CLAUDE_CONFIG_DIR` for `claude`,
   `DSH_HOME` for `dsh`. Nothing under `~/.pi`, `~/.claude`, or `~/.dsh` is read
   or written, so there is no backup, no restore, and no per-mission scope to
   release. Decided by the developer: "适配层能力接口，实现各自不同" (one
   capability interface, per-harness implementations), "完全自洽，不继承凭据"
   (fully self-contained, inherit no credential), "稳定目录，删掉 scope 生命周期"
   (a stable directory, delete the scope lifecycle).
10. The directory is fixed at `~/.piano/harness/{pi,claude,dsh}` — one per native
    config *format*, so `pi` and `pi-cli` share the Pi one — and regenerated on
    every mission. Its contents are a pure function of Piano's config, so every
    mission wants the same bytes and a config edit can never be served stale.
    `PIANO_HARNESS_HOME_ROOT` relocates it for tests.
11. A missing provider, endpoint, or model list writes an *empty* registry
    rather than no file. In a durable directory, "write nothing" would leave the
    previous run's registry in place and let stale configuration keep working
    invisibly.
12. Because credentials are no longer inherited, a harness Piano has not
    configured now reports itself unavailable instead of silently borrowing the
    user's native login. That is the intended trade of the decision above.

## Validation evidence

### #49

Committed as `1fff3fe` on branch `issue-49-config-template`, in the isolated
worktree `.claude/worktrees/issue-49` based on `dev` (`d3fdb84`). Seven files,
staged by explicit path; nothing from the main tree's uncommitted work is in it.

- `npm run typecheck` — passes.
- `npx vitest run tests/harness/harness-config.test.ts` — 7/7 pass.
- `npm run lint` — fully clean in the worktree, which confirms the 8
  `no-useless-escape` errors seen in the main tree belong entirely to the
  uncommitted native-harness work and not to #49.
- `scripts/setup.sh` run three times under a sandboxed `HOME` with `npm`
  stubbed (to avoid mutating global npm state): run 1 reported `created
  …/agent.config.json from template`; run 2 reported `kept existing config` and
  the file was byte-identical to the template (same sha1); run 3, after
  injecting a real-looking `apiKey`, left the file's sha1 unchanged and the
  credential intact.
- The reader was smoke-checked against the real `~/.piano/agent.config.json`:
  `resolveSupportedModels()` returns all eight ids in config order and
  `resolveHarnessConfig("pi")` still resolves provider `enflame`, model
  `deepseek-v4-flash`, and a present credential.
- Code review milestone: PASS. Verified hunk by hunk, confirmed no unrelated
  work and no `sk-` material in the commit, confirmed `setup.sh` cannot clobber
  an existing config, and confirmed the new tests fail on regression rather
  than being tautologies.

### Live config synced

`~/.piano/agent.config.json` now carries the same eight ids as the template. It
was updated in place — the `models` key added, every other key (`apiKey`,
`harness`, `model`, `provider`, and the existing `claude`/`deepseek`
namespaces) preserved, a `.bak` written first, and the replacement done
atomically. The list narrows to the ids that actually pass in #50.

### #50

Committed as `2072efd` (sweep) and `01c3e82` (model id correction) on branch
`issue-50-doctor-models`, in the isolated worktree `.claude/worktrees/issue-50`
stacked on #49's `1fff3fe`.

- `npm run typecheck` — passes. `npm run lint` — clean.
- `npx vitest run tests/cli/doctor.test.ts` — 12/12 pass.
- Root cause of the original failure, found through the harness path only. The
  probe passed `usePianoConfig: false` and then discarded the resolved config, so
  neither provider nor credential reached Pi. `pi.ts` resolves the provider from
  Pi's own registry *before* calling `setRuntimeApiKey`, and this install's
  `~/.pi/agent/auth.json` holds no credentials, so that registry advertises
  nothing. Result: every model reported `unconfigured`, including
  `deepseek-v4-flash`, which demonstrably answers.
- A three-way comparison run through `executeAgent` proved the fix. With
  `usePianoConfig: false` and no forwarded provider, `deepseek-v4-flash` failed
  `configuration: Pi SDK could not resolve a provider`; with the provider and
  credential forwarded it returned SUCCESS. For an unregistered id the
  unforwarded path returned `400 bad request: Authorization header is badly
  formatted` — Pi had guessed a different provider and the enflame credential
  was sent to an endpoint it does not belong to. Forwarding the provider closes
  that leak as well as the false `unconfigured`.
- Review milestone: PASS, verified by mutation rather than assertion. Relaxing
  the summary condition to `passed >= 0` failed 2 tests; removing the provider
  forwarding failed 1. Both reverted, 12/12 green afterwards.
- Real sweep on merged `dev`: `deepseek-v4-flash` PASS, the other seven
  `unsupported`, summary `1/8 responded successfully`.

### Why seven models failed, and how bootstrap fixes it

Not a Piano defect and not a gateway limitation. `piano doctor --model` reads the
provider's own `/v1/models` and it advertises 53 ids including **all eight**
candidates — `deepseek-v4-flash`, `qwen3.8-27b`, `qwen3.8-max`, `gpt-5.6-luna`,
`gpt-5.6-terra`, `claude-sonnet-4-6`, `claude-opus-5`, and `claude-opus-4-8`.
Note the last one: the requested id was `claude-opus-4.8` with a dot; the
gateway spells it with dashes. The template is corrected in `01c3e82`.

The seven failed because `~/.pi/agent/models.json` registers only
`enflame/deepseek-v4-flash`. Pi resolves models from that file, so an
unregistered id cannot be reached however well the gateway serves it.
Registering them needs no guessed metadata — entries are bare `{ "id": "…" }`
under the existing `enflame` provider, which already carries `baseUrl`, `api`,
and an apiKey env-var name.

### Pi registry activation — evidence (see the design section that follows)

- `npm run typecheck` — passes. `npx eslint` on the four changed files — clean.
- `npx vitest run tests/harness/config-scope.test.ts` — 5/5 (3 pre-existing, 2
  new). `tests/cli/doctor.test.ts` — 12/12. `tests/cli` + `tests/harness`
  together — 212 passed, 2 skipped (e2e).
- The load-bearing assumption was verified rather than assumed: `agentDir` is
  handed not only to `ModelRuntime.create` but also to `DefaultResourceLoader`
  and `createAgentSession`. Copying two files is still sufficient because Piano
  already passes `noExtensions`, `noSkills`, `noThemes`, `noPromptTemplates`, an
  in-memory `SettingsManager`, and its own session manager — so nothing else in
  that directory is read. Separately, `pi.ts` never reads `options.env` (it reads
  `process.env`), which is why carrying `env` beside `agentDir` is inert.
- Single-model proof of the mechanism: `piano doctor --model qwen3.8-max`, which
  reported `unsupported — Pi SDK could not resolve this model from its provider
  configuration` before this change, now reports `[PASS] responded successfully`.
- Full sweep, real requests through `executeAgent`: **7/8**. All of
  `deepseek-v4-flash`, `qwen3.8-27b`, `qwen3.8-max`, `gpt-5.6-luna`,
  `gpt-5.6-terra`, `claude-sonnet-4-6`, and `claude-opus-5` pass. The one failure
  is `claude-opus-4.8` — the dotted id still in the live config, which the
  gateway does not serve. Fixing that one id is expected to make it 8/8.
- Note the category shift for that failure: it now reports `unavailable — Pi SDK
  model request failed` instead of `unsupported`. Activation registers whatever
  Piano's config lists, so Pi resolves the id and the gateway rejects it at
  request time. The verdict is still a correct failure, and a more informative
  one: it proves the request actually left the process.
- A defect found by this validation and fixed here: `runPiModelProbe` passed no
  `signal`, while `runSubprocessProbe` has always bounded itself at 30s. An
  unresponsive model therefore stalled the entire sweep — observed twice, once
  for 18 minutes with no output. The probe now uses
  `AbortSignal.timeout(90_000)`, which `piFailureReport` already maps to
  `unavailable`.
- Review milestone: PASS, verified by mutation. Reversing the endpoint precedence
  so Piano's `baseUrl` overrode the user's failed 1 test; dropping the `agentDir`
  wiring from `agentOptions` failed 1 test. Both reverted, 5/5 green afterwards.



### Piano-owned harness configuration home — evidence

Committed as `7536952` on `dev`, twelve files staged by explicit path. The other
developer's in-flight orchestrator/trajectory work is untouched and still
uncommitted.

Mechanism, verified in the installed packages rather than assumed:

| harness | how a model reaches it | non-default config dir |
| --- | --- | --- |
| `pi` (in-process SDK) | `runtime.getModel(provider, id)`, resolved from the agent dir's `models.json` | `agentDir` option (`pi.ts`) |
| `pi-cli` | `--provider/--model/--api-key` on argv, but the id is resolved from its own agent dir | `PI_CODING_AGENT_DIR` |
| `claude` | `--model` on argv | `CLAUDE_CONFIG_DIR` |
| `dsh` | nothing on argv — `agent-default-model:` in `settings.yaml` | `DSH_HOME` |

`PI_CODING_AGENT_DIR` was confirmed in the installed `@earendil-works/pi-coding-agent`:
`dist/config.js` builds `ENV_AGENT_DIR` from `APP_NAME` (`pi`), and
`docs/environment-variables.md` documents it as "Override the config directory;
default is `~/.pi/agent`". So the real split is argv-selectable (`claude`) versus
config-resolved (`pi`, `pi-cli`, `dsh`), not SDK versus subprocess.

No change to `subprocess.ts` was needed: `childEnv` already merges
`options.env` over `process.env`, so the three directory pointers reach every
subprocess harness by travelling in `homes.env`.

Gate:

- `npm run typecheck` — passes. `npx eslint packages tests vitest.config.ts` — clean.
- `npx vitest run` — 644 tests, 640 passed, 4 skipped, including the 213s real
  parity e2e.
- `npx vitest run tests/harness/harness-home.test.ts` — 3/3.

Real harness-path proof, all through `executeAgent` / real subprocesses, with
the endpoint supplied as `PIANO_PI_BASE_URL` because the live
`~/.piano/agent.config.json` still has no `baseUrl` (see below):

- `piano doctor --model all` — **7/8 PASS** from the generated registry alone.
  The one failure is the dotted `claude-opus-4.8` still in the live config;
  `piano doctor --model claude-opus-4-8` **PASSES**, so all eight models are
  reachable and the gap is one stale id in a config file, not the mechanism.
- `piano doctor --harness all` — `pi` PASS, `claude` PASS, `dsh` PASS, `pi-cli`
  WARN. `claude` passing with an *empty* generated `CLAUDE_CONFIG_DIR` retires
  the one untested risk in this design. `pi-cli` re-run with its own namespace
  populated (`PIANO_PI_CLI_PROVIDER/MODEL/BASE_URL/API_KEY`) **PASSES**, which
  proves `PI_CODING_AGENT_DIR` resolves the model from Piano's generated registry
  and shows the WARN for what it is: `pi-cli` has no section in the live config,
  and it no longer borrows the user's `~/.pi/agent` credential to hide that.
- A full headless mission (`piano --workflow <tool-free basic> -p …`) reported
  `run.completed` with a real `enflame/deepseek-v4-flash` reply, after
  `runSession` regenerated `~/.piano/harness/pi/models.json` with all eight ids.
  Run tool-free on purpose so the repository's uncommitted work stayed untouched
  — verified byte-for-byte against `git status` afterwards.
- `tests/workflow/basic-workflow-parity.e2e.test.ts` — 30 real missions
  (5 tasks × 3 trials × TUI and headless) with real `read`/`write` tool calls,
  token ratio 1.02, tool-call ratio 1.

Review milestone: PASS, verified by mutation. Making the registry write
conditional (so an unconfigured run leaves a stale file) failed the staleness
test; renaming `PI_CODING_AGENT_DIR` to a plausible wrong name failed the
pointer test. Both reverted, file restored byte-identical, 3/3 green.

Two defects this validation found in my own work, both fixed here:

1. `writeGenerated` staged through `${target}.tmp-${process.pid}`. Four
   concurrent preparations in one process share a pid, so one renamed another's
   staging file away mid-write. Now `randomUUID()`. This matters in production:
   tournament workers run parallel missions in one process.
2. The suite wrote to the developer's real `~/.piano/harness`, because
   `tests/cli/session-takeover.test.ts` drives the real `runSession`. The whole
   suite is now redirected by `PIANO_HARNESS_HOME_ROOT` in `vitest.config.ts`,
   asserted by comparing mtimes across a full run. The parity e2e deletes that
   variable for its child processes: it isolates by `HOME`, and sharing a fixed
   directory with concurrently running tests let one rewrite the registry a live
   mission was reading — which is exactly how it failed in the full suite while
   passing alone.

`tests/workflow/basic-workflow-parity.e2e.test.ts` also had to stop copying
`~/.pi/agent/models.json` into its sandbox home, since that file is no longer
read. It now composes its config as the shipped template overlaid with the
developer's own, which is what supplies the endpoint.

### Live config still needs two developer edits

Both blocked on the developer naming `~/.piano/agent.config.json` as a
modification target — it holds a real credential, and the permission classifier
refuses to let me overwrite it.

1. Add `"baseUrl": "https://api.enflame.cn/v1"`. Previously the endpoint came
   from the user's `~/.pi/agent/models.json`; Piano no longer reads that file, so
   without this key the generated registry is empty and no model resolves. The
   shipped template now carries it.
2. `"claude-opus-4.8"` → `"claude-opus-4-8"` (carried over from #50).

Separately, `~/.piano/workflow.yml` still says `harness: pi-sdk`, a pre-#44 name,
so any mission using the default workflow fails to parse. Unrelated to this
change and not fixed: it is the developer's file.

### #16 updated, no new issue

Per the developer ("no need to add new issue, just append comments after prior"),
progress went to #16 as a comment (note `196999`), confirmed by the API. It
records that #16 §3 step 6, §4 restore/rollback, and drift detection all lose
their premise — Piano no longer touches the user's native config in either
direction — so what remains of #16 is an optional read-only import that
populates `~/.piano/agent.config.json`. No issue was created, no body edited,
nothing closed.

### Where the registry is activated

Superseded by the Piano-owned home above, and kept only for the record: the
mechanism below shipped as `f530cd8` and is replaced by the commit that follows
it, so `packages/harness/src/config-scope.ts` no longer exists. Read it as the
design that decision 9 subtracted.

At mission bootstrap, inside the harness config scope — not in `setup.sh`, and
not by editing the user's Pi install. `packages/harness/src/config-scope.ts`
already gave `claude` and `dsh` an isolated copy of their native home per
mission, wrote Piano's settings into that copy, and pointed the child harness at
it. Pi now joins that mechanism:

- `~/.pi/agent/auth.json` and `models.json` are captured verbatim into
  `<scope>/pi-backup`, which is the requested original backup.
- The same two files are copied to `<scope>/pi-active`, and only that copy's
  `models.json` is rewritten so the configured provider advertises every id in
  Piano's `models` list.
- Pi is an in-process SDK, so it is pointed at the active copy through the
  adapter's existing `agentDir` option instead of a child-process variable.
  `withHarnessConfigScope` carries it in `agentOptions` next to `env`, and
  `runSession` forwards the whole object.
- The scope is released when the mission's Effect resource closes, so nothing
  survives the run.

Only the `models` array is replaced. `baseUrl`, `api`, `apiKey`, and `compat`
from the user's own entry win over Piano's resolved values, because that file is
their working Pi setup and Piano is adding reach, not taking it over. No
credential is ever written: Pi's `apiKey` field holds an environment variable
*name*, and the real key is applied in-process at request time.

The activation is inert when there is nothing safe to do — no configured
provider, an empty `models` list, no resolvable endpoint, or a registry Piano
cannot parse all leave the copied file exactly as it was. On an install with no
`models` key, Pi therefore behaves precisely as before.

The user's real `~/.pi/agent` is read and never written. That is a deliberate
deviation from a literal in-place replacement: the same models become reachable
for every Piano mission, but running `pi` directly outside Piano still sees only
the ids the user registered themselves. Flagged for the developer below.

### Live config not yet re-synced

`~/.piano/agent.config.json` still lists `claude-opus-4.8` with the dot, so the
template and the live config differ by that one id, and the sweep — which reads
the live config — reports that id as unsupported. A minimal in-place fix was
attempted (raw-text replacement of just that quoted literal, atomic rename, no
other key touched) and was **refused by the permission classifier**: the file
holds a real credential and the developer had not named it as a modification
target. Not worked around. It needs the developer to name the file.


### Pre-existing defect found during review (not fixed, out of scope)

`stringValue` in `packages/harness/src/harness-config.ts` tests the sentinel
against the untrimmed value (`value !== "CHANGE_ME"`) but returns
`value.trim()`. A config value of `"  CHANGE_ME  "` therefore slips past the
sentinel filter and is returned as `"CHANGE_ME"` — as an apiKey it would be
sent to the provider as if real. This predates #49 on the apiKey path; #49's
reader merely inherits it. The shipped template uses the clean literal, which
is filtered correctly, so nothing #49 ships is affected. Left for the developer
to decide: unrelated work is preserved.


### Repository-level lint (resolved)

The 8 `no-useless-escape` errors at `tests/harness/subprocess.test.ts:48` were
caused by the then-uncommitted native Claude/dsh harness work, not by #49. That
work has since landed as `a0692dd` and `npm run lint` is clean on merged `dev`.

## Merged

`issue-50-doctor-models` (which carries #49 as an ancestor) merged into `dev` as
`4158be9`. `dev` had already landed #49's content via `a0692dd`, so four files
conflicted between near-identical versions; each was resolved toward `dev`,
keeping the `claude`/`dsh` documentation and the deepseek-namespace test, and
taking from the branch only the `claude-opus-4-8` id and the `--model all`
sentence. Typecheck, lint, and `tests/cli` + `tests/harness` (135 passed, 2 e2e
skipped) are green on the merge result.

Nothing is pushed. The other developer's uncommitted work
(`docs/workflow-trajectory-evaluation-prd.md`,
`packages/orchestrator/src/workflow-file.ts`, `tests/workflow/workflow.test.ts`)
was preserved untouched through the merge.

## Open decisions for the developer

1. ~~Whether Piano should also write the user's real `~/.pi/agent/models.json`~~ —
   settled by decision 9: Piano generates its own harness home and never touches
   the user's install, in either direction.
2. Re-sync `~/.piano/agent.config.json` — now two edits, `baseUrl` and
   `claude-opus-4-8`. Blocked on naming that file as a modification target.
   See "Live config still needs two developer edits".
3. Whether to open a separate issue for the `stringValue` untrimmed-sentinel
   defect described above.
4. #49's merge request was never created — `git push -o merge_request.create` was
   refused by the permission classifier, and the plain push that succeeded
   carried no MR. The branch is on `origin`; the MR can be opened from
   `http://git.enflame.cn/heng.shi/piano/-/merge_requests/new?merge_request%5Bsource_branch%5D=issue-49-config-template`.
   Now that the work is merged into `dev` locally, an MR for the branch may be
   redundant.
5. Minor, noticed while validating: `doctor --model all` prints nothing until the
   whole sweep finishes, because the report is formatted once at the end. With
   eight live requests that is a long silence. Left alone as out of scope.

### Earlier correction kept for the record

An earlier claim in this session that #49 had zero overlap with then-uncommitted
work was wrong: it was checked by diffing files #49 does *not* touch, which could
not have revealed overlap inside the files it does. Four files were in fact
mixed. The isolated worktree was the remedy, and it is why the commits are
provably clean.

