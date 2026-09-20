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
  for (const harness of ["dsh", "claude"] as const satisfies readonly HarnessName[]) {
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
});
