import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { writeHandoffRecord, readHandoffRecord } from "../../packages/orchestrator/src/handoff.js";
import {
  appendInvocationRecord,
  invocationResultPath,
  invocationStreamPath,
  parseInvocationRecords,
  recordInvocationStart,
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
  it("records the acceptance on the run's invocation stream, payload-free", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-handoff-stream-"));
    try {
      const resultPath = invocationResultPath(runDir, "inv-0001", 2);
      await Effect.runPromise(writeHandoffRecord(runDir, invocation, {
        ref: "inv-0001",
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
        ref: "inv-0001",
        invocationId: "first@root",
        stageId: "first",
        stage: "first",
        worker: "tune",
        attempt: 2,
        actorKey: "v2/exec-1/pi/tune/root",
        sessionId: "session-1",
        result: { path: resultPath, sha256: "sha256:abc", trust: "worker" },
      });
      // The payload lives in its result file behind the sha256 pin, and the
      // legacy per-invocation tree is retired: the stream is the only home the
      // acceptance gets.
      expect(rows[0]).not.toHaveProperty("resultPayload");
      expect(rows[0]).not.toHaveProperty("recordPath");
      await expect(readdir(runDir)).resolves.not.toContain("prompts");
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("rebuilds a producer from its stream row alone, verifying the pinned result", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-handoff-rebuild-"));
    try {
      const resultPath = invocationResultPath(runDir, "inv-0001", 2);
      await mkdir(join(resultPath, ".."), { recursive: true });
      await writeFile(resultPath, `{"answer":42}\n`);
      const sha256 = `sha256:${createHash("sha256").update(`{"answer":42}\n`).digest("hex")}`;
      await Effect.runPromise(writeHandoffRecord(runDir, invocation, {
        ref: "inv-0001",
        stage: "first",
        worker: "tune",
        text: "hello",
        sessionId: "session-1",
        transcriptPath: join(runDir, "transcript.jsonl"),
        attempt: 2,
        workspace: sharedWorkspaceBinding(runDir),
        resultPath,
        result: { path: resultPath, sha256, trust: "worker" },
        resultPayload: { answer: 42 },
      }).pipe(Effect.provide(NodeFileSystem.layer)));

      const rebuilt = await Effect.runPromise(
        readHandoffRecord(runDir, invocation).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      expect(rebuilt).toMatchObject({
        id: "first@root",
        stageId: "first",
        ref: "inv-0001",
        attempt: 2,
        result: { path: resultPath, sha256, trust: "worker" },
        resultPayload: { answer: 42 },
      });

      // Evidence that drifted from its pin is not evidence: the rebuild
      // declines and the caller re-runs the stage.
      await writeFile(resultPath, `{"answer":7}\n`);
      await expect(Effect.runPromise(
        readHandoffRecord(runDir, invocation).pipe(Effect.provide(NodeFileSystem.layer)),
      )).resolves.toBeUndefined();
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
    ref: "inv-0001",
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

  it("allocates one flat name per (job, invocation) and reuses it", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-invocations-ref-"));
    try {
      const identity = {
        runId: "exec-1",
        jobOrdinal: 1,
        invocationId: "first@root",
        stageId: "first",
      };
      const start = (extra: { jobOrdinal?: number; attempt?: number } = {}) =>
        Effect.runPromise(
          recordInvocationStart(runDir, { ...identity, ...extra }).pipe(Effect.provide(NodeFileSystem.layer)),
        );
      expect(await start()).toBe("inv-0001");
      // A later attempt of the same invocation publishes under the name the
      // first start allocated.
      expect(await start({ attempt: 2 })).toBe("inv-0001");
      // A `/restart`'s new job gets its own name instead of overwriting the
      // abandoned job's files.
      expect(await start({ jobOrdinal: 2 })).toBe("inv-0002");
      const rows = parseInvocationRecords(await readFile(invocationStreamPath(runDir), "utf8"));
      expect(rows.map((row) => [row.kind, row.jobOrdinal, row.ref])).toEqual([
        ["invocation-started", 1, "inv-0001"],
        ["invocation-started", 2, "inv-0002"],
      ]);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
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
