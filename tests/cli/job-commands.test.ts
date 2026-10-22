// /continue and /restart resolve from the run's status: the one lifecycle
// every module reads. The job table supplies the input and the cursor, never a
// second legality answer. A paused run resumes its latest job; /restart re-runs
// the latest input and hands the engine the ordinal to close in the same state
// transition. One run has at most one unfinished job and it is the latest, so
// an older paused job is never offered. Refusals say what is missing instead
// of running the wrong thing.
import { describe, expect, it } from "vitest";
import type { WorkflowTransition } from "@piano/orchestrator";
import { foldStatus } from "../common/status-fold.js";
import {
  jobCommandAllowed,
  resolveContinueCommand,
  resolveRestartCommand,
} from "../../packages/cli/src/job-commands.js";

const started = (
  jobOrdinal: number,
  timestamp: string,
  prompt?: string,
): WorkflowTransition => ({
  kind: "execution-started",
  timestamp,
  runId: "run-1",
  jobOrdinal,
  ...(prompt === undefined ? {} : { prompt }),
  resumed: false,
  plan: { plannedStages: 2, stageCounts: {} },
});

const accepted = (timestamp: string, invocationId: string, attempt = 1): WorkflowTransition =>
  ({ kind: "stage-accepted", timestamp, runId: "run-1", invocationId, attempt } as unknown as WorkflowTransition);

const finished = (
  timestamp: string,
  status: "completed" | "failed" | "paused",
): WorkflowTransition => ({
  kind: "execution-finished",
  timestamp,
  runId: "run-1",
  status,
});

const T = (second: number): string => `2026-10-14T00:00:${String(second).padStart(2, "0")}.000Z`;

/** The run's state document, folded from the same records a writer folds. */
const statusOf = (...records: WorkflowTransition[]) => foldStatus(records);

/** Job 1 finished, job 2 paused — the only shape a live run reaches. */
const PAUSED_LATEST = statusOf(
  started(1, T(0), "first input"),
  accepted(T(1), "first@root"),
  finished(T(2), "completed"),
  started(2, T(3), "second input"),
  accepted(T(4), "first@root"),
  finished(T(5), "paused"),
);

/** A newer job started while an older one stayed paused. The invariant forbids
 * creating this, but a document written before it can still hold the shape:
 * the status comes from the latest start/finish, so the old pause is retired. */
const RETIRED_PAUSED = statusOf(
  started(1, T(0), "retired input"),
  finished(T(1), "paused"),
  started(2, T(2), "latest input"),
  finished(T(3), "completed"),
);

/** A paused job followed by the start of a running prompt. */
const ALIVE_LATEST = statusOf(
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
    const done = statusOf(started(1, T(0), "only input"), accepted(T(1), "first@root"), finished(T(2), "completed"));
    expect(resolveContinueCommand(done)).toEqual({
      kind: "refused",
      reason: "no paused job to continue",
    });
    expect(resolveContinueCommand(statusOf(started(1, T(0)), finished(T(1), "paused")))).toEqual({
      kind: "refused",
      reason: "the paused job's input is not recorded",
    });
  });
});

describe("jobCommandAllowed", () => {
  it("allows /continue only on a paused run", () => {
    expect(jobCommandAllowed("continue", "paused")).toBe(true);
    for (const status of ["running", "completed", "failed", "cancelled", undefined] as const) {
      expect(jobCommandAllowed("continue", status)).toBe(false);
    }
  });

  it("allows /restart only once a run has stopped with a job to re-run", () => {
    for (const status of ["paused", "completed", "failed"] as const) {
      expect(jobCommandAllowed("restart", status)).toBe(true);
    }
    // No run at all (a fresh session), a live one, and a legacy cancelled
    // document with no job are not restart targets.
    for (const status of ["running", "cancelled", undefined] as const) {
      expect(jobCommandAllowed("restart", status)).toBe(false);
    }
  });
});

describe("resolveRestartCommand", () => {
  it("marks the paused job for the restart transition and re-runs its input", () => {
    const paused = statusOf(started(1, T(0), "the input"), accepted(T(1), "first@root"), finished(T(2), "paused"));
    expect(resolveRestartCommand(paused)).toEqual({
      kind: "run",
      command: { input: "the input", restartOrdinal: 1 },
    });
  });

  it("re-runs a finished job without closing anything", () => {
    const done = statusOf(started(1, T(0), "the input"), finished(T(1), "completed"));
    expect(resolveRestartCommand(done)).toEqual({
      kind: "run",
      command: { input: "the input" },
    });
  });

  it("refuses while the run is live, and when nothing was ever run", () => {
    expect(resolveRestartCommand(ALIVE_LATEST)).toEqual({
      kind: "refused",
      reason: "a job is running; interrupt it first",
    });
    expect(resolveRestartCommand(undefined)).toEqual({
      kind: "refused",
      reason: "this run has no job to restart",
    });
  });
});
