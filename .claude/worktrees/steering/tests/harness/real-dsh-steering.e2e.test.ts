// Tier: real e2e (gated: PIANO_HARNESS_REAL_E2E=1). dsh steering through Piano's
// resume runner: a steer frame written to the child's stdin while the turn is
// live is delivered by the runner as a user interjection (`Agent.steer`) into
// that same turn. The marker token is reachable ONLY through that injection:
// the task never mentions it and no second turn is submitted — the run's
// single task ends when the runner's first answer is printed.
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
const realModel = process.env.PIANO_REAL_MODEL ?? "deepseek-v4-flash";
const REAL_TASK_TIMEOUT_MS = 360_000;

describe.skipIf(!runReal)(" real dsh steering", () => {
  it("delivers a steer frame into the live dsh turn and the model honors it before finishing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "piano-real-dsh-steer-workspace-"));
    const scopeRoot = await mkdtemp(join(tmpdir(), "piano-real-dsh-steer-scope-"));
    const evidenceRoot = await mkdtemp(join(tmpdir(), "piano-real-dsh-steer-evidence-"));
    try {
      const session = await Effect.runPromise(createSession({
        cwd: workspace, root: evidenceRoot, runsRoot: join(evidenceRoot, "runs"),
      }).pipe(Effect.provide(NodeFileSystem.layer)));
      const channel = createSteeringChannel();
      const events: AgentEvent[] = [];
      const config = { ...resolveHarnessConfig("dsh"), model: realModel };
      const running = Effect.runPromise(prepareHarnessHomes({
        rootDir: scopeRoot,
        configs: { dsh: config },
      }).pipe(Effect.flatMap((homes) => executeSubprocessAgent("dsh", {
        cwd: workspace,
        // A turn long enough that a real mid-turn injection has somewhere to
        // land: the model is still composing when the steer arrives. No tool
        // here — headless dsh gates the shell tool on an approval no one can
        // give it, and the turn then never ends (the sibling subprocess e2e
        // bans shell commands for the same reason).
        prompt: "List the integers from 1 to 120 in order, one per line, each followed by a two-word phrase. Do not skip any. Reply with nothing else.",
        model: realModel,
        signal: AbortSignal.timeout(REAL_TASK_TIMEOUT_MS),
        sessionDir: join(session.runDir, "e2e", "dsh-steer"),
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
      // dsh's native stdout is not framed like claude's stream-json, so the
      // observable that the steering window is open is the runner's own
      // handshake: it notes `steering ready` on stderr the moment the reader
      // is attached, and the adapter reports stderr one line at a time while
      // the turn runs. A frame written after this line is either live or
      // buffered into the turn about to arm — never lost to the
      // initialization window. (The earlier observable keyed on `resumed `,
      // which only exists when the run continues a session; this one is a
      // first turn, and real-e2e is what surfaced that.)
      const turnLive = (): boolean => events.some((event) => {
        if (event.type !== "unknown") return false;
        const data = event.data as { readonly text?: unknown } | undefined;
        return typeof data?.text === "string" && data.text.includes("steering ready");
      });
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline && !turnLive()) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(turnLive(), "the dsh turn never reported itself live").toBe(true);
      const delivery = await channel.steer("When you finish, reply DONE followed by the exact token STEERED_OK on the same line.");
      expect(delivery).toBe("delivered");
      const result = await running;
      expect(result.text).toContain("STEERED_OK");
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(scopeRoot, { recursive: true, force: true });
      await rm(evidenceRoot, { recursive: true, force: true });
    }
  }, REAL_TASK_TIMEOUT_MS + 60_000);
});
