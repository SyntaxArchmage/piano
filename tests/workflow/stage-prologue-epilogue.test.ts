import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";
import {
  executeWorkflow,
  loadWorkflow,
  parseWorkflow,
} from "../../packages/orchestrator/src/index.js";
import {
  AgentError,
  type AgentContinuation,
  type AgentEvent,
  type AgentRequest,
  type AgentResult,
  type AgentRunner,
} from "../../packages/harness/src/index.js";

const PROLOGUE_TEXT = "PROLOGUE-MARKER: read the journal before you start.";
const EPILOGUE_TEXT = "EPILOGUE-MARKER: append your entry to WORKLOG.md.";

/** A one-stage workflow carrying the two primitives under test. */
function workflowSource(options: { prologue?: string; epilogue?: string } = {}): string {
  const lines = [
    "version: 3",
    "workflow:",
    "  name: prologue-epilogue",
    "  nodes:",
    "    - stage:",
    "        name: respond",
    "        worker: basic",
  ];
  // JSON string literals are valid YAML double-quoted scalars, so the prompt
  // text round-trips exactly through the parser.
  if (options.prologue !== undefined) lines.push(`        prologue: ${JSON.stringify(options.prologue)}`);
  if (options.epilogue !== undefined) lines.push(`        epilogue: ${JSON.stringify(options.epilogue)}`);
  lines.push("        from: []", "");
  return lines.join("\n");
}

function continuation(sessionId: string): AgentContinuation {
  return { harness: "pi", sessionId, transcriptPath: `/tmp/${sessionId}.jsonl` };
}

async function testSession(root: string) {
  return Effect.runPromise(
    createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
}

function runWorkflow<A>(
  session: Awaited<ReturnType<typeof testSession>>,
  effect: Effect.Effect<A, unknown, Logging | import("@effect/platform").FileSystem.FileSystem>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(
    Effect.provideService(Logging, loggingService(session.log, session.trace)),
    Effect.provide(NodeFileSystem.layer),
  ));
}

/** Drive the real workflow engine with an injected runner, recording every
 * turn it asks for. `failFollowUp` makes the turn after the first one fail.
 * `workerDefaults` writes the worker plugin's own prologue.md/epilogue.md into
 * a temporary recipes root, which the load then resolves against. */
async function runStage(
  options: {
    prologue?: string;
    epilogue?: string;
    workerDefaults?: { prologue?: string; epilogue?: string };
    failFollowUp?: boolean;
    onFollowUp?: (request: AgentRequest) => Promise<void>;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "piano-prologue-epilogue-"));
  const path = join(root, "workflow.yml");
  await writeFile(path, workflowSource({
    ...(options.prologue === undefined ? {} : { prologue: options.prologue }),
    ...(options.epilogue === undefined ? {} : { epilogue: options.epilogue }),
  }));
  // The load resolves `recipes/` below the repository root it is given, so a
  // case with worker defaults supplies a root containing one.
  let recipeRepositoryRoot: string | undefined;
  if (options.workerDefaults !== undefined) {
    recipeRepositoryRoot = root;
    const workerDir = join(root, "recipes", "basic");
    await mkdir(workerDir, { recursive: true });
    if (options.workerDefaults.prologue !== undefined) {
      await writeFile(join(workerDir, "prologue.md"), options.workerDefaults.prologue);
    }
    if (options.workerDefaults.epilogue !== undefined) {
      await writeFile(join(workerDir, "epilogue.md"), options.workerDefaults.epilogue);
    }
  }
  const session = await testSession(root);
  const prompts: string[] = [];
  const resumed: (AgentContinuation | undefined)[] = [];
  const events: AgentEvent[] = [];
  const runner: AgentRunner = (request) => {
    prompts.push(request.prompt);
    resumed.push(request.continuation);
    const turn = prompts.length;
    if (turn > 1 && options.failFollowUp === true) {
      return Effect.fail(new AgentError({ kind: "request-rejected", message: "follow-up exploded" }));
    }
    return turn > 1 && options.onFollowUp !== undefined
      ? Effect.promise(async (): Promise<AgentResult> => {
        await options.onFollowUp!(request);
        return {
          sessionId: "session-1",
          transcriptPath: "/tmp/session-1.jsonl",
          text: `turn ${turn}`,
          continuation: continuation("session-1"),
        };
      })
      : Effect.sync((): AgentResult => {
        // A distinct event type per turn, so a test can tell the stage's own
        // turn apart from the follow-up and check each one's attribution.
        request.onEvent?.({ type: turn === 1 ? "agent_start" : "agent_settled" });
        return {
          sessionId: "session-1",
          transcriptPath: "/tmp/session-1.jsonl",
          text: `turn ${turn}`,
          continuation: continuation("session-1"),
        };
      });
  };
  const result = await runWorkflow(session, loadWorkflow(path, root, recipeRepositoryRoot).pipe(
    Effect.flatMap((loaded) => executeWorkflow(loaded, {
      runDir: session.runDir,
      runId: "prologue-epilogue",
      cwd: root,
      prompt: "the whole task",
      agentRunner: runner,
      onEvent: (event) => { events.push(event); },
    })),
  ));
  return { result, prompts, resumed, events, root };
}

describe("stage prologue/epilogue prompt primitives", () => {
  it("parses both fields and rejects blank text", async () => {
    const parsed = await Effect.runPromise(parseWorkflow(
      workflowSource({ prologue: PROLOGUE_TEXT, epilogue: EPILOGUE_TEXT }),
      "/tmp/w.yml",
    ));
    const node = parsed.workflow.nodes[0];
    const stage = node !== undefined && "stage" in node ? node.stage : undefined;
    expect(stage?.prologue).toBe(PROLOGUE_TEXT);
    expect(stage?.epilogue).toBe(EPILOGUE_TEXT);

    // A blank instruction is a mistake worth surfacing, not a silent no-op.
    for (const field of ["prologue", "epilogue"] as const) {
      const blank = await Effect.runPromiseExit(parseWorkflow(
        workflowSource({ [field]: "   " }),
        "/tmp/w.yml",
      ));
      expect(Exit.isFailure(blank)).toBe(true);
    }
  });

  it("appends the prologue to the stage prompt and sends the epilogue as one resumed follow-up", async () => {
    const { result, prompts, resumed } = await runStage({ prologue: PROLOGUE_TEXT, epilogue: EPILOGUE_TEXT });

    // Exactly two turns: the stage's own, then one follow-up.
    expect(prompts).toHaveLength(2);
    // The prologue is appended to the stage prompt, as the last thing read.
    expect(prompts[0]).toContain("## Prologue");
    expect(prompts[0]).toContain(PROLOGUE_TEXT);
    expect(prompts[0]?.trimEnd().endsWith(PROLOGUE_TEXT)).toBe(true);
    // The follow-up is the epilogue text itself, not the stage prompt again.
    expect(prompts[1]).toBe(EPILOGUE_TEXT);
    // The first turn opens a session; the follow-up resumes that same one.
    expect(resumed[0]).toBeUndefined();
    expect(resumed[1]).toEqual(continuation("session-1"));
    // The accepted result stays the first turn's: the epilogue cannot replace it.
    expect(result.stages[0]?.text).toBe("turn 1");
  });

  it("sends no follow-up at all when the stage declares no epilogue", async () => {
    const { prompts } = await runStage({ prologue: PROLOGUE_TEXT });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(PROLOGUE_TEXT);
  });

  it("leaves the stage prompt untouched when only the epilogue is declared", async () => {
    const { prompts } = await runStage({ epilogue: EPILOGUE_TEXT });
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain("## Prologue");
    expect(prompts[1]).toBe(EPILOGUE_TEXT);
  });

  it("keeps the accepted stage when the follow-up turn fails", async () => {
    // The stage already passed every check, so a journal turn that fails is a
    // logged side effect and never a stage failure.
    const { result, prompts } = await runStage({
      prologue: PROLOGUE_TEXT,
      epilogue: EPILOGUE_TEXT,
      failFollowUp: true,
    });
    expect(prompts).toHaveLength(2);
    expect(result.stages[0]?.text).toBe("turn 1");
  });

  it("attributes follow-up output to the stage, and leaves it out of the record", async () => {
    // The TUI renders streaming text per stage, so an unattributed follow-up
    // would show up as output belonging to no stage. Each turn emits its own
    // event type, so both turns are checked and neither can cover for the other.
    const { result, events } = await runStage({ epilogue: EPILOGUE_TEXT });
    for (const type of ["agent_start", "agent_settled"] as const) {
      const ofType = events.filter((event) => event.type === type);
      expect(ofType, `events of type ${type}`).toHaveLength(1);
      expect(ofType[0]?.workflow?.stageId, `${type} attribution`).toBe("respond");
      expect(ofType[0]?.workflow?.attempt, `${type} attempt`).toBe(1);
    }

    // A non-evidence turn is not an attempt: the stage still reports the one
    // attempt that produced its accepted result.
    expect(result.stages[0]?.attempts).toBe(1);
    expect(result.stages[0]?.text).toBe("turn 1");
  });

  it("falls back to the worker plugin's prologue.md and epilogue.md", async () => {
    // A worker that always wants the same instruction should not make every
    // workflow repeat it, so the plugin's files apply when the stage is silent.
    const { prompts } = await runStage({
      workerDefaults: { prologue: PROLOGUE_TEXT, epilogue: EPILOGUE_TEXT },
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("## Prologue");
    expect(prompts[0]).toContain(PROLOGUE_TEXT);
    expect(prompts[1]).toBe(EPILOGUE_TEXT);
  });

  it("lets a stage override its worker plugin's default", async () => {
    // Both halves of the fallback, checked in one run: if overrides silently won
    // or silently lost, one of these two assertions would pass for the wrong
    // reason and the pair would not be a real precedence test.
    const stagePrologue = "STAGE PROLOGUE wins.";
    const stageEpilogue = "STAGE EPILOGUE wins.";
    const { prompts } = await runStage({
      prologue: stagePrologue,
      epilogue: stageEpilogue,
      workerDefaults: { prologue: PROLOGUE_TEXT, epilogue: EPILOGUE_TEXT },
    });
    expect(prompts[0]).toContain(stagePrologue);
    expect(prompts[0]).not.toContain(PROLOGUE_TEXT);
    expect(prompts[1]).toBe(stageEpilogue);
    expect(prompts[1]).not.toBe(EPILOGUE_TEXT);
  });
});
