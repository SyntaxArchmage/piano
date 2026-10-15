// Tier: real e2e (gated: PIANO_HARNESS_REAL_E2E=1). The pi subprocess adapter's
// steering over the real pi CLI RPC protocol: the task is a `prompt` frame, a
// mid-turn injection is a `steer` frame, and — verified on the installed CLI —
// every frame is answered with a `type:"response"` carrying its id back. The
// contract being pinned is the one a wire write cannot prove: delivery is
// reported on that answer (never at the pipe write), the answer is claimed by
// the broker (never leaked as run output), and the steer joins the running
// turn's conversation.
//
// The model is the one the developer configured (`resolveHarnessConfig`), with
// PIANO_REAL_MODEL as an explicit one-off override. Assertions here are
// protocol-level and model-independent; whether the model *obeys* the steer is
// the SDK steering e2e's question (real-pi-steering.e2e.test.ts).
import { Effect } from "effect";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { describe, expect, it } from "vitest";
import {
  createSteeringChannel,
  executeSubprocessAgent,
  prepareHarnessHomes,
  resolveHarnessConfig,
  type AgentEvent,
  type SteerDelivery,
} from "../../packages/harness/src/index.js";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";

const runReal = process.env.PIANO_HARNESS_REAL_E2E === "1";
const realModel = process.env.PIANO_REAL_MODEL ?? resolveHarnessConfig("pi").model;
const REAL_TASK_TIMEOUT_MS = 360_000;

describe.skipIf(!runReal)(" real pi RPC steering (subprocess adapter)", () => {
  it(`reports a mid-turn steer on pi's own answer, with ${realModel}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-real-pi-rpc-steer-"));
    try {
      const session = await Effect.runPromise(createSession({ cwd: root, root: join(root, "evidence"), runsRoot: join(root, "evidence", "runs") }).pipe(
        Effect.provide(NodeFileSystem.layer),
      ));
      const config = { ...resolveHarnessConfig("pi"), model: realModel };
      const homes = await Effect.runPromise(prepareHarnessHomes({ rootDir: join(root, "harness"), configs: { pi: config } }).pipe(
        Effect.provide(NodeFileSystem.layer),
      ));
      const channel = createSteeringChannel();
      const events: AgentEvent[] = [];
      let steerPromise: Promise<SteerDelivery> | undefined;
      const result = await Effect.runPromise(executeSubprocessAgent("pi", {
        cwd: root,
        // Several tool calls keep the turn open long enough to steer mid-loop.
        prompt: "Run the bash tool `echo one`, then the bash tool `echo two`, then reply with exactly DONE.",
        tools: ["bash"],
        sessionDir: join(root, "sessions"),
        steering: channel,
        signal: AbortSignal.timeout(REAL_TASK_TIMEOUT_MS),
        onEvent: (event) => {
          events.push(event);
          if ((event.type === "tool_execution_start" || event.type === "message_start") && steerPromise === undefined) {
            steerPromise = channel.steer("STEER-MARK-1: also run `echo steered` and mention STEER-MARK-1 in your final answer.");
            steerPromise.catch(() => undefined);
          }
        },
      }, {
        ...(config.provider === undefined ? {} : { provider: config.provider }),
        model: realModel,
        ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
        ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
        ...(config.binPath === undefined ? {} : { binPath: config.binPath }),
        env: homes.env,
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));

      // Delivery is reported on pi's answer to the frame, not at the pipe
      // write: the promise resolves, and the answer it resolved on is claimed
      // rather than surfacing as an unrecognized record.
      expect(steerPromise).toBeDefined();
      await expect(steerPromise).resolves.toBe("delivered");
      expect(events.some((event) => event.type === "unknown" && event.sourceType === "response")).toBe(false);
      // The steer joined the running turn's conversation — the protocol's job,
      // independent of whether the model then obeys it.
      const messages = (await readFile(result.transcriptPath, "utf8"))
        .trimEnd().split("\n").map((line) => JSON.parse(line) as { message?: { role?: string; content?: string } });
      // The steer joined the running turn's conversation — the protocol's
      // job, independent of whether the model then obeys it. Content is
      // message parts (real pi), so match on the serialized form.
      expect(messages.some((entry) => entry.message?.role === "user"
        && JSON.stringify(entry.message.content).includes("STEER-MARK-1"))).toBe(true);
      expect(events.some((event) => event.type === "done")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, REAL_TASK_TIMEOUT_MS + 60_000);
});
