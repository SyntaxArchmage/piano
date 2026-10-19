import { Cause, Effect, Exit, Option } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentError,
  executeSubprocessAgent,
  withAgentRetries,
  withFailedContinuation,
  AGENT_RETRY_DELAYS_MS,
  type AgentContinuation,
  type AgentRetryNotice,
} from "../../packages/harness/src/index.js";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";

const RESULT = { sessionId: "session", transcriptPath: "/tmp/session.jsonl", text: "ok" } as const;

type TestSession = Awaited<ReturnType<typeof makeSession>>;

async function makeSession(root: string) {
  const session = await Effect.runPromise(
    createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
  return session;
}

function run<A, E, R>(session: TestSession, effect: Effect.Effect<A, E, R>) {
  return Effect.runPromiseExit(
    effect.pipe(
      Effect.provideService(Logging, loggingService(session.log, session.trace)),
      Effect.provide(NodeFileSystem.layer),
    ) as unknown as Effect.Effect<A, E>,
  );
}

describe("agent retry boundary", () => {
  it("keeps the hardcoded reliability floor at two retries with escalating backoff", () => {
    expect(AGENT_RETRY_DELAYS_MS).toEqual([5_000, 20_000]);
  });

  it("retries each retryable kind and succeeds on a later attempt", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-retry-kinds-"));
    try {
      const session = await makeSession(root);
      for (const kind of ["rate-limit", "timeout", "harness-unavailable", "request-rejected"] as const) {
        let calls = 0;
        const exit = await run(session, withAgentRetries(
          () => {
            calls += 1;
            return calls < 3
              ? Effect.fail(new AgentError({ kind, message: `${kind} failure` }))
              : Effect.succeed({ result: RESULT });
          },
          [1, 1],
        ));
        expect(Exit.isSuccess(exit), kind).toBe(true);
        expect(calls, kind).toBe(3);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("notifies the caller of scheduled retries and the eventual recovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-retry-notices-"));
    try {
      const session = await makeSession(root);
      const notices: AgentRetryNotice[] = [];
      let calls = 0;
      const exit = await run(session, withAgentRetries(
        () => {
          calls += 1;
          return calls < 3
            ? Effect.fail(new AgentError({ kind: "harness-unavailable", message: "502 status code (no body)" }))
            : Effect.succeed({ result: RESULT });
        },
        [1, 1],
        undefined,
        (notice) => { notices.push(notice); },
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(calls).toBe(3);
      expect(notices).toEqual([
        {
          event: "scheduled",
          attempt: 1,
          nextAttempt: 2,
          totalAttempts: 3,
          delayMs: 1,
          errorType: "harness-unavailable",
          message: "502 status code (no body)",
        },
        {
          event: "scheduled",
          attempt: 2,
          nextAttempt: 3,
          totalAttempts: 3,
          delayMs: 1,
          errorType: "harness-unavailable",
          message: "502 status code (no body)",
        },
        { event: "recovered", attempt: 3, totalAttempts: 3 },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stays silent when the first attempt succeeds and on permanent failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-retry-notice-silence-"));
    try {
      const session = await makeSession(root);
      const notices: AgentRetryNotice[] = [];
      const success = await run(session, withAgentRetries(
        () => Effect.succeed({ result: RESULT }),
        [1, 1],
        undefined,
        (notice) => { notices.push(notice); },
      ));
      expect(Exit.isSuccess(success)).toBe(true);
      const permanent = await run(session, withAgentRetries(
        () => Effect.fail(new AgentError({ kind: "authentication", message: "401 status code (no body)" })),
        [1, 1],
        undefined,
        (notice) => { notices.push(notice); },
      ));
      expect(Exit.isFailure(permanent)).toBe(true);
      expect(notices).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails immediately on non-retryable kinds", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-retry-permanent-"));
    try {
      const session = await makeSession(root);
      const kinds = [
        "cancelled",
        "authentication",
        "configuration",
        "model-not-found",
        "sdk-discovery",
        "sdk-unavailable",
        "sdk-load",
        "session-artifact",
        "resource-unavailable",
        "unknown",
      ] as const;
      for (const kind of kinds) {
        let calls = 0;
        const exit = await run(session, withAgentRetries(
          () => {
            calls += 1;
            return Effect.fail(new AgentError({ kind, message: `${kind} failure` }));
          },
          [1, 1],
        ));
        expect(Exit.isFailure(exit), kind).toBe(true);
        expect(calls, kind).toBe(1);
        if (Exit.isFailure(exit)) {
          const failure = Cause.failureOption(exit.cause);
          expect(Option.isSome(failure), kind).toBe(true);
          if (Option.isSome(failure)) {
            expect((failure.value as AgentError).kind, kind).toBe(kind);
          }
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("surfaces the original error after the budget is exhausted", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-retry-exhausted-"));
    try {
      const session = await makeSession(root);
      let calls = 0;
      const original = new AgentError({ kind: "rate-limit", message: "persistent rate limit" });
      const exit = await run(session, withAgentRetries(
        () => {
          calls += 1;
          return Effect.fail(original);
        },
        [1, 1],
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(calls).toBe(3);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) expect(failure.value).toBe(original);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("carries the failed attempt's continuation into the retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-retry-continuation-"));
    try {
      const session = await makeSession(root);
      const observed: Array<{ attempt: number; continuation?: AgentContinuation }> = [];
      const failedContinuation: AgentContinuation = {
        harness: "pi",
        sessionId: "first-session",
        transcriptPath: "/tmp/first.jsonl",
      };
      const exit = await run(session, withAgentRetries(
        (attempt) => {
          observed.push({ attempt: attempt.attempt, continuation: attempt.continuation });
          return attempt.attempt === 0
            ? Effect.fail(withFailedContinuation(
              new AgentError({ kind: "timeout", message: "timed out" }),
              failedContinuation,
            ))
            : Effect.succeed({ result: { ...RESULT, continuation: failedContinuation } });
        },
        [1, 1],
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.result.continuation).toMatchObject({ sessionId: "first-session" });
      }
      // The retry (attempt 1) receives the failed attempt's continuation.
      expect(observed).toEqual([
        { attempt: 0, continuation: undefined },
        { attempt: 1, continuation: failedContinuation },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retries without a continuation when the failure predates the session", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-retry-no-session-"));
    try {
      const session = await makeSession(root);
      const observed: Array<{ attempt: number; continuation?: AgentContinuation }> = [];
      const exit = await run(session, withAgentRetries(
        (attempt) => {
          observed.push({ attempt: attempt.attempt, continuation: attempt.continuation });
          return attempt.attempt === 0
            ? Effect.fail(new AgentError({ kind: "harness-unavailable", message: "spawn failed" }))
            : Effect.succeed({ result: RESULT });
        },
        [1, 1],
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(observed).toEqual([
        { attempt: 0, continuation: undefined },
        { attempt: 1, continuation: undefined },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("cancels during backoff when the abort signal fires", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-retry-cancel-"));
    try {
      const session = await makeSession(root);
      const controller = new AbortController();
      const pending = run(session, withAgentRetries(
        () => Effect.fail(new AgentError({ kind: "rate-limit", message: "rate limited" })),
        [60_000],
        controller.signal,
      ));
      setTimeout(() => controller.abort(), 20);
      const exit = await pending;
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) {
          const error = failure.value as AgentError;
          expect(error).toBeInstanceOf(AgentError);
          expect(error.kind).toBe("cancelled");
          expect(error.message).toBe("agent retry cancelled during backoff");
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not retry after the signal aborted, surfacing the attempt error", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-retry-cancel-fast-"));
    try {
      const session = await makeSession(root);
      const controller = new AbortController();
      controller.abort();
      let calls = 0;
      const exit = await run(session, withAgentRetries(
        () => {
          calls += 1;
          return Effect.fail(new AgentError({ kind: "rate-limit", message: "rate limited" }));
        },
        [1, 1],
        controller.signal,
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(calls).toBe(1);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) expect((failure.value as AgentError).kind).toBe("rate-limit");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("logs each retry decision as structured evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-retry-log-"));
    try {
      const session = await makeSession(root);
      let calls = 0;
      const exit = await run(session, withAgentRetries(
        () => {
          calls += 1;
          return calls < 2
            ? Effect.fail(new AgentError({ kind: "rate-limit", message: "limited" }))
            : Effect.succeed({ result: RESULT });
        },
        [1, 1],
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      const log = await readFile(join(session.runDir, "system-log", "log.jsonl"), "utf8");
      expect(log).toContain('"event":"agent.retry.scheduled"');
      expect(log).toContain('"kind":"rate-limit"');
      expect(log).toContain('"nextAttempt":2');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("subprocess retry integration", () => {
  it("retries a non-zero subprocess exit and reopens the same transcript", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-retry-subprocess-"));
    try {
      const session = await makeSession(root);
      const binPath = join(root, "flaky-harness.sh");
      const marker = join(root, "started");
      // First invocation exits 3 and creates the marker; every later
      // invocation takes the success branch. The adapter's own retry loop
      // therefore drives the recovery inside one executeSubprocessAgent call.
      await writeFile(binPath, `#!/bin/sh
printf '%s\\n' '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"partial"}}'
if [ ! -f "${marker}" ]; then
  printf '%s\\n' 'boom' >&2
  printf '%s\\n' 'first' > "${marker}"
  exit 3
fi
printf '%s\\n' '{"type":"agent_start"}'
printf '%s\\n' '{"type":"result","result":"recovered","session_id":"flaky-session","usage":{"total_tokens":1}}'
`);
      await chmod(binPath, 0o755);
      const exit = await run(session, executeSubprocessAgent("pi", {
        cwd: root,
        prompt: "hello",
        sessionDir: join(session.runDir, "subprocess-sessions"),
      }, { binPath, retryDelaysMs: [10, 10] }));
      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.text).toBe("recovered");
        const transcript = await readFile(exit.value.transcriptPath, "utf8");
        // The failed attempt's partial frame and the retry's result share
        // one transcript file, proving the continuation reopened it.
        expect(transcript).toContain("partial");
        expect(transcript).toContain("recovered");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes the pi --session flag when retrying with a continuation", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-retry-subprocess-session-"));
    try {
      const session = await makeSession(root);
      const binPath = join(root, "echo-harness.sh");
      await writeFile(binPath, `#!/bin/sh
printf '%s\\n' "$*" >&2
printf '%s\\n' '{"type":"result","result":"ok","session_id":"echo-session"}'
`);
      await chmod(binPath, 0o755);
      const stderrText: string[] = [];
      const exit = await run(session, executeSubprocessAgent("pi", {
        cwd: root,
        prompt: "hello",
        sessionDir: join(session.runDir, "subprocess-sessions"),
        continuation: { harness: "pi", sessionId: "prior", transcriptPath: "/tmp/prior.jsonl" },
        onEvent: (event) => {
          if (event.type === "unknown" && event.sourceType === "stderr") {
            stderrText.push(String((event.data as { text?: string }).text ?? ""));
          }
        },
      }, { binPath, retryDelaysMs: [10, 10] }));
      expect(Exit.isSuccess(exit)).toBe(true);
      // The continuation's transcript path is passed via --session on the
      // child command line, visible in the echoed argument list on stderr.
      expect(stderrText.join("\n")).toContain("--session");
      expect(stderrText.join("\n")).toContain("/tmp/prior.jsonl");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
