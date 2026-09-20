import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import {
  executeSubprocessAgent,
  resolveHarnessConfig,
  prepareHarnessHomes,
  type AgentEvent,
  type HarnessName,
} from "../../packages/harness/src/index.js";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";

const runReal = process.env.PIANO_HARNESS_REAL_E2E === "1";
const realModel = process.env.PIANO_REAL_MODEL ?? "deepseek-v4-flash";
// A real tool turn can spend several minutes in provider-side queueing even
// when the health request is fast. Keep it bounded, but do not make the
// acceptance gate narrower than the observed native dsh latency.
const REAL_TASK_TIMEOUT_MS = 360_000;

async function filesUnder(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else files.push(relative(root, path));
    }
  };
  await visit(root);
  return files.sort();
}

describe.skipIf(!runReal)(" real subprocess harness acceptance", () => {
  for (const harness of ["dsh", "claude", "codex"] as const satisfies readonly HarnessName[]) {
    it(`${harness} completes the real artifact task with ${realModel}`, async () => {
      const workspace = await mkdtemp(join(tmpdir(), `piano-real-${harness}-workspace-`));
      const scopeRoot = await mkdtemp(join(tmpdir(), `piano-real-${harness}-scope-`));
      const evidenceRoot = await mkdtemp(join(tmpdir(), `piano-real-${harness}-evidence-`));
      const session = await Effect.runPromise(createSession({ cwd: workspace, root: evidenceRoot, runsRoot: join(evidenceRoot, "runs") }).pipe(
        Effect.provide(NodeFileSystem.layer),
      ));
      const events: AgentEvent[] = [];
      try {
        const config = { ...resolveHarnessConfig(harness), model: realModel };
        const result = await Effect.runPromise(prepareHarnessHomes({
          rootDir: scopeRoot,
          configs: { [harness]: config },
        }).pipe(Effect.flatMap((homes) => executeSubprocessAgent(harness, {
          cwd: workspace,
          prompt: "Use the write tool to create proof.txt with exactly OK followed by one newline. Then use the read tool to verify it and reply exactly OK. Do not use shell commands.",
          model: realModel,
          tools: ["read", "write"],
          signal: AbortSignal.timeout(REAL_TASK_TIMEOUT_MS),
          sessionDir: join(session.runDir, "e2e", harness),
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
        expect(result.text.trim()).not.toBe("");
        expect(result.text).toContain("OK");
        expect(await readFile(join(workspace, "proof.txt"), "utf8")).toBe("OK\n");
        expect(await filesUnder(workspace)).toEqual(["proof.txt"]);
        expect(events).toContainEqual(expect.objectContaining({ type: "done" }));
        expect(events.some((event) => event.type === "tool_execution_start")).toBe(true);
        expect(events.some((event) => event.type === "tool_execution_end")).toBe(true);
        const transcript = await readFile(result.transcriptPath, "utf8");
        expect(transcript.trim()).not.toBe("");
        expect(events.some((event) => event.type === "usage") || transcript.includes("usage")).toBe(true);
      } finally {
        await rm(workspace, { recursive: true, force: true });
        await rm(scopeRoot, { recursive: true, force: true });
        await rm(evidenceRoot, { recursive: true, force: true });
      }
    }, REAL_TASK_TIMEOUT_MS + 60_000);
  }

  // The acceptance above drives dsh once, with no continuation: it proves the
  // ordinary path still runs, on the shipped runner. This one proves the other
  // half — that a continued actor reopens its session — which no mock can,
  // because the resuming runner only exists inside the real launcher.
  //
  // tests/harness/dsh-resume-runner.test.ts asks the same question of the same
  // plugin in CI, with a fake agent that can only answer from the session it was
  // handed. This tier is the ground truth for that one: it is what shows the
  // fake's contract still matches the launcher's.
  it(`dsh recalls a previous turn with ${realModel}`, async () => {
    const workspace = await mkdtemp(join(tmpdir(), "piano-real-dsh-resume-workspace-"));
    const scopeRoot = await mkdtemp(join(tmpdir(), "piano-real-dsh-resume-scope-"));
    const evidenceRoot = await mkdtemp(join(tmpdir(), "piano-real-dsh-resume-evidence-"));
    const session = await Effect.runPromise(createSession({ cwd: workspace, root: evidenceRoot, runsRoot: join(evidenceRoot, "runs") }).pipe(
      Effect.provide(NodeFileSystem.layer),
    ));
    const config = { ...resolveHarnessConfig("dsh"), model: realModel };
    const seed = "BLUE-HARBOR-77";
    const turn = (prompt: string, continuation?: {
      readonly sessionId: string;
      readonly transcriptPath: string;
    }) =>
      Effect.runPromise(prepareHarnessHomes({
        rootDir: scopeRoot,
        configs: { dsh: config },
      }).pipe(Effect.flatMap((homes) => executeSubprocessAgent("dsh", {
        cwd: workspace,
        prompt,
        model: realModel,
        signal: AbortSignal.timeout(REAL_TASK_TIMEOUT_MS),
        sessionDir: join(session.runDir, "e2e", "dsh-resume"),
        ...(continuation === undefined ? {} : {
          continuation: {
            harness: "dsh",
            sessionId: continuation.sessionId,
            nativeSessionId: continuation.sessionId,
            transcriptPath: continuation.transcriptPath,
          },
        }),
      }, {
        ...(config.provider === undefined ? {} : { provider: config.provider }),
        model: realModel,
        ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
        ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
        ...(config.binPath === undefined ? {} : { binPath: config.binPath }),
        env: homes.env,
        retryDelaysMs: [],
      }))).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
    try {
      const first = await turn(`Please remember this code word: ${seed}. Reply with just: ok`);
      // Piano has to learn dsh's own session id, because that is the handle the
      // next epoch reopens. A Piano-minted id here would mean the resume path
      // never engages, and this test would pass while resuming nothing.
      expect(first.sessionId).toMatch(/^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      const second = await turn("What code word did I ask you to remember? Reply with the code word only.", {
        sessionId: first.sessionId,
        transcriptPath: first.transcriptPath,
      });

      // The answer can only come from the reopened conversation: the session
      // directory is shared, but the seed was never sent to this process.
      expect(second.text).toContain(seed);
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(scopeRoot, { recursive: true, force: true });
      await rm(evidenceRoot, { recursive: true, force: true });
    }
  }, REAL_TASK_TIMEOUT_MS * 2 + 60_000);
});
