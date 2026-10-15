import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeStaticObservability,
  formatStaticObservabilityReport,
  inspectStaticObservability,
} from "../../packages/logging/src/index.js";

const runId = "run-static-1";
const traceId = "trace-static-1";

function validArtifacts(transcriptPath: string) {
  const timestamp = "2026-08-25T00:00:00.000Z";
  return {
    log: [
      { timestamp, run_id: runId, trace_id: traceId, event: "function.enter", span_id: "sp-1" },
      { timestamp, run_id: runId, trace_id: traceId, event: "function.exit", span_id: "sp-1" },
    ].map((record) => JSON.stringify(record)).join("\n") + "\n",
    trace: [
      { timestamp, run_id: runId, trace_id: traceId, seq: 1, depth: 0, span_id: "sp-1", parent_id: null, event: "enter", fn: "work" },
      { timestamp, run_id: runId, trace_id: traceId, seq: 2, depth: 0, span_id: "sp-1", parent_id: null, event: "exit", fn: "work", status: "ok", ok: true, duration_ms: 1 },
    ].map((record) => JSON.stringify(record)).join("\n") + "\n",
    trajectory: JSON.stringify({
      version: 1,
      runId,
      timestamp: "2026-08-25T00:00:00.000Z",
      status: "completed",
      promptLength: 4,
      events: [{ type: "done" }],
      transcriptPath,
    }) + "\n",
    progress: JSON.stringify({
      version: 1,
      timestamp,
      runId: "execution-1",
      invocationId: "respond@root",
      stageId: "respond",
      stage: "respond",
      worker: "basic",
      attempt: 1,
      workspace: { key: "shared", cwd: "/tmp/workspace", kind: "shared" },
      sessionId: "session-1",
      transcriptPath,
      handoffRecordPath: "handoffs/records/respond/root/record.json",
    }) + "\n",
    status: JSON.stringify({
      version: 1,
      updatedAt: timestamp,
      runId: "execution-1",
      status: "completed",
      plannedStages: 1,
      completedStages: 1,
      acceptedStages: 1,
      remainingStages: 0,
      stageCounts: { respond: { planned: 1, completed: 1 } },
    }) + "\n",
  };
}

function pinnedResult(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function handoffRecord(resultPath: string, sha256: string): string {
  // Only `producer.result` is read by the reference check; the rest of the
  // producer is the acceptance the orchestrator writes around it.
  return JSON.stringify({
    version: 1,
    producer: { id: "respond@root", result: { path: resultPath, sha256, trust: "worker" } },
  });
}

describe(" static observability analysis", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it("passes a complete log/trace/trajectory/progress/transcript evidence set", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-static-analysis-"));
    const runDir = join(root, runId);
    const transcriptPath = join(runDir, "transcript.jsonl");
    await mkdir(runDir, { recursive: true });
    const artifacts = validArtifacts(transcriptPath);
    await Promise.all([
      writeFile(join(runDir, "log.jsonl"), artifacts.log, "utf8"),
      writeFile(join(runDir, "trace.jsonl"), artifacts.trace, "utf8"),
      writeFile(join(runDir, "trajectory.jsonl"), artifacts.trajectory, "utf8"),
      writeFile(join(runDir, "progress.jsonl"), artifacts.progress, "utf8"),
      writeFile(join(runDir, "status.json"), artifacts.status, "utf8"),
      writeFile(transcriptPath, [
        JSON.stringify({ type: "message", message: { role: "user", content: "work" } }),
        JSON.stringify({ type: "message", message: { role: "assistant", content: "done" } }),
        "",
      ].join("\n"), "utf8"),
    ]);

    const report = await Effect.runPromise(inspectStaticObservability(runDir).pipe(
      Effect.provide(NodeFileSystem.layer),
    ));
    expect(report).toMatchObject({
      runId,
      valid: true,
      logRecordCount: 2,
      traceRecordCount: 2,
      progressRecordCount: 1,
      transcriptPaths: [transcriptPath],
      issues: [],
    });
    expect(formatStaticObservabilityReport(report)).toContain(`OBSERVABILITY PASS: ${runId}`);
  });

  it("accepts the non-acceptance records the progress stream carries", () => {
    // progress.jsonl used to hold accepted stages and nothing else, so every
    // line was validated as one. It now also carries a run's start, its stage
    // starts and its end — records that hold none of an acceptance's fields,
    // and that a checker reading them as acceptances would call invalid on
    // every run this build writes.
    const transcriptPath = "/tmp/static-stream-records.jsonl";
    const accepted = {
      version: 1,
      timestamp: "2026-08-25T00:00:00.000Z",
      runId: "execution-1",
      invocationId: "respond@root",
      stageId: "respond",
      stage: "respond",
      worker: "basic",
      attempt: 1,
      workspace: { key: "shared", cwd: "/tmp/workspace", kind: "shared" },
      sessionId: "session-1",
      transcriptPath,
      handoffRecordPath: "handoffs/records/respond/root/record.json",
    };
    const records = [
      { version: 1, kind: "execution-started", timestamp: "2026-08-25T00:00:00.000Z", runId: "execution-1", resumed: false, plan: { plannedStages: 1, stageCounts: {} } },
      { version: 1, kind: "stage-started", timestamp: "2026-08-25T00:00:01.000Z", runId: "execution-1", invocationId: "respond@root", stageId: "respond", stage: "respond", worker: "basic", attempt: 1 },
      accepted,
      { version: 1, kind: "execution-finished", timestamp: "2026-08-25T00:00:02.000Z", runId: "execution-1", status: "completed" },
    ];

    const report = analyzeStaticObservability({
      runDir: `/tmp/${runId}`,
      log: "",
      trace: "",
      trajectory: JSON.stringify({
        version: 1,
        runId,
        updatedAt: "2026-08-25T00:00:02.000Z",
        status: "completed",
        promptLength: 4,
        events: [],
        transcriptPath,
      }),
      progress: `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      transcripts: { [transcriptPath]: "" },
    });

    expect(report.issues.filter((issue) => issue.code === "invalid-record")).toEqual([]);
  });

  it("reports cross-file identity, trace balance, and transcript failures", () => {
    const transcriptPath = "/tmp/missing-static-transcript.jsonl";
    const report = analyzeStaticObservability({
      runDir: `/tmp/${runId}`,
      log: JSON.stringify({ timestamp: "2026-08-25T00:00:00.000Z", run_id: "other-run", trace_id: "trace-a", event: "function.enter", span_id: "sp-missing" }) + "\n",
      trace: [
        { timestamp: "2026-08-25T00:00:00.000Z", run_id: runId, trace_id: "trace-b", seq: 1, depth: 1, span_id: "sp-1", parent_id: "sp-parent", event: "enter", fn: "work" },
        { timestamp: "2026-08-25T00:00:00.000Z", run_id: runId, trace_id: "trace-b", seq: 2, depth: 0, span_id: "sp-2", parent_id: null, event: "exit", fn: "other", ok: true, duration_ms: 1 },
      ].map((record) => JSON.stringify(record)).join("\n") + "\n",
      trajectory: JSON.stringify({
        version: 1,
        runId,
        status: "completed",
        transcriptPath,
      }),
      transcripts: {},
    });
    const codes = report.issues.map((issue) => issue.code);
    expect(report.valid).toBe(false);
    expect(codes).toEqual(expect.arrayContaining([
      "run-id-mismatch",
      "trace-id-mismatch",
      "trace-parent-missing",
      "trace-span-unmatched",
      "trace-span-open",
      "log-span-missing",
      "transcript-missing",
    ]));
  });

  it("accepts compact JSONL and rejects malformed JSONL records", () => {
    const report = analyzeStaticObservability({
      runDir: `/tmp/${runId}`,
      log: "not-json\n",
      trace: "{}\n",
      trajectory: "not-json\n",
    });
    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "invalid-jsonl",
      "invalid-record",
      "invalid-json",
    ]));
  });

  it("checks trace sequence and closing span fields", () => {
    const report = analyzeStaticObservability({
      runDir: `/tmp/${runId}`,
      log: JSON.stringify({ timestamp: "2026-08-25T00:00:00.000Z", run_id: runId, trace_id: traceId, event: "function.enter", span_id: "sp-1" }) + "\n",
      trace: [
        { timestamp: "2026-08-25T00:00:00.000Z", run_id: runId, trace_id: traceId, seq: 2, depth: 0, span_id: "sp-1", parent_id: null, event: "enter", fn: "work" },
        { timestamp: "2026-08-25T00:00:00.000Z", run_id: runId, trace_id: traceId, seq: 3, depth: 1, span_id: "sp-1", parent_id: null, event: "exit", fn: "other", ok: true, duration_ms: 1 },
      ].map((record) => JSON.stringify(record)).join("\n") + "\n",
      trajectory: JSON.stringify({
        version: 1,
        runId,
        updatedAt: "2026-08-25T00:00:00.000Z",
        status: "completed",
        promptLength: 0,
        events: [],
      }),
    });
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "trace-sequence",
      "trace-span-mismatch",
    ]));
  });

  it("rejects an unsafe progress iteration", () => {
    const artifacts = validArtifacts("/tmp/progress-iteration-transcript.jsonl");
    const progress = JSON.parse(artifacts.progress) as Record<string, unknown>;
    progress.iteration = Number.MAX_SAFE_INTEGER + 1;
    const report = analyzeStaticObservability({
      runDir: `/tmp/${runId}`,
      log: artifacts.log,
      trace: artifacts.trace,
      trajectory: artifacts.trajectory,
      progress: `${JSON.stringify(progress)}\n`,
      transcripts: { "/tmp/progress-iteration-transcript.jsonl": "{}\n" },
    });
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "invalid-record",
      message: expect.stringContaining("iteration"),
    }));
  });

  it("runs through the Effect filesystem boundary", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-static-analysis-"));
    const report = await Effect.runPromise(inspectStaticObservability(join(root, runId)).pipe(
      Effect.provide(NodeFileSystem.layer),
    ));
    expect(report.valid).toBe(false);
    expect(report.issues.filter((issue) => issue.code === "missing-file")).toHaveLength(3);
  });

  it("reports ref-missing when a handoff's pinned result file is gone", () => {
    const resultPath = "/tmp/static-pinned-result.json";
    const report = analyzeStaticObservability({
      runDir: `/tmp/${runId}`,
      handoffRecords: {
        "/tmp/static-handoff/record.json": handoffRecord(resultPath, pinnedResult('{"ok":true}\n')),
      },
      results: {},
    });
    const refCodes = report.issues.map((issue) => issue.code).filter((code) => code.startsWith("ref-"));
    expect(refCodes).toEqual(["ref-missing"]);
  });

  it("reports ref-mismatch when a handoff's pinned result bytes changed", () => {
    const resultPath = "/tmp/static-pinned-result.json";
    const report = analyzeStaticObservability({
      runDir: `/tmp/${runId}`,
      handoffRecords: {
        "/tmp/static-handoff/record.json": handoffRecord(resultPath, pinnedResult('{"ok":true}\n')),
      },
      results: { [resultPath]: '{"ok":false}\n' },
    });
    const refCodes = report.issues.map((issue) => issue.code).filter((code) => code.startsWith("ref-"));
    expect(refCodes).toEqual(["ref-mismatch"]);
  });

  it("checks the result file the progress stream's handoff record pins", async () => {
    // The reference check is only useful if the reader finds the records the
    // run actually wrote: the stream names each handoff record, and that record
    // pins the published result file by content.
    root = await mkdtemp(join(tmpdir(), "piano-static-analysis-"));
    const runDir = join(root, runId);
    const transcriptPath = join(runDir, "transcript.jsonl");
    const handoffPath = join(runDir, "prompts", "1", "invocations", "respond", "root", "handoff", "record.json");
    const resultPath = join(runDir, "prompts", "1", "invocations", "respond", "root", "attempts", "1", "result.json");
    const resultBytes = '{"ok":true}\n';
    await mkdir(join(runDir, "prompts", "1", "invocations", "respond", "root", "handoff"), { recursive: true });
    await mkdir(join(runDir, "prompts", "1", "invocations", "respond", "root", "attempts", "1"), { recursive: true });
    const artifacts = validArtifacts(transcriptPath);
    const accepted = JSON.parse(artifacts.progress) as Record<string, unknown>;
    accepted.handoffRecordPath = handoffPath;
    await Promise.all([
      writeFile(join(runDir, "log.jsonl"), artifacts.log, "utf8"),
      writeFile(join(runDir, "trace.jsonl"), artifacts.trace, "utf8"),
      writeFile(join(runDir, "trajectory.jsonl"), artifacts.trajectory, "utf8"),
      writeFile(join(runDir, "progress.jsonl"), `${JSON.stringify(accepted)}\n`, "utf8"),
      writeFile(join(runDir, "status.json"), artifacts.status, "utf8"),
      writeFile(transcriptPath, JSON.stringify({ type: "message", message: { role: "user", content: "work" } }) + "\n", "utf8"),
      writeFile(handoffPath, handoffRecord(resultPath, pinnedResult(resultBytes)), "utf8"),
      writeFile(resultPath, resultBytes, "utf8"),
    ]);

    const pass = await Effect.runPromise(inspectStaticObservability(runDir).pipe(
      Effect.provide(NodeFileSystem.layer),
    ));
    expect(pass.handoffRecordPaths).toEqual([handoffPath]);
    expect(pass.issues).toEqual([]);

    await writeFile(resultPath, '{"ok":false}\n', "utf8");
    const fail = await Effect.runPromise(inspectStaticObservability(runDir).pipe(
      Effect.provide(NodeFileSystem.layer),
    ));
    expect(fail.issues.map((issue) => issue.code)).toEqual(["ref-mismatch"]);
    expect(fail.valid).toBe(false);
  });
});
