import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Cause, Effect, Fiber } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSession,
  defaultRoot,
  failureDetails,
  isCancellation,
  LogWriter,
  Logging,
  logger,
  loggingService,
  TRACE,
} from "../../packages/logging/src/index.js";

const provideNode = <A, E>(program: Effect.Effect<A, E, import("@effect/platform").FileSystem.FileSystem>) =>
  program.pipe(Effect.provide(NodeFileSystem.layer));

describe("logging Effect boundary", () => {
  let root: string;

  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it("creates a session and writes a source-located run log", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logging-"));
    const session = await Effect.runPromise(provideNode(createSession({ cwd: root, runsRoot: join(root, "runs") })));
    expect(session.root).toBe(defaultRoot);
    expect(session.runDir).toContain(`${join(root, "runs")}/`);
    const log = await readFile(join(session.runDir, "log.jsonl"), "utf8");

    expect(log).toContain('"event":"run.created"');
    expect(log).toContain('"function":"createSession"');
    expect(log).toContain('"event":"function.enter"');
    expect(log).toContain('"event":"function.exit"');
    const runCreated = JSON.parse(log.split("\n").find((line) => line.includes('"event":"run.created"')) ?? "{}") as Record<string, unknown>;
    expect(runCreated).toMatchObject({
      timestamp: expect.any(String),
      trace_id: session.traceId,
      severity: "info",
      namespace: "logging",
      attributes: { runDir: session.runDir },
    });
    const trace = await readFile(join(session.runDir, "trace.jsonl"), "utf8");
    expect(trace).toContain(`"trace_id":"${session.traceId}"`);
    expect(trace).toContain('"fn":"createSession"');
  });

  it("persists the run trajectory beside the log and trace", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logging-"));
    const session = await Effect.runPromise(provideNode(createSession({ cwd: root, runsRoot: join(root, "runs") })));
    await Effect.runPromise(provideNode(session.trajectory.write({
      status: "completed",
      promptLength: 5,
      events: [{ type: "text", text: "ok" }],
      sessionId: "session",
      transcriptPath: "/tmp/session.jsonl",
    })));

    const trajectory = JSON.parse(await readFile(join(session.runDir, "trajectory.json"), "utf8")) as Record<string, unknown>;
    expect(trajectory).toMatchObject({
      version: 1,
      runId: session.id,
      status: "completed",
      promptLength: 5,
      sessionId: "session",
      transcriptPath: "/tmp/session.jsonl",
      events: [{ type: "text", text: "ok" }],
    });
  });

  it("retains events when one TUI session submits multiple prompts", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logging-"));
    const session = await Effect.runPromise(provideNode(createSession({ cwd: root, runsRoot: join(root, "runs") })));
    await Effect.runPromise(provideNode(session.trajectory.write({
      status: "completed",
      promptLength: 5,
      events: [{ type: "message_end", prompt: "first" }],
      sessionId: "session-1",
      transcriptPath: "/tmp/session-1.jsonl",
    })));
    await Effect.runPromise(provideNode(session.trajectory.write({
      status: "completed",
      promptLength: 6,
      events: [{ type: "message_end", prompt: "second" }],
      sessionId: "session-2",
      transcriptPath: "/tmp/session-2.jsonl",
    })));

    const trajectory = JSON.parse(await readFile(join(session.runDir, "trajectory.json"), "utf8")) as Record<string, unknown>;
    expect(trajectory).toMatchObject({
      status: "completed",
      promptLength: 6,
      sessionId: "session-2",
      transcriptPath: "/tmp/session-2.jsonl",
      events: [
        { type: "message_end", prompt: "first" },
        { type: "message_end", prompt: "second" },
      ],
    });
  });

  it("renames a run, preserving the rest of the trajectory document", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logging-"));
    const session = await Effect.runPromise(provideNode(createSession({ cwd: root, runsRoot: join(root, "runs") })));
    await Effect.runPromise(provideNode(session.trajectory.write({
      status: "completed",
      promptLength: 5,
      events: [{ type: "message_end", prompt: "first" }],
      sessionId: "session-1",
      transcriptPath: "/tmp/session-1.jsonl",
    })));
    await Effect.runPromise(provideNode(session.trajectory.rename("fix matmul kernel")));

    const trajectory = JSON.parse(await readFile(join(session.runDir, "trajectory.json"), "utf8")) as Record<string, unknown>;
    expect(trajectory).toMatchObject({
      name: "fix matmul kernel",
      status: "completed",
      sessionId: "session-1",
      transcriptPath: "/tmp/session-1.jsonl",
      events: [{ type: "message_end", prompt: "first" }],
    });
  });

  it("indexes each prompt as a turn whose event count is cumulative", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logging-"));
    const session = await Effect.runPromise(provideNode(createSession({ cwd: root, runsRoot: join(root, "runs") })));
    await Effect.runPromise(provideNode(session.trajectory.write({
      prompt: "first",
      status: "completed",
      promptLength: 5,
      events: [{ type: "message_end", prompt: "first" }, { type: "done" }],
      workflowPath: "/repo/recipes/workflows/basic.yaml",
      workspaceCwd: "/repo/work",
    })));
    await Effect.runPromise(provideNode(session.trajectory.write({
      prompt: "second",
      status: "failed",
      promptLength: 6,
      events: [{ type: "message_end", prompt: "second" }],
    })));

    const trajectory = JSON.parse(await readFile(join(session.runDir, "trajectory.json"), "utf8")) as Record<string, unknown>;
    expect(trajectory.turns).toEqual([
      { prompt: "first", status: "completed", eventCount: 2 },
      // Cumulative, so replay slices [2, 3) for this turn.
      { prompt: "second", status: "failed", eventCount: 3 },
    ]);
    // The resume fields carry forward: the second turn did not restate them.
    expect(trajectory).toMatchObject({
      workflowPath: "/repo/recipes/workflows/basic.yaml",
      workspaceCwd: "/repo/work",
    });
  });

  it("does not add a turn for a write that carries no prompt", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logging-"));
    const session = await Effect.runPromise(provideNode(createSession({ cwd: root, runsRoot: join(root, "runs") })));
    await Effect.runPromise(provideNode(session.trajectory.write({
      prompt: "first",
      status: "completed",
      promptLength: 5,
      events: [{ type: "message_end", prompt: "first" }],
    })));
    await Effect.runPromise(provideNode(session.trajectory.rename("fix matmul kernel")));

    const trajectory = JSON.parse(await readFile(join(session.runDir, "trajectory.json"), "utf8")) as Record<string, unknown>;
    expect(trajectory.turns).toEqual([{ prompt: "first", status: "completed", eventCount: 1 }]);
  });

  it("fails rename when the trajectory does not exist yet", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logging-"));
    const session = await Effect.runPromise(provideNode(createSession({ cwd: root, runsRoot: join(root, "runs") })));
    const exit = await Effect.runPromiseExit(provideNode(session.trajectory.rename("no such run")));
    expect(exit._tag).toBe("Failure");
  });

  it("reports serialization failures through the Effect error channel", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logging-"));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const writer = new LogWriter("test", join(root, "log.jsonl"));
    const exit = await Effect.runPromiseExit(provideNode(writer.append("bad.payload", { data: circular })));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure" && Cause.isFailure(exit.cause)) {
      expect(exit.cause._tag === "Fail" ? exit.cause.error._tag : undefined).toBe("LogWriteError");
    }
  });

  it("adds nested function spans through LOG and TRACE", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logging-"));
    const session = await Effect.runPromise(provideNode(createSession({ cwd: root, runsRoot: join(root, "runs") })));
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* logger({ module: "tests", file: "logging.test.ts", function: "nestedSpans" }, { namespace: "tests" })
          .info("test.started", { data: { purpose: "test" } });
        yield* TRACE(
          { module: "tests", file: "logging.test.ts", function: "outer" },
          TRACE({ module: "tests", file: "logging.test.ts", function: "inner" }, Effect.succeed("ok")),
        );
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ),
    );

    const trace = await readFile(join(session.runDir, "trace.jsonl"), "utf8");
    const log = await readFile(join(session.runDir, "log.jsonl"), "utf8");
    expect(log).toContain('"event":"test.started"');
    expect(log).toContain('"event":"function.enter"');
    expect(log).toContain('"event":"function.exit"');
    const testStarted = JSON.parse(log.split("\n").find((line) => line.includes('"event":"test.started"')) ?? "{}") as Record<string, unknown>;
    expect(testStarted).toMatchObject({ namespace: "tests", attributes: { purpose: "test" } });
    expect(trace).toContain('"fn":"outer"');
    expect(trace).toContain('"fn":"inner"');
    expect(trace.indexOf('"fn":"outer"')).toBeLessThan(trace.indexOf('"fn":"inner"'));
  });

  it("preserves the business error while recording a failed span", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logging-"));
    const session = await Effect.runPromise(provideNode(createSession({ cwd: root, runsRoot: join(root, "runs") })));
    const exit = await Effect.runPromiseExit(
      TRACE(
        { module: "tests", file: "logging.test.ts", function: "failed" },
        Effect.fail("business failure"),
      ).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      expect(exit.cause.error).toBe("business failure");
    }
    const trace = await readFile(join(session.runDir, "trace.jsonl"), "utf8");
    const log = await readFile(join(session.runDir, "log.jsonl"), "utf8");
    expect(trace).toContain('"event":"error"');
    expect(trace).toContain('"fn":"failed"');
    expect(log).toContain('"event":"function.error"');
    const traceError = JSON.parse(trace.split("\n").find((line) => line.includes('"event":"error"')) ?? "{}") as Record<string, unknown>;
    const logError = JSON.parse(log.split("\n").find((line) => line.includes('"event":"function.error"')) ?? "{}") as Record<string, unknown>;
    expect(traceError).toMatchObject({ status: "error", error: { type: "string", message: "business failure" } });
    expect(logError.attributes).toMatchObject({ error: { type: "string", message: "business failure" } });
    expect(logError).toMatchObject({ severity: "error", outcome: "failure" });
  });

  it("keeps error formatting total when a cause getter throws", () => {
    const throwingMessage: Record<string, unknown> = {};
    Object.defineProperty(throwingMessage, "message", {
      get: () => { throw new Error("message unavailable"); },
    });
    const throwingCause = new Proxy<Record<string, unknown>>({}, {
      get: () => { throw new Error("cause unavailable"); },
    });

    expect(failureDetails(throwingMessage)).toEqual({
      type: "UnknownError",
      message: "error details unavailable",
    });
    expect(isCancellation(throwingCause)).toBe(false);
  });

  it("records cancellation as a non-error outcome and recognizes Effect interrupts", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logging-"));
    const session = await Effect.runPromise(provideNode(createSession({ cwd: root, runsRoot: join(root, "runs") })));
    expect(isCancellation({ _tag: "Interrupt" })).toBe(true);
    const exit = await Effect.runPromiseExit(
      TRACE(
        { module: "tests", file: "logging.test.ts", function: "cancelled" },
        Effect.fail({ kind: "cancelled", message: "user stopped the task" }),
      ).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ),
    );
    const interruptedExit = await Effect.runPromiseExit(
      TRACE(
        { module: "tests", file: "logging.test.ts", function: "interrupted" },
        Effect.interrupt,
      ).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ),
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(TRACE(
          { module: "tests", file: "logging.test.ts", function: "externallyInterrupted" },
          Effect.never,
        ));
        yield* Effect.sleep("10 millis");
        yield* Fiber.interrupt(fiber);
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ),
    );

    expect(exit._tag).toBe("Failure");
    expect(interruptedExit._tag).toBe("Failure");
    const logRecords = (await readFile(join(session.runDir, "log.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const cancelled = logRecords.find((record) => record.event === "function.error" && record.function === "cancelled");
    const interrupted = logRecords.find((record) => record.event === "function.error" && record.function === "interrupted");
    const externallyInterrupted = logRecords.find((record) => record.event === "function.error" && record.function === "externallyInterrupted");
    expect(cancelled).toMatchObject({ severity: "debug", outcome: "cancelled" });
    expect(interrupted).toMatchObject({ severity: "debug", outcome: "cancelled" });
    expect(externallyInterrupted).toMatchObject({ severity: "debug", outcome: "cancelled" });
    const traceRecords = (await readFile(join(session.runDir, "trace.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const externalTraceError = traceRecords.find((record) => record.event === "error" && record.fn === "externallyInterrupted");
    expect(externalTraceError).toMatchObject({ status: "error" });
    expect(JSON.stringify(externalTraceError)).toContain("Interrupt");
  });

  it("correlates function logs with their trace spans", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logging-"));
    const session = await Effect.runPromise(provideNode(createSession({ cwd: root, runsRoot: join(root, "runs") })));
    await Effect.runPromise(
      TRACE(
        { module: "tests", file: "logging.test.ts", function: "correlated" },
        Effect.succeed("ok"),
      ).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ),
    );

    const logRecords = (await readFile(join(session.runDir, "log.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const traceRecords = (await readFile(join(session.runDir, "trace.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const enterLog = logRecords.find((record) => record.event === "function.enter" && record.function === "correlated");
    const enterTrace = traceRecords.find((record) => record.event === "enter" && record.fn === "correlated");
    expect(enterLog?.span_id).toBe(enterTrace?.span_id);
  });

  it("bounds trace arguments and results", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logging-"));
    const session = await Effect.runPromise(provideNode(createSession({ cwd: root, runsRoot: join(root, "runs") })));
    const largeValue = "x".repeat(500);
    await Effect.runPromise(
      TRACE(
        { module: "tests", file: "logging.test.ts", function: "bounded" },
        Effect.succeed(largeValue),
        { prompt: largeValue },
      ).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ),
    );

    const trace = await readFile(join(session.runDir, "trace.jsonl"), "utf8");
    expect(trace).not.toContain(largeValue);
    expect(trace).toContain("...");
  });

  it("keeps trace evidence writable for primitive BigInt values", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logging-"));
    const session = await Effect.runPromise(provideNode(createSession({ cwd: root, runsRoot: join(root, "runs") })));
    await Effect.runPromise(
      TRACE(
        { module: "tests", file: "logging.test.ts", function: "bigintPayload" },
        Effect.succeed(7n),
        3n,
      ).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ),
    );

    const records = (await readFile(join(session.runDir, "trace.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.find((record) => record.event === "enter" && record.fn === "bigintPayload")?.args).toBe("3n");
    expect(records.find((record) => record.event === "exit" && record.fn === "bigintPayload")?.result).toBe("7n");
  });

  it("keeps trace evidence writable for direct BigInt object fields", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logging-"));
    const session = await Effect.runPromise(provideNode(createSession({ cwd: root, runsRoot: join(root, "runs") })));
    await Effect.runPromise(
      TRACE(
        { module: "tests", file: "logging.test.ts", function: "bigintObjectPayload" },
        Effect.succeed({ count: 7n }),
        { count: 3n },
      ).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ),
    );

    const records = (await readFile(join(session.runDir, "trace.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.find((record) => record.event === "enter" && record.fn === "bigintObjectPayload")?.args)
      .toEqual({ count: "3n" });
    expect(records.find((record) => record.event === "exit" && record.fn === "bigintObjectPayload")?.result)
      .toEqual({ count: "7n" });
  });

  it("keeps trace spans writable when payload access throws", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logging-"));
    const session = await Effect.runPromise(provideNode(createSession({ cwd: root, runsRoot: join(root, "runs") })));
    const throwingArgs: Record<string, unknown> = {};
    Object.defineProperty(throwingArgs, "secret", {
      enumerable: true,
      get: () => { throw new Error("args unavailable"); },
    });
    const throwingResult = new Proxy<Record<string, unknown>>({}, {
      ownKeys: () => { throw new Error("result unavailable"); },
    });

    await Effect.runPromise(
      TRACE(
        { module: "tests", file: "logging.test.ts", function: "throwingPayload" },
        Effect.succeed(throwingResult),
        throwingArgs,
      ).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ),
    );

    const traceRecords = (await readFile(join(session.runDir, "trace.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(traceRecords.find((record) => record.event === "enter" && record.fn === "throwingPayload")?.args)
      .toBe("[Value unavailable]");
    expect(traceRecords.find((record) => record.event === "exit" && record.fn === "throwingPayload")?.result)
      .toBe("[Value unavailable]");
  });

  it("keeps concurrent trace trees isolated by Effect fiber", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logging-"));
    const session = await Effect.runPromise(provideNode(createSession({ cwd: root, runsRoot: join(root, "runs") })));
    await Effect.runPromise(
      Effect.all([
        TRACE(
          { module: "tests", file: "logging.test.ts", function: "slow" },
          Effect.sleep("20 millis"),
        ),
        TRACE(
          { module: "tests", file: "logging.test.ts", function: "fast" },
          Effect.sleep("5 millis"),
        ),
      ], { concurrency: 2 }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ),
    );

    const traceRecords = (await readFile(join(session.runDir, "trace.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const enters = traceRecords.filter((record) => record.event === "enter" && ["slow", "fast"].includes(String(record.fn)));
    expect(enters).toHaveLength(2);
    expect(enters.every((record) => record.depth === 0 && record.parent_id === null)).toBe(true);
  });

  it("removes a span by id on out-of-order completion (not stack-top only)", async () => {
    // Regression for P1 #6: the old shared-stack design popped only the top
    // span, so a span completing out of order left a stale entry that later
    // spans inherited as a wrong parent/depth. The fix keys removal on spanId
    // (FiberRef + filter), so A exiting before its nested B must still leave C
    // parented to the still-open B at depth 1 — never a stale sp-1 at depth 0.
    root = await mkdtemp(join(tmpdir(), "piano-logging-"));
    const session = await Effect.runPromise(provideNode(createSession({ cwd: root, runsRoot: join(root, "runs") })));
    const { trace } = session;
    await Effect.runPromise(
      Effect.gen(function* () {
        const a = yield* trace.enter("outer", undefined, { module: "tests", file: "logging.test.ts" });
        const b = yield* trace.enter("inner", undefined, { module: "tests", file: "logging.test.ts" });
        // Out-of-order completion: A exits while B is still open beneath it.
        yield* trace.exit(a, "done-a");
        // C now enters on the same fiber; it must see B (depth 1), not a
        // leftover A (depth 0).
        const c = yield* trace.enter("after", undefined, { module: "tests", file: "logging.test.ts" });
        yield* trace.exit(c, undefined);
        yield* trace.exit(b, "done-b");
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ),
    );

    const traceRecords = (await readFile(join(session.runDir, "trace.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    const outerEnter = traceRecords.find((r) => r.event === "enter" && r.fn === "outer");
    const innerEnter = traceRecords.find((r) => r.event === "enter" && r.fn === "inner");
    const afterEnter = traceRecords.find((r) => r.event === "enter" && r.fn === "after");

    // B is the parent of C — proving A was really removed, not left as stale.
    expect(afterEnter?.depth).toBe(1);
    expect(afterEnter?.parent_id).toBe(innerEnter?.span_id);
    // A's own identity is intact (parent null, depth 0).
    expect(outerEnter?.depth).toBe(0);
    expect(outerEnter?.parent_id).toBeNull();
    // B was nested under A.
    expect(innerEnter?.depth).toBe(1);
    expect(innerEnter?.parent_id).toBe(outerEnter?.span_id);
  });
});
