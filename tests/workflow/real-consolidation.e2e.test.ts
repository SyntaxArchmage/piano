import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeFileSystem } from "@effect/platform-node";
import {
  executeWorkflow,
  loadWorkflow,
  type WorkflowExecutionRequest,
} from "../../packages/orchestrator/src/index.js";
import {
  executeSubprocessAgent,
  resolveHarnessConfig,
  prepareHarnessHomes,
  type AgentRequest,
  type AgentRunner,
  type HarnessName,
} from "../../packages/harness/src/index.js";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";

const runReal = process.env.PIANO_HARNESS_REAL_E2E === "1";
// The one real turn per acceptance goes to the LLM service the developer
// configured: the model resolves through the same path a real mission uses,
// never a literal this file guesses. PIANO_REAL_MODEL stays as an explicit
// one-off override for another model on that same service.
function realModelFor(harness: HarnessName): string | undefined {
  return process.env.PIANO_REAL_MODEL ?? resolveHarnessConfig(harness).model;
}
// A single real provider turn (the winner consolidation) plus real filesystem
// merges can spend minutes queued at the provider. Bind loosely, but not wider
// than a generous single-turn budget plus one repair cycle.
const TURN_TIMEOUT_MS = 300_000;

/** Tournament winner push (§6 of docs/map-winnow-selection-prd.md) driven by a
 * real coding-agent harness. Only the `$consolidate/<winnerKey>` agent turn is
 * real — the worker-invariant mechanism this accepts. Every other stage is a
 * deterministic stub, so the engine's single-metric referee picks an
 * unambiguous winner and exactly one genuine provider round-trip is spent. */
function raceWorkflow(harness: HarnessName): string {
  return `version: 3
workflow:
  name: ${harness}-real-consolidation
  nodes:
    - stage:
        name: propose
        worker: basic
        validate: optimization-proposal
        from: []
    - tournament:
        name: race
        from: [propose]
        over: propose.strategies
        count: 2
        entry: implement
        exit: bench
        nodes:
          - stage:
              name: implement
              worker: basic
              handoff: strategy.json
              from: []
          - stage:
              name: bench
              worker: triton-benchmark-store
              validate: true
              from: [implement]
`;
}

/** The workflow stage id of a stub/repair run, from the context template. */
function stageId(request: AgentRequest): string {
  const matched = /executing workflow stage `([^`]+)`/.exec(request.prompt);
  if (matched?.[1] === undefined) throw new Error(`missing workflow stage: ${request.prompt}`);
  return matched[1];
}

/** Full worker invocation id from the context template, e.g. `propose@root`; for
 * the §6 handoff the parenthetical is the literal `winner consolidation`. */
function invocationId(request: AgentRequest): string {
  const matched = /executing workflow stage `[^`]+`\s*\(([^)]+)\)/.exec(request.prompt);
  if (matched?.[1] === undefined) throw new Error(`missing workflow invocation: ${request.prompt}`);
  return matched[1];
}

function stubResult(request: AgentRequest): {
  sessionId: string;
  transcriptPath: string;
  text: string;
} {
  const id = invocationId(request);
  return {
    sessionId: `${id}-stub`,
    transcriptPath: `/tmp/real-consolidation-${id}.jsonl`,
    text: `${stageId(request)}:${id}`,
  };
}

/** Concrete slot index (slot-N) from the workspace lane path. */
function slotOf(request: AgentRequest): number {
  const lane = request.sessionDir ?? request.cwd;
  const matched = /\/slot-(\d+)(\/|$)/.exec(lane);
  if (matched?.[1] === undefined) throw new Error(`missing slot lane: ${lane}`);
  return Number(matched[1]);
}

/** The validator result path a `validate: true` stage writes to, lifted from the
 * stage's standard prompt line. */
function validationPath(request: AgentRequest): string {
  const found = request.prompt.split("\n").find((line) => /\/results\/inv-\d+-attempt-\d+\.json$/.test(line));
  if (found === undefined) throw new Error(`missing validation result path: ${request.prompt}`);
  return found;
}

describe.skipIf(!runReal)(" real-model tournament winner consolidation (§6)", () => {
  for (const harness of ["dsh", "claude"] as const satisfies readonly HarnessName[]) {
    it(`${harness} lets the real harness worker consolidate the engine-selected winner into the shared source`, async () => {
      const root = await mkdtemp(join(tmpdir(), `piano-real-consolidation-${harness}-`));
      const scopeRoot = await mkdtemp(join(tmpdir(), `piano-real-consolidation-${harness}-home-`));
      try {
        // A snapshot (non-git) root so each tournament slot is a plain directory
        // whose winning content a real agent copies back into the shared cwd.
        await writeFile(join(root, "kernel.py"), "baseline\n");
        await mkdir(join(root, "state"), { recursive: true });
        await writeFile(join(root, "state", "current-best.py"), "baseline\n");
        await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
          current_best: { path: "state/current-best.py", metric: { name: "tflops", best: 1, direction: "higher" } },
          history: [],
        }));
        await writeFile(join(root, "race.yml"), raceWorkflow(harness));

        const session = await Effect.runPromise(
          createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
        );

        // Real harness settings for the single genuine consolidation turn, on
        // the developer's configured model (PIANO_REAL_MODEL can point the
        // acceptance at a different one for a one-off run).
        const realModel = realModelFor(harness);
        const config = { ...resolveHarnessConfig(harness), model: realModel };
        const homes = await Effect.runPromise(prepareHarnessHomes({
          rootDir: scopeRoot,
          configs: { [harness]: config },
        }).pipe(Effect.provide(NodeFileSystem.layer)));

        const realRunnerFor = (): AgentRunner => (request, agentOptions) => {
          const opts = agentOptions ?? {};
          const stage = stageId(request);
          // The one turn under test: re-open the winning slot's OWN worker on the
          // §6 one-sentence consolidation prompt against a real subprocess agent.
          if (stage.startsWith("$consolidate/")) {
            return executeSubprocessAgent(harness, {
              cwd: request.cwd,
              prompt: request.prompt,
              model: realModel,
              signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
            }, {
              ...(config.provider === undefined ? { provider: opts.provider } : { provider: config.provider }),
              model: realModel,
              ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
              ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
              ...(config.authToken === undefined ? {} : { authToken: config.authToken }),
              ...(config.binPath === undefined ? {} : { binPath: config.binPath }),
              env: opts.env,
              retryDelaysMs: [],
            });
          }
          // Deterministic stages so the referee picks slot-1 exactly.
          const promise = (async () => {
            if (stage === "propose") {
              const path = validationPath(request);
              await mkdir(dirname(path), { recursive: true });
              await writeFile(path, JSON.stringify({
                strategies: [
                  { id: "slot-0", bottleneck: "memory", technique: "warp", rationale: "test", predicted_speedup: 1.1, risk_level: "low" },
                  { id: "slot-1", bottleneck: "compute", technique: "tile", rationale: "test", predicted_speedup: 1.2, risk_level: "medium" },
                ],
              }));
            } else if (stage === "race.implement") {
              await writeFile(join(request.cwd, "kernel.py"), `kernel-${slotOf(request)}\n`);
            } else if (stage === "race.bench") {
              const best = slotOf(request) === 0 ? 4 : 9;
              const path = validationPath(request);
              await mkdir(dirname(path), { recursive: true });
              await writeFile(path, JSON.stringify({
                iteration: 0,
                decision: "KEEP",
                candidate: { path: "kernel.py" },
                current_best: { path: "state/current-best.py" },
                verification: { compile_passed: true, verify_passed: true },
                benchmark: { name: "tflops", unit: "TFLOP/s", direction: "higher", samples: [best], best, median: best, runs: 1, warmup: 0 },
                promotion: { promoted: true, resulting_best: { path: "state/current-best.py" }, reason: "faster" },
                records: { round_path: `rounds/iter-000.json`, state_path: "state/tuning-state.json" },
              }));
            }
            return stubResult(request);
          })();
          return Effect.promise(() => promise);
        };

        const request: WorkflowExecutionRequest = {
          runDir: session.runDir,
          runId: `real-consolidation`,
          cwd: root,
          prompt: `Race two kernels as separate strategies for kernel.py then let the engine pick the higher-tflops winner and let you consolidate it into the shared source.`,
          agentOptions: { ...homes.agentOptions, env: homes.env },
          agentRunner: realRunnerFor(),
        };

        const outcome = await Effect.runPromiseExit(
          loadWorkflow(join(root, "race.yml"), root).pipe(
            Effect.flatMap((loaded) => executeWorkflow(loaded, request)),
          ).pipe(
            Effect.provideService(Logging, loggingService(session.log, session.trace)),
            Effect.provide(NodeFileSystem.layer),
          ),
        );
        if (Exit.isFailure(outcome)) {
          throw new Error(Cause.pretty(outcome.cause)); // surface the genuine defect
        }

        // Engine recorded a selection driven by the single-metric referee, named
        // the real winner, and handed the §6 consolidation to the winner's own
        // real harness worker — which drove a genuine provider turn.
        //
        // A real coding agent may converge the directory gate in one pass
        // (`carried`/`worker-consolidated`) or need more repairs than the shared,
        // single-repair window allows (`no-winner`/`carry-failed`, which PRD §12
        // item 10 documents as the intended "never converged before the cap"
        // outcome). Both are correct engine responses to a live worker — the
        // mechanism under test is that the winner worker received the real
        // handoff, the engine drew an honest gate conclusion, and nothing
        // crashed.
        const selectionPath = join(session.runDir, "eval-metrics", "selection.jsonl");
        const records = (await readFile(selectionPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
        expect(records.length).toBeGreaterThanOrEqual(1);
        const terminal = records[records.length - 1];
        expect(["carried", "no-winner"]).toContain(terminal?.outcome);
        expect(terminal?.winnerKey).toBe("race/slot-1");
        const kind = terminal?.carrying?.kind;
        expect(["worker-consolidated", "carry-failed"]).toContain(kind);
        if (terminal?.outcome === "carried") {
          expect(kind).toBe("worker-consolidated");
          // The winner worker reached the shared source, so it is no longer the
          // unraced baseline seed.
          const source = await readFile(join(root, "kernel.py"), "utf8");
          expect(source.trim()).not.toBe("baseline");
        }
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(scopeRoot, { recursive: true, force: true });
      }
    }, TURN_TIMEOUT_MS * 2 + 60_000);
  }

  /** Loop-nested twin of the §6 case above, and the only real-model guard for
   * the per-region finalization: with a tournament inside a 2-iteration loop,
   * each region exit must decide and consolidate its own winner, so exactly
   * two selection records appear and iteration 2's propose sees a shared
   * source that iteration 0's real consolidation already updated. Under the
   * old run-end semantics the source would still be the baseline at propose
   * #2 and a single record would arrive at the end. dsh only — one harness
   * is enough to accept the mechanism, and it halves the real-turn cost. */
  it("dsh consolidates a loop-nested tournament at every region exit, one real turn per round", async () => {
    const harness: HarnessName = "dsh";
    const root = await mkdtemp(join(tmpdir(), "piano-real-loop-race-"));
    const scopeRoot = await mkdtemp(join(tmpdir(), "piano-real-loop-race-home-"));
    try {
      await writeFile(join(root, "kernel.py"), "baseline\n");
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
        current_best: { path: "state/current-best.py", metric: { name: "tflops", best: 1, direction: "higher" } },
        history: [],
      }));
      await writeFile(join(root, "loop-race.yml"), `version: 3
workflow:
  name: dsh-real-loop-consolidation
  nodes:
    - loop:
        name: tune
        from: []
        entry: propose
        exit: race
        feedback: race
        iterations: 2
        nodes:
          - stage:
              name: propose
              worker: basic
              harness: ${harness}
              validate: optimization-proposal
              from: []
          - tournament:
              name: race
              from: [propose]
              over: propose.strategies
              count: 2
              entry: implement
              exit: bench
              nodes:
                - stage:
                    name: implement
                    worker: basic
                    harness: ${harness}
                    handoff: strategy.json
                    from: []
                - stage:
                    name: bench
                    worker: triton-benchmark-store
                    harness: ${harness}
                    validate: true
                    from: [implement]
`);

      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const realModel = realModelFor(harness);
      const config = { ...resolveHarnessConfig(harness), model: realModel };
      const homes = await Effect.runPromise(prepareHarnessHomes({
        rootDir: scopeRoot,
        configs: { [harness]: config },
      }).pipe(Effect.provide(NodeFileSystem.layer)));

      // The shared source observed entering each propose: [baseline, ...].
      const sourceAtPropose: string[] = [];
      const runner: AgentRunner = (request, agentOptions) => {
        const opts = agentOptions ?? {};
        const stage = stageId(request);
        if (stage.startsWith("$consolidate/")) {
          return executeSubprocessAgent(harness, {
            cwd: request.cwd,
            prompt: request.prompt,
            model: realModel,
            signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
          }, {
            ...(config.provider === undefined ? { provider: opts.provider } : { provider: config.provider }),
            model: realModel,
            ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
            ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
            ...(config.authToken === undefined ? {} : { authToken: config.authToken }),
            ...(config.binPath === undefined ? {} : { binPath: config.binPath }),
            env: opts.env,
            retryDelaysMs: [],
          });
        }
        const promise = (async () => {
          if (stage === "tune.propose") {
            sourceAtPropose.push((await readFile(join(request.cwd, "kernel.py"), "utf8")).trim());
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              strategies: [
                { id: "slot-0", bottleneck: "memory", technique: "warp", rationale: "test", predicted_speedup: 1.1, risk_level: "low" },
                { id: "slot-1", bottleneck: "compute", technique: "tile", rationale: "test", predicted_speedup: 1.2, risk_level: "medium" },
              ],
            }));
          } else if (stage === "tune.race.implement") {
            await writeFile(join(request.cwd, "kernel.py"), `kernel-${slotOf(request)}\n`);
          } else if (stage === "tune.race.bench") {
            const best = slotOf(request) === 0 ? 4 : 9;
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              iteration: 0,
              decision: "KEEP",
              candidate: { path: "kernel.py" },
              current_best: { path: "state/current-best.py" },
              verification: { compile_passed: true, verify_passed: true },
              benchmark: { name: "tflops", unit: "TFLOP/s", direction: "higher", samples: [best], best, median: best, runs: 1, warmup: 0 },
              promotion: { promoted: true, resulting_best: { path: "state/current-best.py" }, reason: "faster" },
              records: { round_path: `rounds/iter-000.json`, state_path: "state/tuning-state.json" },
            }));
          }
          const result = stubResult(request);
          // The loop resumes each actor's next-iteration turn, so the stub —
          // like the real runner — must carry the session continuation.
          return { ...result, continuation: { harness, sessionId: result.sessionId, transcriptPath: result.transcriptPath } };
        })();
        return Effect.promise(() => promise);
      };

      const request: WorkflowExecutionRequest = {
        runDir: session.runDir,
        runId: "real-loop-race",
        cwd: root,
        prompt: "Each iteration race two strategies for kernel.py; the race's winner must be consolidated into the shared source when the race region exits.",
        agentOptions: { ...homes.agentOptions, env: homes.env },
        agentRunner: runner,
      };
      const outcome = await Effect.runPromiseExit(
        loadWorkflow(join(root, "loop-race.yml"), root).pipe(
          Effect.flatMap((loaded) => executeWorkflow(loaded, request)),
        ).pipe(
          Effect.provideService(Logging, loggingService(session.log, session.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      if (Exit.isFailure(outcome)) {
        throw new Error(Cause.pretty(outcome.cause));
      }

      const selectionRecords = (await readFile(join(session.runDir, "eval-metrics", "selection.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as {
        outcome: string; winnerKey?: string; carrying?: { kind: string };
      });
      // Exactly one decision per tournament instance, whenever it happens:
      // two iterations, two records, each keyed to its own iteration.
      expect(selectionRecords).toHaveLength(2);
      expect(selectionRecords[0]?.winnerKey).toContain("iter-0");
      expect(selectionRecords[0]?.winnerKey).toContain("slot-1");
      expect(selectionRecords[1]?.winnerKey).toContain("iter-1");
      expect(selectionRecords[1]?.winnerKey).toContain("slot-1");
      for (const record of selectionRecords) {
        expect(["carried", "no-winner"]).toContain(record.outcome);
        const kind = record.carrying?.kind;
        expect(["worker-consolidated", "carry-failed"]).toContain(kind);
        if (record.outcome === "carried") expect(kind).toBe("worker-consolidated");
      }
      // The ordering claim: propose #2 entered a shared source that the
      // iteration-0 real consolidation had already touched. A real worker may
      // not converge within the repair window (carry-failed), so the strict
      // version of this holds only for a carried first round.
      expect(sourceAtPropose).toHaveLength(2);
      expect(sourceAtPropose[0]).toBe("baseline");
      if (selectionRecords[0]?.outcome === "carried") {
        expect(sourceAtPropose[1]).not.toBe("baseline");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(scopeRoot, { recursive: true, force: true });
    }
  }, TURN_TIMEOUT_MS * 3 + 60_000);
});
