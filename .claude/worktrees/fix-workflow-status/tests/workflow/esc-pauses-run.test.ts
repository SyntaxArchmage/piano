// Escape-then-exit is a pause, not a failure. The engine half of the UX:
// a turn interrupted mid-flight must leave (1) `resume.json` carrying the
// harness session that turn opened — the partial transcript is on disk — and
// (2) `progress.json` finalized as "paused", never "failed". The next prompt
// then reopens the same actor conversation and runs to completion. The TUI
// half lives in tests/tui/pause-exit-resume.test.ts.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sleep, waitFor } from "../common/terminal.js";
import { readJson } from "../common/fs.js";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Exit, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { createSession, isCancellation, Logging, loggingService } from "../../packages/logging/src/index.js";
import {
  executeWorkflow,
  loadWorkflow,
  readWorkflowExecutionContinuation,
} from "../../packages/orchestrator/src/index.js";
import {
  AgentError,
  withFailedContinuation,
  type AgentResult,
  type AgentRunner,
} from "../../packages/harness/src/index.js";

const SINGLE_STAGE_WORKFLOW = `version: 3
workflow:
  name: esc-pauses-run
  nodes:
    - stage:
        name: agent
        worker: basic
        harness: pi
        from: []
`;

const SIGNOFF_STAGE_WORKFLOW = `version: 3
workflow:
  name: reject-keeps-session
  nodes:
    - stage:
        name: agent
        worker: basic
        harness: pi
        from: []
        signoff: true
`;

/** The identity a turn opened before it was cut short. */
const HANGING_SESSION = {
  harness: "pi",
  sessionId: "sess-hang",
  transcriptPath: "/runs/esc/actors/pi/agent/session/sess-hang.jsonl",
};

/** Turn 1 hangs until the caller's abort signal fires, failing exactly like a
 * real interrupted turn: a `cancelled` AgentError stashing the session the
 * attempt opened (see pi.ts / subprocess.ts). Turn 2 settles successfully,
 * echoing the continuation it was asked to reopen. */
function scriptedRunner(requests: unknown[]) {
  let turn = 0;
  const runner: AgentRunner = (request) => {
    requests.push(request);
    turn += 1;
    if (turn === 1) {
      return Effect.async<AgentResult, AgentError>((resume) => {
        const abort = (): void => resume(Effect.fail(withFailedContinuation(
          new AgentError({ kind: "cancelled", message: "pi request cancelled" }),
          HANGING_SESSION,
        )));
        if (request.signal?.aborted) {
          abort();
          return;
        }
        request.signal?.addEventListener("abort", abort, { once: true });
        return Effect.sync(() => {
          request.signal?.removeEventListener("abort", abort);
        });
      });
    }
    const sessionId = request.continuation?.sessionId ?? "sess-fresh";
    const transcriptPath = request.continuation?.transcriptPath
      ?? `/runs/esc/actors/pi/agent/session/${sessionId}.jsonl`;
    return Effect.succeed<AgentResult>({
      sessionId,
      transcriptPath,
      text: "resumed answer",
      continuation: { harness: "pi", sessionId, transcriptPath },
    });
  };
  return runner;
}

describe("Escape pauses a run instead of failing it", () => {
  it("persists the interrupted turn's session and resumes the same actor on the next prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-esc-pauses-"));
    try {
      await writeFile(join(root, "workflow.yml"), SINGLE_STAGE_WORKFLOW);
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const requests: unknown[] = [];
      const runner = scriptedRunner(requests);
      const prompt = (text: string, execution: unknown, signal?: AbortSignal) =>
        loadWorkflow(join(root, "workflow.yml"), root).pipe(
          Effect.flatMap((loaded) => executeWorkflow(loaded, {
            runDir: session.runDir,
            cwd: root,
            prompt: text,
            executionId: session.id,
            ...(signal === undefined ? {} : { signal }),
            ...(execution === undefined ? {} : { execution: execution as never }),
            agentRunner: runner,
          })),
          Effect.provideService(Logging, loggingService(session.log, session.trace)),
          Effect.provide(NodeFileSystem.layer),
        );

      // Prompt 1: abort mid-turn, exactly what the TUI's Escape does — the
      // same AbortController `runPrompt` wires to `onInterrupt`.
      const controller = new AbortController();
      const fiber = Effect.runFork(prompt("start the work", undefined, controller.signal));
      await waitFor("the turn is open", () => requests.length === 1);
      controller.abort();
      const exit = await Effect.runPromise(Fiber.await(fiber));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(isCancellation(exit.cause)).toBe(true);

      // The interrupted attempt's session survived into the canonical state
      // file: same sessionId, continuation present.
      const resumeState = await readJson(join(session.runDir, "resume.json"));
      const actors = resumeState.actors as Record<string, Record<string, unknown>>;
      const actor = Object.values(actors)[0];
      expect(actor).toBeDefined();
      expect(actor?.harness).toBe("pi");
      expect(actor?.sessionId).toBe(HANGING_SESSION.sessionId);
      expect(actor?.continuation).toMatchObject({
        harness: "pi",
        sessionId: HANGING_SESSION.sessionId,
        transcriptPath: HANGING_SESSION.transcriptPath,
      });

      // The convenience snapshot says paused, not failed.
      expect((await readJson(join(session.runDir, "progress.json"))).status).toBe("paused");

      // Prompt 2 on the same run: the next-prompt path (identical to /resume)
      // hands the harness the exact session the interrupted turn opened.
      const execution = await Effect.runPromise(
        readWorkflowExecutionContinuation(session.runDir, session.id).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      expect(execution).toBeDefined();
      const continued = await Effect.runPromise(prompt("continue", execution));
      expect(requests).toHaveLength(2);
      expect((requests[1] as { continuation?: { sessionId?: string } }).continuation?.sessionId)
        .toBe(HANGING_SESSION.sessionId);
      expect((requests[1] as { continuation?: { transcriptPath?: string } }).continuation?.transcriptPath)
        .toBe(HANGING_SESSION.transcriptPath);

      // Paused -> running -> completed: one execution across the pause.
      expect((await readJson(join(session.runDir, "progress.json"))).status).toBe("completed");
      const after = await Effect.runPromise(
        readWorkflowExecutionContinuation(session.runDir, session.id).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      expect(after?.id).toBe(continued.executionId);
      expect(after?.promptIndex).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("finalizes a bare fiber interrupt (no abort signal) as paused too", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-esc-interrupt-"));
    try {
      await writeFile(join(root, "workflow.yml"), SINGLE_STAGE_WORKFLOW);
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      // A runner that ignores aborts entirely: the only way out is the fiber
      // interrupt /exit performs after its drain budget.
      const stuckRunner: AgentRunner = () => Effect.async<AgentResult, AgentError>(() => {
        // No resume, no finalizer: nothing but interruption ends this turn.
      });
      const fiber = Effect.runFork(
        loadWorkflow(join(root, "workflow.yml"), root).pipe(
          Effect.flatMap((loaded) => executeWorkflow(loaded, {
            runDir: session.runDir,
            cwd: root,
            prompt: "long task",
            executionId: session.id,
            agentRunner: stuckRunner,
          })),
          Effect.provideService(Logging, loggingService(session.log, session.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      await sleep(200);
      const exit = await Effect.runPromise(Fiber.interrupt(fiber));
      expect(Exit.isFailure(exit)).toBe(true);
      // The durable verdict for an interrupted run: paused, never failed.
      expect((await readJson(join(session.runDir, "progress.json"))).status).toBe("paused");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  // The harder half of the same promise. An interrupt carries no error at all,
  // so there is no cancellation to react to and no result to read: the session
  // can only survive if it was recorded while the turn was open. `/exit` and
  // Ctrl+C on a busy prompt do exactly this — abort, then interrupt the prompt
  // fiber — and used to leave the run's actors untouched, so the next prompt
  // silently started a new conversation while the harness session sat on disk.
  it("keeps the session an interrupted turn announced, with no error and no result", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-interrupt-keeps-"));
    try {
      await writeFile(join(root, "workflow.yml"), SINGLE_STAGE_WORKFLOW);
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const announced = {
        harness: "pi",
        sessionId: "sess-announced",
        nativeSessionId: "01a08aad-eddf-7ad3-b451-07560a70e58b",
        transcriptPath: "/runs/interrupt/actors/pi/agent/session/sess-announced.jsonl",
      };
      let opened: () => void = () => undefined;
      const open = new Promise<void>((resolve) => { opened = resolve; });
      const runner: AgentRunner = (request) => Effect.sync(() => {
        // What a real harness does the moment its session exists (pi.ts after
        // the session is created, subprocess.ts once the child names itself),
        // and then it works on with no end in sight. The signal comes from
        // inside the effect, not from building it: executeWorker runs the
        // runner eagerly, so an earlier signal would race the fiber that has
        // not reached this attempt yet.
        request.onContinuation?.(announced);
        opened();
      }).pipe(
        Effect.andThen(Effect.async<AgentResult, AgentError>(() => {
          // Nothing but interruption ends this turn: no resume, no failure.
        })),
      );
      const fiber = Effect.runFork(
        loadWorkflow(join(root, "workflow.yml"), root).pipe(
          Effect.flatMap((loaded) => executeWorkflow(loaded, {
            runDir: session.runDir,
            cwd: root,
            prompt: "long task",
            executionId: session.id,
            agentRunner: runner,
          })),
          Effect.provideService(Logging, loggingService(session.log, session.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      await open;
      const exit = await Effect.runPromise(Fiber.interrupt(fiber));
      expect(Exit.isFailure(exit)).toBe(true);

      const resumeState = await readJson(join(session.runDir, "resume.json"));
      const actors = resumeState.actors as Record<string, Record<string, unknown>>;
      const actor = Object.values(actors)[0];
      expect(actor?.harness).toBe("pi");
      expect(actor?.sessionId).toBe(announced.sessionId);
      // The harness's own handle survives too: without it a Claude actor comes
      // back with nothing `--resume` can accept.
      expect(actor?.continuation).toMatchObject(announced);
      // The interrupted turn was not accepted, so the resumed conversation is
      // the one the user was in the middle of.
      expect(actor?.turns).toBe(0);

      // The next prompt (identical to /resume) reopens it rather than starting over.
      const execution = await Effect.runPromise(
        readWorkflowExecutionContinuation(session.runDir, session.id).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      expect(execution?.actors.size).toBe(1);
      expect([...(execution?.actors.values() ?? [])][0]?.continuation.sessionId).toBe(announced.sessionId);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("a rejected sign-off keeps the turn's session durable the moment it lands, not only at acceptance", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-reject-keeps-"));
    try {
      await writeFile(join(root, "workflow.yml"), SIGNOFF_STAGE_WORKFLOW);
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const requests: Array<{ prompt: string; continuation?: { sessionId?: string } }> = [];
      let turn = 0;
      const runner: AgentRunner = (request) => {
        requests.push(request);
        turn += 1;
        if (turn === 1) {
          return Effect.succeed<AgentResult>({
            sessionId: "sess-r",
            transcriptPath: "/runs/reject/actors/pi/agent/session/sess-r.jsonl",
            text: "DRAFT1",
            continuation: {
              harness: "pi",
              sessionId: "sess-r",
              transcriptPath: "/runs/reject/actors/pi/agent/session/sess-r.jsonl",
            },
          });
        }
        // The "keep working" rework hangs until the interrupt, stashing the
        // same actor session — a reopened pi/claude session keeps its id.
        return Effect.async<AgentResult, AgentError>((resume) => {
          const abort = (): void => resume(Effect.fail(withFailedContinuation(
            new AgentError({ kind: "cancelled", message: "pi request cancelled" }),
            { harness: "pi", sessionId: "sess-r", transcriptPath: "/runs/reject/actors/pi/agent/session/sess-r.jsonl" },
          )));
          if (request.signal?.aborted) {
            abort();
            return;
          }
          request.signal?.addEventListener("abort", abort, { once: true });
          return Effect.sync(() => {
            request.signal?.removeEventListener("abort", abort);
          });
        });
      };
      const gate: string[] = [];
      const signoff = () => {
        gate.push("decision");
        return Effect.succeed(gate.length === 1
          ? { type: "retry" as const, note: "redo it better" }
          : { type: "continue" as const });
      };

      const controller = new AbortController();
      const fiber = Effect.runFork(
        loadWorkflow(join(root, "workflow.yml"), root).pipe(
          Effect.flatMap((loaded) => executeWorkflow(loaded, {
            runDir: session.runDir,
            cwd: root,
            prompt: "start the work",
            executionId: session.id,
            signal: controller.signal,
            agentRunner: runner,
            signoff,
          })),
          Effect.provideService(Logging, loggingService(session.log, session.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      // The reviewer rejected: the turn already completed, so its session is
      // durable NOW. Reject means "work is not allowed to complete", not
      // "nothing was saved": the rework continues in the same conversation and
      // an interrupt during it must not fall back to a pre-turn resume state.
      await waitFor("the review was rejected", () => gate.length === 1);
      const midActor = Object.values(
        (await readJson(join(session.runDir, "resume.json"))).actors as Record<string, Record<string, unknown>>,
      )[0];
      expect(midActor?.sessionId).toBe("sess-r");
      expect(midActor?.turns).toBe(1);
      expect(midActor?.continuation).toBeDefined();

      await waitFor("the rework started", () => requests.length === 2);
      const rework = requests[1]!;
      expect(rework.continuation?.sessionId).toBe("sess-r");
      expect(rework.prompt).toContain("redo it better");

      controller.abort();
      const exit = await Effect.runPromise(Fiber.await(fiber));
      expect(Exit.isFailure(exit) && isCancellation(exit.cause)).toBe(true);
      expect((await readJson(join(session.runDir, "progress.json"))).status).toBe("paused");
      const finalActor = Object.values(
        (await readJson(join(session.runDir, "resume.json"))).actors as Record<string, Record<string, unknown>>,
      )[0];
      // The rejected turn's count survived the interrupt (live map read, not
      // the stale pre-attempt snapshot).
      expect(finalActor?.sessionId).toBe("sess-r");
      expect(finalActor?.turns).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
