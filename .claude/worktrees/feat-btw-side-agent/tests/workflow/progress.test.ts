import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendWorkflowProgress,
  workflowProgressSnapshotPath,
  type WorkflowProgressRecord,
} from "../../packages/orchestrator/src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function record(overrides: Partial<WorkflowProgressRecord> = {}): Omit<WorkflowProgressRecord, "version" | "timestamp"> {
  return {
    executionId: "execution",
    invocationId: "measure",
    stageId: "measure",
    stage: "measure",
    worker: "legacy-worker",
    attempt: 1,
    workspace: { key: "shared-root", cwd: "/workspace", kind: "shared" },
    actorKey: "measure",
    harness: "pi",
    sessionId: "session",
    transcriptPath: "/tmp/transcript.jsonl",
    handoffRecordPath: "/tmp/handoff.json",
    ...overrides,
  };
}

async function appendAndRead(recordValue: Omit<WorkflowProgressRecord, "version" | "timestamp">) {
  const runDir = await mkdtemp(join(tmpdir(), "piano-progress-"));
  roots.push(runDir);
  await Effect.runPromise(appendWorkflowProgress(runDir, recordValue).pipe(Effect.provide(NodeContext.layer)));
  return JSON.parse(await readFile(workflowProgressSnapshotPath(runDir), "utf8")) as {
    latest?: { decision?: string; benchmark?: unknown; projections?: unknown };
  };
}

describe("workflow progress compatibility", () => {
  it("retains legacy payload hints when no projection or contract metadata exists", async () => {
    const snapshot = await appendAndRead(record({
      resultPayload: { decision: "KEEP", benchmark: { best: 12 } },
    }));

    expect(snapshot.latest).toMatchObject({ decision: "KEEP", benchmark: { best: 12 } });
    expect(snapshot.latest?.projections).toBeUndefined();
  });

  it("does not infer canonical hints from undeclared payload fields", async () => {
    const snapshot = await appendAndRead(record({
      resultPayload: { decision: "KEEP", benchmark: { best: 12 } },
      contract: {
        id: "canonical-result",
        version: 1,
        digest: "a".repeat(64),
        snapshotPath: "/tmp/contract.json",
      },
    }));

    expect(snapshot.latest?.decision).toBeUndefined();
    expect(snapshot.latest?.benchmark).toBeUndefined();
  });

  it("uses explicit projections instead of similarly named payload fields", async () => {
    const projections = [
      { id: "round.decision", pointer: "/verdict", format: "string" as const, value: "DISCARD" },
      { id: "benchmark.evidence", pointer: "/metric", format: "json" as const, value: { best: 7 } },
    ];
    const snapshot = await appendAndRead(record({
      resultPayload: { decision: "KEEP", benchmark: { best: 12 } },
      projections,
    }));

    expect(snapshot.latest).toMatchObject({
      decision: "DISCARD",
      benchmark: { best: 7 },
      projections,
    });
  });
});
