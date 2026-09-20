// Tier: real e2e (gated: PIANO_HARNESS_REAL_E2E=1). True mid-turn steering
// through the real pi SDK + gateway model: a multi-tool-call turn is live, a
// steering message is pushed through the generic channel, and the model must
// honor it inside the SAME turn. Queue semantics (follow-up / next turn) would
// fail this assertion — the marker is asked for only via the steer, and the
// run ends with that one prompt.
import { Effect } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { describe, expect, it } from "vitest";
import { executeAgent, createSteeringChannel, resolveHarnessConfig, type AgentEvent } from "../../packages/harness/src/index.js";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";

const runReal = process.env.PIANO_HARNESS_REAL_E2E === "1";
const realModel = process.env.PIANO_REAL_MODEL ?? "deepseek-v4-flash";
const configPath = `${process.env.HOME}/.piano/agent.config.json`;

describe.skipIf(!runReal)(" real pi steering", () => {
  it("delivers a steer message into the live turn and the model honors it before finishing", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-real-steer-"));
    try {
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      // Same resolution path production uses — the pi registry's provider id
      // for the gateway model, never a guessed literal.
      const config = { ...resolveHarnessConfig("pi"), model: realModel };
      const channel = createSteeringChannel();
      const events: AgentEvent[] = [];
      // Several tool calls keep the turn open long enough to steer mid-loop.
      const run = executeAgent({
        cwd: root,
        prompt: "Run the bash tool `echo one`, then `echo two`, then `echo three`, then reply DONE.",
        tools: ["bash"],
        sessionDir: join(root, "sessions"),
        steering: channel,
        onEvent: (event) => events.push(event),
      }, {
        ...(config.provider === undefined ? {} : { provider: config.provider }),
        model: realModel,
        ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
        ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
        env: { PIANO_USER_AGENT_CONFIG: configPath },
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      );
      const running = Effect.runPromise(run);
      // Surface a failed run as the test's error instead of an unhandled
      // rejection outliving the assertion.
      const failed = running.catch((error: unknown) => {
        throw error instanceof Error ? error : new Error(String(error));
      });
      // Wait for the turn to be live (first tool call seen), then steer.
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline && !events.some((event) => event.type === "tool_execution_start")) {
        // A run that died before any tool call must fail fast, not wait out
        // the steering deadline on a session that never bound.
        await Promise.race([failed, new Promise((resolve) => setTimeout(resolve, 100))]);
      }
      const delivery = await channel.steer("Before replying DONE, append the exact token STEERED_OK to your final reply.");
      expect(delivery).toBe("delivered");
      const result = await failed;
      // Only a mid-turn delivery can put the marker in this turn's reply: the
      // prompt never mentions it and no second prompt was submitted.
      expect(result.text).toContain("STEERED_OK");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 300_000);
});
