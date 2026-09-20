# Worklog 2026-09-06 — unified-harness mission: full cuda-tuning matrix

## Goal checklist (mission substitute for /goal)

Mission (verbatim scope): "any validate is a harness to feedback to agent…
fix it in ideal shape… test with a more comprehensive evals suite
(cuda-tuning). make the harness x model x (tournament, non-tournament)
workflows and evals cases complete. then test on this complete matrix…
full readout… understand how harness, models affect system performance…
also add gpt-5.6-luna as compare model (ds v4 flash, qwen3.8 flash, luna)."

- [x] G1 Unified validate-as-repair: every check that can reject worker
  output runs before acceptance, failures enter the repair path
  (commit 8cd9682; red-first boundary tests in workflow-execution.test.ts).
- [x] G2 Canonical transcript dialect at the harness boundary so claude/dsh
  cells produce real evidence scores (commit 29945a7; mapping tests).
- [x] G3 Complete matrix artifacts — 18 cells = harness{pi,claude,dsh} ×
  model{deepseek-v4-flash,qwen3.8-flash,gpt-5.6-luna} × shape{serial,
  tournament}: 13 new recipes + 13 new workload cases, all parsing through
  the real loader with exact-native-tool validation (commit 94d794d;
  data-driven wiring test + 8-cell transcript tests).
- [ ] G4 Full-matrix live run + readout (in progress — see below).
- [ ] G5 Final gate green, commit readout docs, push origin main.

## Matrix cells (case → recipe)

| shape | model | pi | claude | dsh |
|---|---|---|---|---|
| serial | deepseek-v4-flash | cuda-matmul-tuning | -claude | -dsh |
| serial | qwen3.8-flash | -pi-qwen | -qwen | -dsh-qwen |
| serial | gpt-5.6-luna | -pi-luna | -luna | -dsh-luna |
| tournament | deepseek-v4-flash | -tournament | -tournament-claude | -tournament-dsh |
| tournament | qwen3.8-flash | -tournament-pi-qwen | -tournament-qwen | -tournament-dsh-qwen |
| tournament | gpt-5.6-luna | -tournament-pi-luna | -tournament-luna | -tournament-dsh-luna |

Assumptions documented in code: pi serial base (gpu-cuda-tuning,
gpu-cuda-tuning-tournament) omit `model` and resolve the user-configured
model (currently deepseek-v4-flash) — recorded as the pi×dsv4 column.
pi×qwen/luna pin `model` per stage (stage > config precedence).

## Live run protocol

Single RTX 3070 → benchmark isolation requires strict serial execution:
`piano evals --group tuning-cuda --timeout 43200` (driver runs cases
sequentially). Launched 2026-09-06T02:02:44+08:00; progress in
/tmp/matrix-progress.log + /tmp/matrix-run.log; report.json under
~/.piano/evals/<runSetId>/; run dirs under ~/.piano/runs/.

Expected wall time: ~2–7 h/serial cell, more per tournament (3 lanes ×
10 iters) → full sweep may exceed a day. Cell statuses are appended to
the table below as they land.

### Cell results (fill from report.json + per-run trajectory)

| # | cell | status | best/final TFLOPS | tokens | time |
|---|---|---|---|---|---|
| 1 | cuda-matmul-tuning (pi×dsv4, serial) | completed | 7.8840 / 7.8604 | 2.77M | 183m |
| 2 | cuda-matmul-tuning-claude (claude×dsv4, serial) | completed | — / 8.7413 | 18.48M | 110m |
| 3 | cuda-matmul-tuning-dsh (dsh×dsv4, serial) | completed | — / 6.5462 | 2.29M | 185m |
| 4 | cuda-matmul-tuning-dsh-luna (dsh×luna, serial) | completed | 5.4795 / 4.6194 | 879K | 37m |
| 5 | cuda-matmul-tuning-dsh-qwen (dsh×qwen, serial) | failed @ setup | — | 0 | 0m |
| 6 | cuda-matmul-tuning-luna (claude×luna, serial) | failed @ iter 5 | 4.9980 / — | 4.18M | 19m |
| 7 | cuda-matmul-tuning-pi-luna (pi×luna, serial) | completed | 4.7880 / 2.4374 | 902K | 22m |
| 8 | cuda-matmul-tuning-pi-qwen (pi×qwen, serial) | failed @ setup | — | 0 | 0m |
| 9 | cuda-matmul-tuning-qwen (claude×qwen, serial) | completed (epoch1b) | 7.7457 / 4.9415 | 57.04M | 382m |
| 10 | cuda-matmul-tuning-tournament (pi×dsv4) | completed | — / 7.4685 | 4.50M | 102m |
| 11 | cuda-matmul-tuning-tournament-claude (claude×dsv4) | completed | — / 7.2516 | 47.04M | 165m |
| 12 | cuda-matmul-tuning-tournament-dsh (dsh×dsv4) | completed | — / 7.9438 | 4.79M | 212m |
| 13 | cuda-matmul-tuning-tournament-dsh-luna (dsh×luna) | completed | — / 7.0481 | 1.83M | 40m |
| 14 | cuda-matmul-tuning-tournament-dsh-qwen (dsh×qwen) | completed | — / 9.5853 | 5.63M | 471m |
| 15 | cuda-matmul-tuning-tournament-luna (claude×luna) | completed | — / 6.8178 | 32.53M | 81m |
| 16 | cuda-matmul-tuning-tournament-pi-luna (pi×luna) | completed | — / 6.8267 | 2.90M | 37m |
| 17 | cuda-matmul-tuning-tournament-pi-qwen (pi×qwen) | completed | — / 8.9317 | 6.48M | 492m |
| 18 | cuda-matmul-tuning-tournament-qwen (claude×qwen) | running (iter 8/10) | 9.3790 / — | — | 589m |

### Failure root causes (triaged 2026-09-06, mid-sweep)

- Cells 5 and 8 share one root cause: **qwen3.8-flash was not in the
  `models` list of ~/.piano/agent.config.json** (the gateway serves it —
  cell claude×qwen runs fine — but the pi SDK catalog and the generated
  dsh launcher overlays are both built from that list). pi fails with a
  clean `model-not-found`; dsh previously died in an opaque profile-boot
  crash on the missing patch file — fixed in 5f8fd72 to fail pre-spawn
  with the actionable message. The developer added the config line
  2026-09-06 ~15:35; the cells are rerun candidates.
- Cell 6: `spawn claude ENOENT` mid-run at tune.measure iter-6 — the
  claude CLI binary was momentarily missing from the sweep process PATH.
  Transient; rerun.
- Cells 4 and 7 complete with final < best: the delivered artifact at
  readout measured below the run's best round — to be examined when the
  readout is assembled (possible summary-stage clobber of the promoted
  file; not yet classified).

**Sweep interruption (2026-09-06 14:50).** The original `--group` run was
killed mid-cell-9 by the previous session's teardown (launched without
`setsid`; no `matrix end` line, no error). Relaunched at 16:24 as
`/tmp/matrix-epoch1b.sh` (detached): cell 9 from scratch plus the nine
tournament cases, serially; on finish it writes `matrix end`, handing off
to the rerun batch.

### Persistence fix + rerun batch (2026-09-06, on main)

The kill also exposed a driver flaw: `report.json` was written only after
the WHOLE invocation finished, so epoch 1's eight finished cells never
reached the `--report` board. Fixed in 461bc57 (main): every completed case
atomically refreshes its run-set report and appends its history line as it
lands; `tests/cli/evals-command.test.ts` covers the interrupted-run case.

Consequence: cells 1–4 and 7 have no persisted report at all. Detached
monitor `/tmp/rerun-after-matrix.sh` (v4.1; progress /tmp/rerun-progress.log,
output /tmp/rerun.log) waits for epoch1b's `matrix end`, then serially:

1. Regenerates cells 1–4 and 7 (`cuda-matmul-tuning`, `-claude`, `-dsh`,
   `-dsh-luna`, `-pi-luna`) so the board carries today's full serial set.
   A case is skipped only when a run set newer than the epoch1b relaunch
   already persists its `report.json` — yesterday's reports and bare
   `done status=` log lines never count (the pre-fix driver could finish a
   case without ever persisting it).
2. Reruns failed cells 5, 6, 8 (`-luna`, `-dsh-qwen`, `-pi-qwen`).
3. The two tournament qwen twins (`tournament-dsh-qwen`,
   `tournament-pi-qwen`) are skipped automatically once epoch1b completes
   them under the fixed config (today's per-case run sets persist reports).

`--report --group tuning-cuda` then holds every matrix case. (Cases whose
only report is a pre-fix occurrence are superseded by these reruns.)

### Live-proof items

- [x] dsh repair path fired live (proves G1 end-to-end): cell 13
  (tournament-dsh-luna, run 20260906T224648-d5056a) accepted `cuda-summary`
  only on `attempt: 2` (summary@root) — the dsh worker produced a rejected
  summary and the harness resumed it to a valid result; the run completed
  with final 7.0481. Earlier dsh serial cells kept attempt=1 everywhere;
  unit tests (workflow-execution.test.ts) remain the boundary evidence.
- [ ] claude/dsh cells score non-zero evidence (proves G2; check
  evidence pass in the compact readout). Transcripts of today's runs are
  100% canonical-dialect (verified 1098/1098 and 1411/1411 records), so
  the score confirmation happens at readout.
