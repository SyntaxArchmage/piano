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
  type WorkflowProgressRecord,
  type WorkflowProgressStartRecord,
  type WorkflowProgressStreamRecord,
} from "./progress.js";

/** One run interval of a job. */
export interface JobSpan {
  readonly jobOrdinal: number;
  readonly executionId: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly status: "running" | "completed" | "failed" | "paused";
  /** Invocation ids accepted during this span. */
  readonly accepted: ReadonlySet<string>;
  /** The invocation whose latest attempt started and has not been accepted in
   * this span, when one is in flight. */
  readonly inFlight?: string;
}

/** One job across all of its spans. */
export interface JobView {
  readonly jobOrdinal: number;
  readonly executionId: string;
  /** `alive` while the last span runs; `paused` after a human stop; `finished`
   * once a span closed with an outcome. */
  readonly state: "alive" | "paused" | "finished";
  /** Present only when `state` is `finished`. */
  readonly outcome?: "completed" | "failed";
  /** Invocation ids accepted across every span of this job — the set a
   * continue of this job skips. */
  readonly accepted: ReadonlySet<string>;
  readonly spans: readonly JobSpan[];
}

interface MutableSpan {
  jobOrdinal: number;
  executionId: string;
  startedAt: string;
  finishedAt?: string;
  status: JobSpan["status"];
  accepted: Set<string>;
  inFlight?: string;
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
    if (kind === "execution-started") {
      const started = record as WorkflowProgressExecutionStartRecord;
      spans.push({
        // A span that does not name its job is a new one: streams written
        // before continues existed held no other kind of span.
        jobOrdinal: started.jobOrdinal ?? (spans.at(-1)?.jobOrdinal ?? 0) + 1,
        executionId: started.executionId,
        startedAt: started.timestamp,
        status: "running",
        accepted: new Set(),
      });
      continue;
    }
    const span = spans.at(-1);
    if (span === undefined) continue;
    if (kind === "stage-started") {
      span.inFlight = (record as WorkflowProgressStartRecord).invocationId;
    } else if (kind === "stage-accepted") {
      const invocationId = (record as WorkflowProgressRecord).invocationId;
      span.accepted.add(invocationId);
      // The in-flight attempt was accepted; a later stage-started for the same
      // invocation sets the flag again.
      if (span.inFlight === invocationId) delete span.inFlight;
    } else {
      const finished = record as WorkflowProgressExecutionFinishRecord;
      span.status = finished.status;
      span.finishedAt = finished.timestamp;
    }
  }
  return spans;
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

function jobView(jobOrdinal: number, jobSpans: readonly JobSpan[]): JobView {
  const accepted = new Set<string>();
  for (const span of jobSpans) {
    for (const invocationId of span.accepted) accepted.add(invocationId);
  }
  const last = jobSpans.at(-1);
  const state = last?.status === "running" ? "alive" : last?.status === "paused" ? "paused" : "finished";
  return {
    jobOrdinal,
    executionId: last?.executionId ?? "",
    state,
    ...(state === "finished" && (last?.status === "completed" || last?.status === "failed")
      ? { outcome: last.status }
      : {}),
    accepted,
    spans: jobSpans,
  };
}
