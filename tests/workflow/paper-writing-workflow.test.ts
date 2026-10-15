import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  compileWorkflow,
  loadWorkflow,
  parseWorkflow,
  type CompiledWorkflow,
} from "../../packages/orchestrator/src/index.js";
import { LogWriter, TraceWriter, Logging, loggingService } from "../../packages/logging/src/index.js";

const workflowPath = (name: string) =>
  join(process.cwd(), "recipes", "workflows", `${name}.yml`);

const FULL_DURATION_SECONDS = 259200;
const SMOKE_DURATION_SECONDS = 60;

/** The nine workers, in the order their stages appear in the lowered workflow. */
const STAGE_ORDER = [
  ["prepare", "paper-prepare"],
  ["calibrate", "paper-calibrate"],
  ["storyline", "paper-storyline"],
  ["figures", "paper-figures"],
  ["write", "paper-write"],
  ["audit", "paper-audit"],
  ["review", "paper-review"],
  ["revise", "paper-revise"],
  ["finalize", "paper-finalize"],
] as const;

const STAGE_MODELS = [
  ["prepare", "gpt-5.6-luna"],
  ["calibrate", "gpt-5.6-luna"],
  ["storyline", "gpt-5.6-luna"],
  ["figures", "qwen3.8-flash"],
  ["write", "deepseek-flash"],
  ["audit", "glm-5.3-flash"],
  ["review", "glm-5.3-flash"],
  ["revise", "deepseek-flash"],
  ["finalize", "glm-5.3-flash"],
] as const;

/** The single retry policy every stage in both templates declares. */
const RETRY_POLICY = { attempts: "unbounded", backoff: 30, backoffMax: 900 } as const;

async function compileRecipeWorkflow(name: string) {
  const path = workflowPath(name);
  const parsed = await Effect.runPromiseExit(parseWorkflow(await readFile(path, "utf8"), path));
  if (!Exit.isSuccess(parsed)) throw new Error(`parse failed for ${name}: ${JSON.stringify(parsed.cause)}`);
  const compiled = await Effect.runPromiseExit(compileWorkflow(parsed.value, path));
  if (!Exit.isSuccess(compiled)) throw new Error(`compile failed for ${name}: ${JSON.stringify(compiled.cause)}`);
  return compiled.value;
}

function runLogging<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Logging>): Promise<Exit.Exit<A, E>> {
  const log = new LogWriter("test", join(tmpdir(), "piano-paper-writing-log.jsonl"), "trace-test");
  const trace = new TraceWriter("test", join(tmpdir(), "piano-paper-writing-trace.jsonl"), "trace-test");
  return Effect.runPromiseExit(effect.pipe(
    Effect.provideService(Logging, loggingService(log, trace)),
    Effect.provide(NodeFileSystem.layer),
  ));
}

/** Executable shape of a template, excluding the only two fields the full and
 * smoke variants are allowed to differ by: the workflow name and the loop's
 * wall-clock bound. */
function timedShape(compiled: CompiledWorkflow) {
  return {
    autoCommit: compiled.autoCommit,
    stages: compiled.stages.map((stage) => [stage.id, stage.stage]),
    regions: compiled.regions.map((region) => ({
      id: region.id,
      kind: region.kind,
      entry: region.entry,
      exit: region.exit,
      feedback: region.feedback,
      parentId: region.parentId,
      from: region.from,
      // The one intentional difference: `duration` is the time knob the smoke
      // variant turns down, so it is normalized out of the comparison.
      duration: region.duration === undefined ? undefined : "set",
    })),
  };
}

describe("paper-writing workflow template", () => {
  it("bounds the polish loop by duration, not by an iteration count", async () => {
    const compiled = await compileRecipeWorkflow("paper-writing");
    expect(compiled.name).toBe("paper-writing");
    expect(compiled.autoCommit).toBe(false);

    const polish = compiled.regions.find((region) => region.name === "polish");
    expect(polish).toMatchObject({
      kind: "loop",
      name: "polish",
      entry: "storyline",
      exit: "revise",
      // The reviewer's issues are the loop's memory between rounds.
      feedback: "review",
      duration: FULL_DURATION_SECONDS,
    });
    // `duration` is the only bound: an iteration count would make the run's cost
    // unknowable, because a round can be minutes (one paragraph) or hours (a
    // full figure set from raw measurements).
    expect(polish?.iterations).toBeUndefined();
    expect(compiled.regions).toHaveLength(1);
  });

  it("runs prepare → calibrate → the six-stage loop → finalize over nine workers", async () => {
    const compiled = await compileRecipeWorkflow("paper-writing");

    expect(compiled.stages.map((stage) => [stage.stage.name, stage.stage.worker])).toEqual(
      STAGE_ORDER.map(([name, worker]) => [name, worker]),
    );

    // The loop's membership, by whose parent region is `polish`. Region ids are
    // dotted paths, so membership is asserted through the region path instead.
    const inLoop = compiled.stages
      .filter((stage) => stage.regionPath.includes("polish"))
      .map((stage) => stage.stage.name);
    expect(inLoop).toEqual(["storyline", "figures", "write", "audit", "review", "revise"]);
    expect(compiled.stages.find((stage) => stage.stage.name === "prepare")?.regionPath).toEqual([]);
  });

  it("assigns the specialized model team to every paper stage", async () => {
    const full = await compileRecipeWorkflow("paper-writing");
    const smoke = await compileRecipeWorkflow("paper-writing-smoke");
    const models = (compiled: CompiledWorkflow) =>
      compiled.stages.map((stage) => [stage.stage.name, stage.stage.model]);

    expect(models(full)).toEqual(STAGE_MODELS);
    // Smoke is a wiring variant, not a different model experiment.
    expect(models(smoke)).toEqual(STAGE_MODELS);
  });

  it("routes the brief and the reference spec into the loop at the one place that can carry them", async () => {
    const compiled = await compileRecipeWorkflow("paper-writing");
    const byName = (name: string) => compiled.stages.find((stage) => stage.stage.name === name)!;

    // A stage's inputs are its direct ancestors' producer records, and inside a
    // loop those ancestors must be loop siblings. So the region's `from` — which
    // feeds its entry — is the ONLY channel by which the two pre-loop results
    // reach the round. Dropping `prepare` here would leave every round without
    // the venue, the core claim, or the evidence roots.
    expect(compiled.regions.find((region) => region.name === "polish")?.from).toEqual([
      "prepare",
      "calibrate",
    ]);

    // Every in-loop stage either is the entry or takes the entry as a carrier
    // dependency, so the round's context reaches all of them and not just the
    // ones whose skills happen to mention it.
    const loopStages = ["figures", "write", "audit", "review", "revise"];
    for (const name of loopStages) {
      expect(byName(name).stage.from, `${name} must take the loop entry as a carrier`).toContain("storyline");
    }
    // `finalize` sits outside the loop, so `polish` resolves to the loop's exit
    // leaf; the brief and calibration have to be named explicitly beside it.
    expect(byName("finalize").stage.from).toEqual(["polish", "prepare", "calibrate"]);
  });

  it("guards the build and leaves a blocked escape hatch in the two stages that edit prose", async () => {
    // Both stages are reached by the assertion, so both contracts must accept a
    // `blocked` result — otherwise a genuinely unbuildable manuscript would be
    // retried forever instead of stopping the loop.
    const repositoryRoot = process.cwd();
    for (const worker of ["paper-write", "paper-revise"]) {
      const path = join(repositoryRoot, "recipes", worker, "contract.json");
      const manifest = JSON.parse(await readFile(path, "utf8")) as {
        schema: Record<string, unknown> & {
          required: readonly string[];
          "x-piano-assertions"?: readonly { path: string }[];
          properties: Record<string, { enum?: readonly string[] }>;
        };
        outputs: { projections: readonly { id: string; pointer: string }[] };
      };
      expect(manifest.schema.required, worker).toContain("status");
      expect(manifest.schema.properties.status?.enum, worker).toEqual(["ok", "blocked"]);
      // `status` must be required: both assertions' `when` clauses compare it,
      // and a missing value would make the condition unevaluable — which the
      // contract runtime reports as a failure, not as a skip.
      expect(
        manifest.schema["x-piano-assertions"]?.map((assertion) => assertion.path),
        worker,
      ).toEqual(["/compiles", "/compiles"]);
      // The engine stops a loop when a stage projects `workflow.status` as
      // "blocked"; without this projection the escape hatch would be inert.
      expect(
        manifest.outputs.projections.find((projection) => projection.id === "workflow.status"),
        worker,
      ).toMatchObject({ pointer: "/status" });
    }
  });

  it("gives every stage the same unbounded retry policy and an interactive prepare", async () => {
    const compiled = await compileRecipeWorkflow("paper-writing");

    for (const stage of compiled.stages) {
      expect(stage.stage.retry).toEqual(RETRY_POLICY);
      // `discuss` is a pi-only custom tool; on the subprocess harnesses it is
      // silently inert, which would degrade the alignment into a one-shot guess.
      expect(stage.stage.harness).toBe("pi");
      expect(stage.stage.validate).toBe(true);
      // `max` is asked for, with the caveat recorded in the workflow header: on
      // `pi` + `deepseek-flash` an A/B probe showed `max` and `off` both report
      // `off` and produce the same reasoning tokens, so this setting is a
      // statement of intent on this harness rather than a measured lever. The
      // `dsh` adapter does honour it.
      expect(stage.stage.thinkingLevel).toBe("max");
    }

    // Only the alignment stage talks to the human.
    const discussing = compiled.stages.filter((stage) => stage.stage.discuss === true);
    expect(discussing.map((stage) => stage.stage.name)).toEqual(["prepare"]);

    // `finalize` reads the whole run, so it consumes the loop plus both
    // pre-loop stages.
    const finalize = compiled.stages.find((stage) => stage.stage.name === "finalize");
    expect(finalize?.stage.from).toEqual(["polish", "prepare", "calibrate"]);
    expect(finalize?.dependsOn).toHaveLength(3);
  });

  it("flips only the workflow name and the duration bound between the full and smoke variants", async () => {
    const full = await compileRecipeWorkflow("paper-writing");
    const smoke = await compileRecipeWorkflow("paper-writing-smoke");

    expect(smoke.name).toBe("paper-writing-smoke");
    expect(smoke.regions.find((region) => region.name === "polish")?.duration).toBe(SMOKE_DURATION_SECONDS);
    // Same stages, workers, dependencies and retry policies: `duration` is the
    // single variable a timing experiment against the smoke variant isolates.
    expect(timedShape(smoke)).toEqual(timedShape(full));
  });

  it("resolves every worker's agents.md, skill and contract", async () => {
    const repositoryRoot = process.cwd();
    const path = workflowPath("paper-writing");
    const result = await runLogging(loadWorkflow(path, repositoryRoot, repositoryRoot));

    if (!Exit.isSuccess(result)) {
      const cause = result.cause as unknown as { failures?: () => readonly { message?: string }[] };
      const reasons = (cause.failures?.() ?? []).map((failure) => failure.message).join("; ");
      expect.fail(`loadWorkflow failed: ${reasons}`);
    }

    // Worker resources are keyed by `worker\0harness`, so the worker name is
    // the key's first segment.
    const resources = new Map(
      [...result.value.workerResources!.entries()].map(([key, value]) => [key.split("\u0000")[0] ?? "", value]),
    );
    expect([...resources.keys()]).toHaveLength(STAGE_ORDER.length);
    for (const [, worker] of STAGE_ORDER) {
      const resource = resources.get(worker);
      expect(resource, `worker ${worker}`).toBeDefined();
      expect(resource?.contextFilePaths.some((file) => file.endsWith("agents.md"))).toBe(true);
      // Each worker owns exactly the skill named after it, whose frontmatter
      // must match its directory (enforced by the loader).
      expect(resource?.skillPaths.map((skill) => skill.split("/").at(-1))).toEqual([worker]);
      expect(resource?.contract?.manifest.id).toBeDefined();
    }
  });

  it("names the requestable tools in the allowlist, not only in the flags", async () => {
    const compiled = await compileRecipeWorkflow("paper-writing");
    const byName = (name: string) => compiled.stages.find((stage) => stage.stage.name === name)!;

    // `discuss: true` only supplies the callback; the session is created with
    // the stage's `tools` list as its allowlist, so a tool missing from it is
    // never mounted. The first real run had exactly this shape: the flag was
    // set, the tool was absent, and the alignment silently did not happen.
    expect(byName("prepare").stage.discuss).toBe(true);
    expect(byName("prepare").stage.tools, "discuss must be in the allowlist, not just the flag").toContain(
      "discuss",
    );

    // The same asymmetry applies to the pi extension tools: `web_search` is
    // mounted only when the stage declares it.
    expect(byName("review").stage.tools).toContain("web_search");

    // Neither is available to a stage that does not ask for it.
    for (const stage of compiled.stages) {
      if (stage.stage.name === "prepare") continue;
      expect(stage.stage.tools, stage.stage.name).not.toContain("discuss");
    }
  });

  it("gives the reviewer a web tool, and nobody else", async () => {
    const compiled = await compileRecipeWorkflow("paper-writing");

    // "The closest prior work is not cited" is a reviewer's first blocker and
    // cannot be raised or refuted from the manuscript alone; a reviewer with no
    // way to check it invents the prior work instead.
    expect(compiled.stages.find((stage) => stage.stage.name === "review")?.stage.tools).toContain(
      "web_search",
    );
    // Every other stage stays on the cheap tool set: the loop runs many rounds
    // and browsing is the most expensive thing a round could do.
    for (const stage of compiled.stages) {
      if (stage.stage.name === "review") continue;
      expect(stage.stage.tools, stage.stage.name).not.toContain("web_search");
    }
  });

  it("sizes every stage timeout so one hung turn cannot swallow the loop budget", async () => {
    const compiled = await compileRecipeWorkflow("paper-writing");
    const polish = compiled.regions.find((region) => region.name === "polish");
    const budget = polish?.duration ?? 0;

    for (const stage of compiled.stages) {
      const timeout = stage.stage.timeout ?? Number.POSITIVE_INFINITY;
      // A per-turn runaway guard priced above the whole loop budget is a run
      // that can end without ever reaching `finalize`.
      expect(timeout, stage.stage.name).toBeLessThanOrEqual(budget);
    }
  });
});
