// A run whose actor table was written before actors were keyed by worker
// resumes the same conversation: the legacy stage-keyed entry is rewritten at
// seeding, the stage looks its actor up under the worker key, and the next
// persisted table carries the new key. Silently starting a fresh chat here
// would lose the earlier turn's memory — the exact thing worker-keyed actors
// exist to preserve.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { readResumeActors } from "../common/fs.js";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";
import {
  executeWorkflow,
  loadWorkflow,
  type WorkflowExecutionContinuation,
} from "../../packages/orchestrator/src/index.js";
import type {
  AgentContinuation,
  AgentRequest,
  AgentResult,
  AgentRunner,
} from "../../packages/harness/src/index.js";

const WORKFLOW = `version: 3
workflow:
  name: legacy-actor
  nodes:
    - stage:
        name: respond
        worker: basic
        harness: pi
        from: []
`;

const LEGACY_CONTINUATION: AgentContinuation = {
  harness: "pi",
  sessionId: "sess-legacy",
  transcriptPath: "/runs/legacy/sess-legacy.jsonl",
};

describe("a legacy stage-keyed actor continues under the worker key", () => {
  it("resumes the conversation and persists the v2 key", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-actor-migration-"));
    try {
      await writeFile(join(root, "workflow.yml"), WORKFLOW, "utf8");
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const seen: Array<AgentContinuation | undefined> = [];
      const runner: AgentRunner = (request: AgentRequest) => {
        seen.push(request.continuation);
        return Effect.succeed<AgentResult>({
          sessionId: "sess-new",
          transcriptPath: "/runs/new/sess-new.jsonl",
          text: "done",
          continuation: { harness: "pi", sessionId: "sess-new", transcriptPath: "/runs/new/sess-new.jsonl" },
        });
      };
      const legacyActors = new Map([[
        `${session.id}/pi/respond/root`,
        {
          turns: 1,
          harness: "pi",
          sessionId: LEGACY_CONTINUATION.sessionId,
          transcriptPath: LEGACY_CONTINUATION.transcriptPath,
          continuation: LEGACY_CONTINUATION,
        },
      ]]) as WorkflowExecutionContinuation["actors"];
      const execution: WorkflowExecutionContinuation = { id: session.id, jobOrdinal: 1, actors: legacyActors };
      await Effect.runPromise(
        loadWorkflow(join(root, "workflow.yml"), root).pipe(
          Effect.flatMap((loaded) => executeWorkflow(loaded, {
            runDir: session.runDir,
            cwd: root,
            prompt: "keep going",
            runId: session.id,
            execution,
            agentRunner: runner,
          })),
          Effect.provideService(Logging, loggingService(session.log, session.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );

      // The harness turn resumed the legacy conversation...
      expect(seen).toHaveLength(1);
      expect(seen[0]?.sessionId).toBe("sess-legacy");
      // ...and the persisted table carries the worker key, not the stage key.
      const keys = Object.keys(await readResumeActors(session.runDir));
      expect(keys).toContain(`v2/${session.id}/pi/basic/root`);
      expect(keys.some((key) => key.includes("/respond/"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
