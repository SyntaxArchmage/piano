import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { writeHandoffRecord } from "../../packages/orchestrator/src/handoff.js";
import {
  appendInvocationRecord,
  invocationStreamPath,
  parseInvocationRecords,
  type InvocationAcceptedRecord,
} from "../../packages/orchestrator/src/invocations.js";
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

  it("mirrors the acceptance onto the run's invocation stream, payload-free", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-handoff-stream-"));
    try {
      const resultPath = join(runDir, "attempts", "2", "result.json");
      await Effect.runPromise(writeHandoffRecord(runDir, invocation, {
        stage: "first",
        worker: "tune",
        text: "hello",
        sessionId: "session-1",
        transcriptPath: join(runDir, "transcript.jsonl"),
        attempt: 2,
        actorKey: "v2/exec-1/pi/tune/root",
        workspace: sharedWorkspaceBinding(runDir),
        resultPath,
        result: { path: resultPath, sha256: "sha256:abc", trust: "worker" },
        resultPayload: { wide: "payload that must not be copied" },
      }).pipe(Effect.provide(NodeFileSystem.layer)));

      const rows = parseInvocationRecords(await readFile(invocationStreamPath(runDir), "utf8"));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        version: 1,
        kind: "invocation-accepted",
        runId: "exec-1",
        jobOrdinal: 1,
        invocationId: "first@root",
        stageId: "first",
        stage: "first",
        worker: "tune",
        attempt: 2,
        actorKey: "v2/exec-1/pi/tune/root",
        sessionId: "session-1",
        result: { path: resultPath, sha256: "sha256:abc", trust: "worker" },
      });
      // The payload lives in its result file behind the sha256 pin, and a
      // stream has no path back to the legacy record document: neither is
      // copied into the row.
      expect(rows[0]).not.toHaveProperty("resultPayload");
      expect(rows[0]).not.toHaveProperty("recordPath");
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
});

describe("invocation stream", () => {
  const acceptedRow = JSON.stringify({
    version: 1,
    kind: "invocation-accepted",
    timestamp: "2026-10-20T00:00:00.000Z",
    runId: "exec-1",
    jobOrdinal: 1,
    invocationId: "first@root",
    stageId: "first",
    stage: "first",
    worker: "tune",
    sessionId: "session-1",
    transcriptPath: "/tmp/transcript.jsonl",
    text: "hi",
    workspace: { key: "shared", cwd: "/tmp/workspace", kind: "shared" },
  });

  it("keeps accepted rows and drops torn, shapeless and unknown ones", () => {
    const rows = parseInvocationRecords([
      acceptedRow,
      "not json",
      JSON.stringify({ version: 1, kind: "from-a-newer-build", timestamp: "2026-10-20T00:00:00.000Z", runId: "exec-1" }),
      JSON.stringify({ no: "identity" }),
      acceptedRow.slice(0, 20),
      "",
    ].join("\n"));
    expect(rows.map((row) => row.invocationId)).toEqual(["first@root"]);
  });

  it("refuses to write a row carrying an undeclared top-level field", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-invocations-strict-"));
    try {
      const row = JSON.parse(acceptedRow) as InvocationAcceptedRecord;
      const exit = await Effect.runPromiseExit(
        appendInvocationRecord(runDir, { ...row, stray: true } as InvocationAcceptedRecord)
          .pipe(Effect.provide(NodeFileSystem.layer)),
      );
      expect(exit._tag).toBe("Failure");
      await expect(readFile(invocationStreamPath(runDir), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
});
