// A job is one prompt's workflow execution, folded from the stream: the spans
// it ran in, the invocations it accepted, and the outcome it ended with. These
// tests pin the fold's rules, including streams that predate jobs (every span
// its own job) and a paused job whose continue repeats its ordinal.
import { describe, expect, it } from "vitest";
import {
  foldJobSpans,
  jobs,
  latestJob,
  type WorkflowProgressExecutionStartRecord,
  type WorkflowProgressStreamRecord,
} from "../../packages/orchestrator/src/index.js";

const started = (jobOrdinal: number | undefined, timestamp: string): WorkflowProgressExecutionStartRecord => ({
  version: 1,
  kind: "execution-started",
  timestamp,
  executionId: "run-1",
  ...(jobOrdinal === undefined ? {} : { jobOrdinal }),
  resumed: false,
  plan: { plannedStages: 2, stageCounts: {} },
});

const stageStarted = (timestamp: string, invocationId: string): WorkflowProgressStreamRecord => ({
  version: 1,
  kind: "stage-started",
  timestamp,
  executionId: "run-1",
  invocationId,
  stageId: invocationId.split("@")[0] ?? invocationId,
  stage: invocationId,
  worker: "basic",
  attempt: 1,
});

/** Only the fields the fold reads; the full accepted shape belongs to writers. */
const accepted = (timestamp: string, invocationId: string): WorkflowProgressStreamRecord =>
  ({ version: 1, timestamp, executionId: "run-1", invocationId } as unknown as WorkflowProgressStreamRecord);

const finished = (
  timestamp: string,
  status: "completed" | "failed" | "paused",
): WorkflowProgressStreamRecord => ({
  version: 1,
  kind: "execution-finished",
  timestamp,
  executionId: "run-1",
  status,
});

const T = (second: number): string => `2026-10-14T00:00:${String(second).padStart(2, "0")}.000Z`;

describe("foldJobSpans", () => {
  it("groups spans by the ordinal their execution-started records carry", () => {
    const spans = foldJobSpans([
      started(1, T(0)),
      accepted(T(1), "first@root"),
      finished(T(2), "completed"),
      started(2, T(3)),
      accepted(T(4), "first@root"),
      accepted(T(5), "second@root"),
      finished(T(6), "completed"),
    ]);
    expect(spans.map((span) => [span.jobOrdinal, span.status, [...span.accepted]])).toEqual([
      [1, "completed", ["first@root"]],
      [2, "completed", ["first@root", "second@root"]],
    ]);
  });

  it("merges a paused job's continue span under the same ordinal", () => {
    const spans = foldJobSpans([
      started(1, T(0)),
      accepted(T(1), "first@root"),
      stageStarted(T(2), "second@root"),
      finished(T(3), "paused"),
      started(1, T(4)),
      accepted(T(5), "second@root"),
      finished(T(6), "completed"),
    ]);
    const [only] = jobs(spans);
    expect(jobs(spans)).toHaveLength(1);
    expect(only?.state).toBe("finished");
    expect(only?.outcome).toBe("completed");
    expect([...(only?.accepted ?? [])].sort()).toEqual(["first@root", "second@root"]);
  });

  it("treats a span without an ordinal as a new job (streams written before jobs)", () => {
    const spans = foldJobSpans([
      started(undefined, T(0)),
      accepted(T(1), "first@root"),
      finished(T(2), "completed"),
      started(undefined, T(3)),
      finished(T(4), "failed"),
    ]);
    expect(spans.map((span) => span.jobOrdinal)).toEqual([1, 2]);
    expect(latestJob(spans)?.outcome).toBe("failed");
  });

  it("tracks the in-flight invocation until its acceptance arrives", () => {
    const spans = foldJobSpans([
      started(1, T(0)),
      stageStarted(T(1), "first@root"),
      stageStarted(T(2), "second@root"),
      accepted(T(3), "second@root"),
    ]);
    expect(spans[0]?.inFlight).toBeUndefined();
    expect(spans[0]?.status).toBe("running");
    expect(latestJob(spans)?.state).toBe("alive");
  });

  it("reads a stream with no execution markers as holding no jobs", () => {
    const spans = foldJobSpans([
      accepted(T(0), "first@root"),
      stageStarted(T(1), "second@root"),
    ]);
    expect(spans).toEqual([]);
    expect(latestJob(spans)).toBeUndefined();
  });

  it("reports a trailing span with no finish as alive", () => {
    const spans = foldJobSpans([
      started(1, T(0)),
      accepted(T(1), "first@root"),
      finished(T(2), "completed"),
      started(2, T(3)),
      stageStarted(T(4), "first@root"),
    ]);
    const view = latestJob(spans);
    expect(view?.jobOrdinal).toBe(2);
    expect(view?.state).toBe("alive");
    expect(view?.outcome).toBeUndefined();
  });
});
