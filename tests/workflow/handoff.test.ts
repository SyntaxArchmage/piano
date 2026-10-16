import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { writeHandoffRecord } from "../../packages/orchestrator/src/handoff.js";
import { sharedWorkspaceBinding } from "../../packages/orchestrator/src/workspace.js";
import type { WorkflowRuntimeInvocation } from "../../packages/orchestrator/src/workflow-runtime.js";

const invocation: WorkflowRuntimeInvocation = {
  runId: "exec-1",
  jobOrdinal: 1,
  stageId: "first",
  stageName: "first",
  frames: [],
};

describe("handoff record", () => {
  /** The record is evidence a later resume reads back, so its bytes are a
   * contract: two-space JSON with a trailing newline, under the invocation
   * directory. Pinned here ahead of the write path being shared with the other
   * atomic writers. */
  it("lands under the invocation directory as two-space JSON with a trailing newline", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-handoff-bytes-"));
    try {
      const record = await Effect.runPromise(writeHandoffRecord(runDir, invocation, {
        stage: "first",
        worker: "tune",
        text: "hello",
        sessionId: "session-1",
        transcriptPath: join(runDir, "transcript.jsonl"),
        workspace: sharedWorkspaceBinding(runDir),
      }).pipe(Effect.provide(NodeFileSystem.layer)));

      expect(record.recordPath).toBe(join(runDir, "prompts", "1", "invocations", "first", "root", "handoff", "record.json"));
      const raw = await readFile(record.recordPath, "utf8");
      expect(raw).toBe(`${JSON.stringify({ version: 1, producer: record }, null, 2)}\n`);
      expect(JSON.parse(raw)).toMatchObject({
        version: 1,
        producer: {
          id: "first@root",
          stageId: "first",
          stage: "first",
          worker: "tune",
          text: "hello",
          recordPath: record.recordPath,
        },
      });
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
});
