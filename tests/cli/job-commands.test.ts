// /continue and /restart resolve from the run's state document: the latest
// paused job resumes from its cursor; the latest job's input runs again,
// closing a paused job first. The input comes from the job itself — the
// document records it with the job — so turn positions are never consulted.
// One run has at most one unfinished job and it is the latest, so an older
// paused job is never offered. Refusals say what is missing instead of running
// the wrong thing.
import { describe, expect, it } from "vitest";
import type {
  RunJob,
  WorkflowProgressStreamRecord,
} from "@piano/orchestrator";
import { foldStatus } from "../common/status-fold.js";
import {
  resolveContinueCommand,
  resolveRestartCommand,
} from "../../packages/cli/src/job-commands.js";

const started = (
  jobOrdinal: number,
  timestamp: string,
  prompt?: string,
): WorkflowProgressStreamRecord => ({
  version: 1,
  kind: "execution-started",
  timestamp,
  runId: "run-1",
  jobOrdinal,
  ...(prompt === undefined ? {} : { prompt }),
  resumed: false,
  plan: { plannedStages: 2, stageCounts: {} },
});

const accepted = (timestamp: string, invocationId: string, attempt = 1): WorkflowProgressStreamRecord =>
  ({ version: 1, timestamp, runId: "run-1", invocationId, attempt } as unknown as WorkflowProgressStreamRecord);

const finished = (
  timestamp: string,
  status: "completed" | "failed" | "paused",
): WorkflowProgressStreamRecord => ({
  version: 1,
  kind: "execution-finished",
  timestamp,
  runId: "run-1",
  status,
});

const T = (second: number): string => `2026-10-14T00:00:${String(second).padStart(2, "0")}.000Z`;

/** The jobs the run's state document holds — the shapes a `/continue` reads
 * after a JSON round trip, not the in-memory sets and maps behind them. */
const jobList = (...records: WorkflowProgressStreamRecord[]): readonly RunJob[] =>
  foldStatus(records)?.jobs ?? [];

/** Job 1 finished, job 2 paused — the only shape a live run reaches. */
const PAUSED_LATEST = jobList(
  started(1, T(0), "first input"),
  accepted(T(1), "first@root"),
  finished(T(2), "completed"),
  started(2, T(3), "second input"),
  accepted(T(4), "first@root"),
  finished(T(5), "paused"),
);

/** Legacy evidence: a newer job started while an older one stayed paused. The
 * invariant forbids creating this, but a document written before it can still
 * hold the shape, so the resolver must never fall back to the old job. */
const RETIRED_PAUSED = jobList(
  started(1, T(0), "retired input"),
  finished(T(1), "paused"),
  started(2, T(2), "latest input"),
  finished(T(3), "completed"),
);

/** A paused job followed by the alive job of a running prompt. */
const ALIVE_LATEST = jobList(
  started(1, T(0), "first input"),
  finished(T(1), "paused"),
  started(2, T(2), "second input"),
);

describe("resolveContinueCommand", () => {
  it("resumes the latest paused job from its cursor", () => {
    const resolved = resolveContinueCommand(PAUSED_LATEST);
    expect(resolved).toEqual({
      kind: "run",
      command: {
        input: "second input",
        jobOrdinal: 2,
        accepted: new Set(["first@root"]),
        attempts: new Map([["first@root", 1]]),
      },
    });
  });

  it("never falls back to an older paused job", () => {
    expect(resolveContinueCommand(RETIRED_PAUSED)).toEqual({
      kind: "refused",
      reason: "no paused job to continue",
    });
  });

  it("refuses when nothing is paused, and when the job's input is not recorded", () => {
    const done = jobList(started(1, T(0), "only input"), accepted(T(1), "first@root"), finished(T(2), "completed"));
    expect(resolveContinueCommand(done)).toEqual({
      kind: "refused",
      reason: "no paused job to continue",
    });
    expect(resolveContinueCommand(jobList(started(1, T(0)), finished(T(1), "paused")))).toEqual({
      kind: "refused",
      reason: "the paused job's input is not recorded",
    });
  });
});

describe("resolveRestartCommand", () => {
  it("closes the latest paused job and re-runs its input", () => {
    const paused = jobList(started(1, T(0), "the input"), accepted(T(1), "first@root"), finished(T(2), "paused"));
    expect(resolveRestartCommand(paused)).toEqual({
      kind: "run",
      command: { input: "the input", closeOrdinal: 1 },
    });
  });

  it("re-runs a finished job without closing anything", () => {
    const done = jobList(started(1, T(0), "the input"), finished(T(1), "completed"));
    expect(resolveRestartCommand(done)).toEqual({
      kind: "run",
      command: { input: "the input" },
    });
  });

  it("refuses while a job is alive, and when nothing was ever run", () => {
    expect(resolveRestartCommand(ALIVE_LATEST)).toEqual({
      kind: "refused",
      reason: "a job is running; interrupt it first",
    });
    expect(resolveRestartCommand([])).toEqual({
      kind: "refused",
      reason: "this run has no job to restart",
    });
  });
});
