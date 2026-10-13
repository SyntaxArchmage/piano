// Tier: real e2e (gated: PIANO_HARNESS_REAL_E2E=1). Claude steering over the
// real CLI in streaming-input mode: with tool calls running, a user frame
// written to stdin reaches the model within the same turn at the next tool
// boundary (documented v2.1 stream-json semantics). The marker token is
// reachable ONLY through that injection: the task never mentions it and no
// second turn is submitted — the run's single prompt ends at the first
// `result` frame, which also winds the child down.
import { Effect } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
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
} from "../../packages/harness/src/index.js";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";

const runReal = process.env.PIANO_HARNESS_REAL_E2E === "1";
// The LLM service is the one the developer configured: the model resolves
// through the same path a real mission uses, never a literal this file
// guesses. PIANO_REAL_MODEL stays as an explicit one-off override.
const realModel = process.env.PIANO_REAL_MODEL ?? resolveHarnessConfig("claude").model;
const REAL_TASK_TIMEOUT_MS = 360_000;

describe.skipIf(!runReal)(" real claude steering", () => {
  it("delivers a steer frame into the live Claude turn and the model honors it before finishing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "piano-real-claude-steer-workspace-"));
    const scopeRoot = await mkdtemp(join(tmpdir(), "piano-real-claude-steer-scope-"));
    const evidenceRoot = await mkdtemp(join(tmpdir(), "piano-real-claude-steer-evidence-"));
    try {
      const session = await Effect.runPromise(createSession({
        cwd: workspace, root: evidenceRoot, runsRoot: join(evidenceRoot, "runs"),
      }).pipe(Effect.provide(NodeFileSystem.layer)));
      const channel = createSteeringChannel();
      const events: AgentEvent[] = [];
      const config = { ...resolveHarnessConfig("claude"), model: realModel };
      const running = Effect.runPromise(prepareHarnessHomes({
        rootDir: scopeRoot,
        configs: { claude: config },
      }).pipe(Effect.flatMap((homes) => executeSubprocessAgent("claude", {
        cwd: workspace,
        // Three tool calls keep the turn open for a real mid-turn injection.
        prompt: "Use the bash tool to run `echo one`, then `echo two`, then `echo three`. Then reply DONE.",
        model: realModel,
        tools: ["bash"],
        signal: AbortSignal.timeout(REAL_TASK_TIMEOUT_MS),
        sessionDir: join(session.runDir, "e2e", "claude-steer"),
        steering: channel,
        onEvent: (event) => events.push(event),
      }, {
        ...(config.provider === undefined ? {} : { provider: config.provider }),
        model: realModel,
        ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
        ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
        ...(config.authToken === undefined ? {} : { authToken: config.authToken }),
        ...(config.binPath === undefined ? {} : { binPath: config.binPath }),
        env: homes.env,
        retryDelaysMs: [],
      }))).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      // Wait for the turn to be live inside its tool loop, then steer.
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline
        && !events.some((event) => event.type === "tool_execution_end" && event.toolCallId !== undefined)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const delivery = await channel.steer("When you finish, reply DONE followed by the exact token STEERED_OK on the same line.");
      expect(delivery).toBe("delivered");
      const result = await running;
      expect(result.text).toContain("STEERED_OK");
      expect(events).toContainEqual(expect.objectContaining({ type: "done" }));
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(scopeRoot, { recursive: true, force: true });
      await rm(evidenceRoot, { recursive: true, force: true });
    }
  }, REAL_TASK_TIMEOUT_MS + 60_000);
});
