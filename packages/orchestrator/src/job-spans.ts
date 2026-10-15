// Folding the progress stream into jobs.
//
// A job is one prompt's workflow execution. The stream marks where it begins
// with an `execution-started` record carrying the job's ordinal; each run
// interval of that job is one span between an `execution-started` and its
// `execution-finished` (or the stream's end, while it is still running). A
// paused job that continues opens another span under the same ordinal, and
// that repeated ordinal is what ties the spans to one job.
//
// Nothing here is stored: a job's state and its cursor — the invocation set a
// continue may skip — are folded from the append-only stream, the same records
// every other view reads.

import {
  progressRecordKind,
  type WorkflowProgressExecutionFinishRecord,
  type WorkflowProgressExecutionStartRecord,
  type WorkflowProgressJobClosedRecord,
  type WorkflowProgressRecord,
  type WorkflowProgressRegionFinalizedRecord,
  type WorkflowProgressStartRecord,
  type WorkflowProgressStreamRecord,
} from "./progress.js";

/** One run interval of a job. */
export interface JobSpan {
  readonly jobOrdinal: number;
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly status: "running" | "completed" | "failed" | "paused";
  /** Invocation ids accepted during this span. */
  readonly accepted: ReadonlySet<string>;
  /** Highest attempt number recorded per invocation in this span. */
  readonly attempts: ReadonlyMap<string, number>;
  /** The input the job runs, when the stream recorded it. */
  readonly input?: string;
  /** The invocation whose latest attempt started and has not been accepted in
   * this span, when one is in flight. */
  readonly inFlight?: string;
  /** Set on the span in flight when the human closed the job by their own
   * action (`/restart`). The span's own status still says how it stopped
   * running; this is the job-level outcome on top of it. */
  readonly closed?: "restarted";
  /** Every region that exited during this span, keyed by its runtime instance
   * (`<frames>/<regionId>`). A continue reads these to skip a region instead
   * of re-running its workers. */
  readonly regions?: ReadonlyMap<string, WorkflowProgressRegionFinalizedRecord>;
}

/** One job across all of its spans. */
export interface JobView {
  readonly jobOrdinal: number;
  readonly runId: string;
  /** `alive` while the last span runs; `paused` after a human stop; `finished`
   * once a span closed with an outcome. */
  readonly state: "alive" | "paused" | "finished";
  /** Present only when `state` is `finished`. */
  readonly outcome?: "completed" | "failed" | "restarted";
  /** Invocation ids accepted across every span of this job — the set a
   * continue of this job skips. */
  readonly accepted: ReadonlySet<string>;
  /** Highest attempt number recorded per invocation across the job's spans,
   * so a continue's re-run follows the attempts already on disk. */
  readonly attempts: ReadonlyMap<string, number>;
  /** The input the job runs, read from its spans; `undefined` for streams
   * written before the input was kept with the job. */
  readonly input?: string;
  /** Region exits across the job's spans, later rows winning per instance. */
  readonly regions: ReadonlyMap<string, WorkflowProgressRegionFinalizedRecord>;
  readonly spans: readonly JobSpan[];
}

interface MutableSpan {
  jobOrdinal: number;
  runId: string;
  startedAt: string;
  finishedAt?: string;
  status: JobSpan["status"];
  accepted: Set<string>;
  attempts: Map<string, number>;
  inFlight?: string;
  closed?: "restarted";
  input?: string;
  regions: Map<string, WorkflowProgressRegionFinalizedRecord>;
}

/** Fold a run's stream records into their job spans, in stream order.
 *
 * Records before the first `execution-started` (a stream written before the
 * markers existed, or a torn head) contribute no span; a reader therefore
 * offers no cursor for such a run, which is the safe answer — nothing to skip. */
export function foldJobSpans(records: readonly WorkflowProgressStreamRecord[]): readonly JobSpan[] {
  const spans: MutableSpan[] = [];
  for (const record of records) {
    const kind = progressRecordKind(record);
    // A kind this fold does not know: no span semantics to apply. Skipping is
    // the only safe reading — the historical shape would count it as an
    // accepted stage and corrupt the cursor a continue skips by.
    if (kind === undefined) continue;
    if (kind === "execution-started") {
      const started = record as WorkflowProgressExecutionStartRecord;
      spans.push({
        // A span that does not name its job is a new one: streams written
        // before continues existed held no other kind of span.
        jobOrdinal: started.jobOrdinal ?? (spans.at(-1)?.jobOrdinal ?? 0) + 1,
        runId: started.runId,
        startedAt: started.timestamp,
        status: "running",
        accepted: new Set(),
        attempts: new Map(),
        regions: new Map(),
        ...(started.prompt === undefined ? {} : { input: started.prompt }),
      });
      continue;
    }
    const span = spans.at(-1);
    if (span === undefined) continue;
    if (kind === "stage-started") {
      const startedRecord = record as WorkflowProgressStartRecord;
      span.inFlight = startedRecord.invocationId;
      recordAttempt(span, startedRecord.invocationId, startedRecord.attempt);
    } else if (kind === "stage-accepted") {
      const acceptedRecord = record as WorkflowProgressRecord;
      span.accepted.add(acceptedRecord.invocationId);
      recordAttempt(span, acceptedRecord.invocationId, acceptedRecord.attempt);
      // The in-flight attempt was accepted; a later stage-started for the same
      // invocation sets the flag again.
      if (span.inFlight === acceptedRecord.invocationId) delete span.inFlight;
    } else if (kind === "execution-finished") {
      const finished = record as WorkflowProgressExecutionFinishRecord;
      span.status = finished.status;
      span.finishedAt = finished.timestamp;
    } else if (kind === "region-finalized") {
      const finalized = record as WorkflowProgressRegionFinalizedRecord;
      // The record names its job; later rows win per instance, so a region
      // re-entered and finalized again after a continue updates its entry.
      const owner = spans.find((candidate) => candidate.jobOrdinal === finalized.jobOrdinal) ?? span;
      owner.regions.set(finalized.instance, finalized);
    } else if (kind === "actor-turn") {
      // An actor's conversation state is not job-span state: it says nothing
      // about which stages this job accepted or is running. Its own fold
      // (`foldActorTurns`) reads it.
      continue;
    } else {
      // A close names its job explicitly, and the job it closes is not
      // necessarily the latest one: a restart closes the paused job it
      // replaces.
      const closed = record as WorkflowProgressJobClosedRecord;
      for (let index = spans.length - 1; index >= 0; index -= 1) {
        const target = spans[index];
        if (target !== undefined && target.jobOrdinal === closed.jobOrdinal) {
          target.closed = closed.outcome;
          break;
        }
      }
    }
  }
  return spans;
}

/** Keep the highest attempt number seen for one invocation: attempts grow, and
 * a continue seeds its next attempt from the highest the job recorded. A line
 * without a usable number is skipped rather than poisoning the map. */
function recordAttempt(span: MutableSpan, invocationId: string, attempt: unknown): void {
  if (typeof attempt !== "number" || !Number.isFinite(attempt)) return;
  span.attempts.set(invocationId, Math.max(span.attempts.get(invocationId) ?? 0, attempt));
}

/** Every job in the stream, oldest first. */
export function jobs(spans: readonly JobSpan[]): readonly JobView[] {
  const order: number[] = [];
  const byOrdinal = new Map<number, JobSpan[]>();
  for (const span of spans) {
    const group = byOrdinal.get(span.jobOrdinal);
    if (group === undefined) {
      order.push(span.jobOrdinal);
      byOrdinal.set(span.jobOrdinal, [span]);
    } else {
      group.push(span);
    }
  }
  return order.map((ordinal) => jobView(ordinal, byOrdinal.get(ordinal) ?? []));
}

/** The newest job, or `undefined` for a stream that holds none. */
export function latestJob(spans: readonly JobSpan[]): JobView | undefined {
  return jobs(spans).at(-1);
}

/** One past the highest job ordinal the run's own evidence already records:
 * the ledger's spans and the `prompts/<n>` trees, with a caller's hint (the
 * resume state) as a floor only. A stale or missing hint therefore cannot
 * reopen an ordinal that has already been written. */
export function nextJobOrdinal(
  spans: readonly JobSpan[],
  promptOrdinals: readonly number[],
  hint?: number,
): number {
  return Math.max(0, hint ?? 0, ...spans.map((span) => span.jobOrdinal), ...promptOrdinals) + 1;
}

function jobView(jobOrdinal: number, jobSpans: readonly JobSpan[]): JobView {
  const accepted = new Set<string>();
  const attempts = new Map<string, number>();
  const regions = new Map<string, WorkflowProgressRegionFinalizedRecord>();
  for (const span of jobSpans) {
    for (const invocationId of span.accepted) accepted.add(invocationId);
    for (const [invocationId, attempt] of span.attempts) {
      attempts.set(invocationId, Math.max(attempts.get(invocationId) ?? 0, attempt));
    }
    for (const [instance, finalized] of span.regions ?? []) regions.set(instance, finalized);
  }
  const last = jobSpans.at(-1);
  // A closed job reads as finished whatever its last span was doing: the
  // human ended the job, and the cursor it held is no longer offered.
  const outcome = last?.closed !== undefined
    ? last.closed
    : last?.status === "completed" || last?.status === "failed"
      ? last.status
      : undefined;
  const state: JobView["state"] = last?.closed !== undefined
    ? "finished"
    : last?.status === "running" ? "alive" : last?.status === "paused" ? "paused" : "finished";
  return {
    jobOrdinal,
    runId: last?.runId ?? "",
    state,
    ...(state === "finished" && outcome !== undefined ? { outcome } : {}),
    accepted,
    attempts,
    ...(last?.input === undefined ? {} : { input: last.input }),
    regions,
    spans: jobSpans,
  };
}
