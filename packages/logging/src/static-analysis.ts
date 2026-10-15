import { FileSystem } from "@effect/platform";
import { Data, Effect } from "effect";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { parseTrajectory } from "./trajectory.js";

export type StaticObservabilityFileName =
  | "log"
  | "trace"
  | "trajectory"
  | "progress"
  | "status";

export type StaticObservabilityIssueCode =
  | "missing-file"
  | "empty-file"
  | "invalid-json"
  | "invalid-jsonl"
  | "invalid-record"
  | "run-id-mismatch"
  | "trace-id-mismatch"
  | "trace-sequence"
  | "trace-parent-missing"
  | "trace-span-mismatch"
  | "trace-span-unmatched"
  | "trace-span-open"
  | "log-span-missing"
  | "transcript-missing"
  | "transcript-invalid"
  | "ref-missing"
  | "ref-mismatch";

export interface StaticObservabilityIssue {
  readonly code: StaticObservabilityIssueCode;
  readonly path: string;
  readonly message: string;
  readonly line?: number;
}

export interface StaticObservabilityFile {
  readonly name: StaticObservabilityFileName;
  readonly path: string;
  readonly required: boolean;
  readonly present: boolean;
  readonly records: number;
}

export interface StaticObservabilityReport {
  readonly runDir: string;
  readonly runId: string;
  readonly valid: boolean;
  readonly files: readonly StaticObservabilityFile[];
  readonly transcriptPaths: readonly string[];
  /** Handoff records the stream's acceptances point at, resolved. */
  readonly handoffRecordPaths: readonly string[];
  readonly logRecordCount: number;
  readonly traceRecordCount: number;
  readonly progressRecordCount: number;
  readonly issues: readonly StaticObservabilityIssue[];
}

/** Raw run files used by the pure static consistency analyzer. */
export interface StaticObservabilityInput {
  readonly runDir: string;
  readonly log?: string;
  readonly trace?: string;
  readonly trajectory?: string;
  /** The append-only stream the trajectory document is folded from. Either form
   * is enough to describe a run, and the analysis reads whichever is there. */
  readonly trajectoryStream?: string;
  readonly progress?: string;
  /** The run's state document (`status.json`): the one view of how a run is
   * doing, folded from the ledgers beside it. */
  readonly status?: string;
  /** Keys are resolved transcript paths. Missing keys represent missing files. */
  readonly transcripts?: Readonly<Record<string, string | undefined>>;
  /** Keys are resolved handoff record paths (`producer.result` lives in these).
   * Missing keys represent missing files. */
  readonly handoffRecords?: Readonly<Record<string, string | undefined>>;
  /** Keys are resolved result-file paths a handoff record pins by content.
   * Missing keys represent missing files. */
  readonly results?: Readonly<Record<string, string | undefined>>;
}

export class StaticObservabilityReadError extends Data.TaggedError("StaticObservabilityReadError")<{
  readonly path: string;
  readonly message: string;
}> {}

interface JsonRecord {
  readonly [key: string]: unknown;
}

interface ParsedJsonlRecord {
  readonly value: JsonRecord;
  readonly line: number;
}

interface TraceSpanState {
  readonly runId: string;
  readonly fn: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly line: number;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function issue(
  issues: StaticObservabilityIssue[],
  code: StaticObservabilityIssueCode,
  path: string,
  message: string,
  line?: number,
): void {
  issues.push({
    code,
    path,
    message,
    ...(line === undefined ? {} : { line }),
  });
}

function parseJsonl(
  path: string,
  raw: string | undefined,
  issues: StaticObservabilityIssue[],
): readonly ParsedJsonlRecord[] {
  if (raw === undefined) return [];
  const records: ParsedJsonlRecord[] = [];
  const lines = raw.split(/\r?\n/u);
  if (raw.trim() === "") {
    issue(issues, "empty-file", path, "JSONL file is empty");
    return records;
  }
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    const lineNumber = index + 1;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (cause) {
      issue(
        issues,
        "invalid-jsonl",
        path,
        cause instanceof Error ? cause.message : String(cause),
        lineNumber,
      );
      continue;
    }
    if (!isRecord(value)) {
      issue(issues, "invalid-record", path, "JSONL record must be an object", lineNumber);
      continue;
    }
    records.push({ value, line: lineNumber });
  }
  return records;
}

function parseJson(
  path: string,
  raw: string | undefined,
  issues: StaticObservabilityIssue[],
): JsonRecord | undefined {
  if (raw === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) {
      issue(issues, "invalid-record", path, "JSON document must be an object");
      return undefined;
    }
    return value;
  } catch (cause) {
    issue(issues, "invalid-json", path, cause instanceof Error ? cause.message : String(cause));
    return undefined;
  }
}

function addRequiredFileIssue(
  issues: StaticObservabilityIssue[],
  path: string,
  name: string,
  raw: string | undefined,
): void {
  if (raw === undefined) issue(issues, "missing-file", path, `${name} file is required`);
}

function collectTranscriptPaths(
  value: unknown,
  runDir: string,
  paths: Set<string>,
  ancestors: readonly object[] = [],
): void {
  if (value === null || typeof value !== "object") return;
  if (ancestors.includes(value)) return;
  const nextAncestors = [...ancestors, value];
  if (Array.isArray(value)) {
    for (const item of value) collectTranscriptPaths(item, runDir, paths, nextAncestors);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if ((key === "transcriptPath" || key === "transcript_path") && typeof item === "string" && item !== "") {
      paths.add(resolve(runDir, item));
      continue;
    }
    collectTranscriptPaths(item, runDir, paths, nextAncestors);
  }
}

/** The handoff record each acceptance points at, resolved the same way a
 * transcript path is. The record is what pins the published result file, so it
 * is the reference this analysis follows. */
function collectHandoffRecordPaths(
  value: unknown,
  runDir: string,
  paths: Set<string>,
  ancestors: readonly object[] = [],
): void {
  if (value === null || typeof value !== "object") return;
  if (ancestors.includes(value)) return;
  const nextAncestors = [...ancestors, value];
  if (Array.isArray(value)) {
    for (const item of value) collectHandoffRecordPaths(item, runDir, paths, nextAncestors);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === "handoffRecordPath" && typeof item === "string" && item !== "") {
      paths.add(resolve(runDir, item));
      continue;
    }
    collectHandoffRecordPaths(item, runDir, paths, nextAncestors);
  }
}

/** A handoff record pins the published result file it vouches for by content.
 * Check that the pin still holds: the file is there, and its bytes still hash
 * to what the record recorded. A record without that pin — written before the
 * result was pinned, or by a writer that does not pin — is not a reference and
 * is left alone. */
function validateHandoffReferences(
  handoffRecords: Readonly<Record<string, string | undefined>>,
  results: Readonly<Record<string, string | undefined>>,
  runDir: string,
  issues: StaticObservabilityIssue[],
): void {
  for (const [path, raw] of Object.entries(handoffRecords)) {
    if (raw === undefined) continue;
    const document = parseJson(path, raw, issues);
    if (document === undefined) continue;
    const producer = document.producer;
    if (!isRecord(producer)) continue;
    const result = producer.result;
    if (!isRecord(result)) continue;
    const pinnedPath = result.path;
    const pinnedDigest = result.sha256;
    if (!isNonEmptyString(pinnedPath) || !isNonEmptyString(pinnedDigest)) continue;
    const resolved = resolve(runDir, pinnedPath);
    const content = results[resolved];
    if (content === undefined) {
      issue(issues, "ref-missing", path, `referenced result ${resolved} does not exist`);
      continue;
    }
    const actual = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    if (actual !== pinnedDigest) {
      issue(
        issues,
        "ref-mismatch",
        path,
        `referenced result ${resolved} hashes to ${actual}, record pinned ${pinnedDigest}`,
      );
    }
  }
}

/** The published result files a set of handoff records pin. Read before the
 * analysis so their contents can be checked against the pin. */
function collectResultPaths(
  handoffRecords: Readonly<Record<string, string | undefined>>,
  runDir: string,
): readonly string[] {
  const paths = new Set<string>();
  for (const raw of Object.values(handoffRecords)) {
    if (raw === undefined) continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!isRecord(value) || !isRecord(value.producer) || !isRecord(value.producer.result)) continue;
    const pinnedPath = value.producer.result.path;
    if (isNonEmptyString(pinnedPath)) paths.add(resolve(runDir, pinnedPath));
  }
  return [...paths].sort();
}

function validateLogRecords(
  records: readonly ParsedJsonlRecord[],
  expectedRunId: string,
  path: string,
  issues: StaticObservabilityIssue[],
): ReadonlySet<string> {
  const traceIds = new Set<string>();
  for (const { value: record, line } of records) {
    const runId = isNonEmptyString(record.run_id) ? record.run_id : undefined;
    const traceId = isNonEmptyString(record.trace_id) ? record.trace_id : undefined;
    const malformedFields: string[] = [];
    if (!isTimestamp(record.timestamp)) malformedFields.push("timestamp");
    if (runId === undefined) malformedFields.push("run_id");
    if (traceId === undefined) malformedFields.push("trace_id");
    if (!isNonEmptyString(record.event)) malformedFields.push("event");
    if (record.span_id !== undefined && !isNonEmptyString(record.span_id)) malformedFields.push("span_id");
    if (malformedFields.length > 0) {
      issue(issues, "invalid-record", path, `log record has invalid field(s): ${malformedFields.join(", ")}`, line);
    }
    if (runId !== undefined && runId !== expectedRunId) {
      issue(issues, "run-id-mismatch", path, `log run_id is ${runId}, expected ${expectedRunId}`, line);
    }
    if (traceId !== undefined) traceIds.add(traceId);
  }
  return traceIds;
}

function validateTraceRecords(
  records: readonly ParsedJsonlRecord[],
  expectedRunId: string,
  path: string,
  issues: StaticObservabilityIssue[],
): { readonly traceIds: ReadonlySet<string>; readonly spanIds: ReadonlySet<string> } {
  const traceIds = new Set<string>();
  const spanIds = new Set<string>();
  const openSpans = new Map<string, TraceSpanState>();
  let previousSeq = 0;
  for (const { value: record, line } of records) {
    const runId = isNonEmptyString(record.run_id) ? record.run_id : undefined;
    const traceId = isNonEmptyString(record.trace_id) ? record.trace_id : undefined;
    const spanId = isNonEmptyString(record.span_id) ? record.span_id : undefined;
    const seq = isSafePositiveInteger(record.seq) ? record.seq : undefined;
    const depth = isSafeNonNegativeInteger(record.depth) ? record.depth : undefined;
    const event = record.event;
    const parentId = record.parent_id === null
      ? null
      : isNonEmptyString(record.parent_id) ? record.parent_id : undefined;
    const fn = isNonEmptyString(record.fn) ? record.fn : undefined;
    const malformedFields: string[] = [];
    if (!isTimestamp(record.timestamp)) malformedFields.push("timestamp");
    if (runId === undefined) malformedFields.push("run_id");
    if (traceId === undefined) malformedFields.push("trace_id");
    if (seq === undefined) malformedFields.push("seq");
    if (depth === undefined) malformedFields.push("depth");
    if (spanId === undefined) malformedFields.push("span_id");
    if (parentId === undefined) malformedFields.push("parent_id");
    if (event !== "enter" && event !== "exit" && event !== "error") malformedFields.push("event");
    if (fn === undefined) malformedFields.push("fn");
    if (event === "exit" && record.ok !== true) malformedFields.push("ok");
    if (event === "error" && record.ok !== false) malformedFields.push("ok");
    if (event === "exit" || event === "error") {
      if (!isFiniteNonNegativeNumber(record.duration_ms)) malformedFields.push("duration_ms");
    }
    if (malformedFields.length > 0) {
      issue(issues, "invalid-record", path, `trace record has invalid field(s): ${malformedFields.join(", ")}`, line);
    }
    if (runId !== undefined && runId !== expectedRunId) {
      issue(issues, "run-id-mismatch", path, `trace run_id is ${runId}, expected ${expectedRunId}`, line);
    }
    if (traceId !== undefined) traceIds.add(traceId);
    if (runId === undefined || traceId === undefined || seq === undefined || depth === undefined || spanId === undefined || parentId === undefined || fn === undefined) {
      continue;
    }
    if (malformedFields.length > 0) continue;
    if (seq !== previousSeq + 1) {
      issue(issues, "trace-sequence", path, `sequence ${seq} is not contiguous after ${previousSeq}`, line);
    }
    previousSeq = seq;
    if (event === "enter") {
      if (spanIds.has(spanId)) {
        issue(issues, "trace-span-unmatched", path, `span ${spanId} entered more than once`, line);
        continue;
      }
      if (parentId === null) {
        if (depth !== 0) {
          issue(issues, "trace-span-mismatch", path, `root span ${spanId} has depth ${depth}, expected 0`, line);
        }
      } else {
        const parent = openSpans.get(parentId);
        if (parent === undefined) {
          issue(issues, "trace-parent-missing", path, `span ${spanId} references inactive parent ${parentId}`, line);
        } else if (depth !== parent.depth + 1) {
          issue(issues, "trace-span-mismatch", path, `span ${spanId} depth ${depth} does not follow parent depth ${parent.depth}`, line);
        }
      }
      spanIds.add(spanId);
      openSpans.set(spanId, { runId, fn, parentId, depth, line });
      continue;
    }
    const opening = openSpans.get(spanId);
    if (opening === undefined) {
      issue(issues, "trace-span-unmatched", path, `${event} has no active span ${spanId}`, line);
      continue;
    }
    const mismatches: string[] = [];
    if (opening.runId !== runId) mismatches.push("run_id");
    if (opening.fn !== fn) mismatches.push("fn");
    if (opening.parentId !== parentId) mismatches.push("parent_id");
    if (opening.depth !== depth) mismatches.push("depth");
    if (mismatches.length > 0) {
      issue(issues, "trace-span-mismatch", path, `closing ${event} does not match enter on ${mismatches.join(", ")}`, line);
    }
    openSpans.delete(spanId);
  }
  for (const [spanId, opening] of openSpans) {
    issue(issues, "trace-span-open", path, `span ${spanId} opened at line ${opening.line} has no exit or error record`);
  }
  return { traceIds, spanIds };
}

function validateTraceIds(
  logTraceIds: ReadonlySet<string>,
  traceTraceIds: ReadonlySet<string>,
  path: string,
  issues: StaticObservabilityIssue[],
): void {
  const all = new Set([...logTraceIds, ...traceTraceIds]);
  if (all.size > 1) {
    issue(issues, "trace-id-mismatch", path, `observability files contain multiple trace ids: ${[...all].join(", ")}`);
  }
  for (const traceId of logTraceIds) {
    if (!traceTraceIds.has(traceId)) {
      issue(issues, "trace-id-mismatch", path, `log trace id ${traceId} is absent from trace.jsonl`);
    }
  }
  for (const traceId of traceTraceIds) {
    if (!logTraceIds.has(traceId)) {
      issue(issues, "trace-id-mismatch", path, `trace trace id ${traceId} is absent from log.jsonl`);
    }
  }
}

function validateTrajectory(
  trajectory: JsonRecord,
  expectedRunId: string,
  path: string,
  issues: StaticObservabilityIssue[],
): void {
  const malformedFields: string[] = [];
  if (trajectory.version !== 1) malformedFields.push("version");
  if (!isNonEmptyString(trajectory.runId)) malformedFields.push("runId");
  if (!isTimestamp(trajectory.updatedAt)) malformedFields.push("updatedAt");
  if (!isSafeNonNegativeInteger(trajectory.promptLength)) malformedFields.push("promptLength");
  if (!Array.isArray(trajectory.events)) malformedFields.push("events");
  const status = trajectory.status;
  if (status !== "completed" && status !== "failed" && status !== "cancelled") malformedFields.push("status");
  if (malformedFields.length > 0) {
    issue(issues, "invalid-record", path, `trajectory has invalid field(s): ${malformedFields.join(", ")}`);
  }
  if (isNonEmptyString(trajectory.runId) && trajectory.runId !== expectedRunId) {
    issue(issues, "run-id-mismatch", path, `trajectory runId is ${trajectory.runId}, expected ${expectedRunId}`);
  }
}

function validateProgressRecords(
  records: readonly ParsedJsonlRecord[],
  path: string,
  issues: StaticObservabilityIssue[],
): void {
  const runIds = new Set<string>();
  // Below the kind split: an accepted stage and nothing else carries these.
  const requiredStrings = [
    "invocationId",
    "stageId",
    "stage",
    "worker",
    "sessionId",
    "transcriptPath",
    "handoffRecordPath",
  ] as const;
  for (const { value: record, line } of records) {
    // Every record kind carries these.
    const malformedFields: string[] = [];
    if (record.version !== 1) malformedFields.push("version");
    if (!isTimestamp(record.timestamp)) malformedFields.push("timestamp");
    if (!isNonEmptyString(record.runId)) malformedFields.push("runId");
    // A line that names its kind is one of the records the stream carries for
    // a start, an end or a job close, and it holds none of the fields below.
    // A line without one is an accepted stage — which is what every line was
    // before the kinds existed. `progressRecordKind` owns that rule; this
    // module only needs its consequence.
    if (typeof record.kind !== "string") {
      for (const field of requiredStrings) {
        if (!isNonEmptyString(record[field])) malformedFields.push(field);
      }
      if (!isSafePositiveInteger(record.attempt)) malformedFields.push("attempt");
      if (!isRecord(record.workspace)) malformedFields.push("workspace");
      if (record.iteration !== undefined && !isSafeNonNegativeInteger(record.iteration)) malformedFields.push("iteration");
      for (const field of ["instanceId", "resultPath", "requestedModel", "requestedThinkingLevel", "model", "thinkingLevel"] as const) {
        if (record[field] !== undefined && !isNonEmptyString(record[field])) malformedFields.push(field);
      }
    }
    if (malformedFields.length > 0) {
      issue(issues, "invalid-record", path, `progress record has invalid field(s): ${malformedFields.join(", ")}`, line);
    }
    if (isNonEmptyString(record.runId)) runIds.add(record.runId);
  }
  if (runIds.size > 1) {
    issue(issues, "invalid-record", path, `progress records contain multiple execution ids: ${[...runIds].join(", ")}`);
  }
}

/** The run's state document is the one view of how a run is doing, so what it
 * must carry is small: who the run is, when it was last updated, how it ended,
 * and how much of its plan is done. Its identity field is `runId` — the name
 * the document settled on when the three diverged status files became one. */
function validateStatus(
  status: JsonRecord | undefined,
  path: string,
  issues: StaticObservabilityIssue[],
): void {
  if (status === undefined) return;
  const validStatus = status.status === "running" || status.status === "completed" ||
    status.status === "failed" || status.status === "paused" || status.status === "cancelled";
  const planned = status.plannedStages;
  const completed = status.completedStages;
  const accepted = status.acceptedStages;
  const remaining = status.remainingStages;
  const malformedFields: string[] = [];
  if (status.version !== 1) malformedFields.push("version");
  if (!isTimestamp(status.updatedAt)) malformedFields.push("updatedAt");
  if (!isNonEmptyString(status.runId)) malformedFields.push("runId");
  if (!validStatus) malformedFields.push("status");
  if (!isSafeNonNegativeInteger(planned)) malformedFields.push("plannedStages");
  if (!isSafeNonNegativeInteger(completed)) malformedFields.push("completedStages");
  if (!isSafeNonNegativeInteger(accepted)) malformedFields.push("acceptedStages");
  if (!isSafeNonNegativeInteger(remaining)) malformedFields.push("remainingStages");
  if (!isRecord(status.stageCounts)) malformedFields.push("stageCounts");
  if (malformedFields.length > 0) {
    issue(issues, "invalid-record", path, `run status has invalid field(s): ${malformedFields.join(", ")}`);
    return;
  }
  if (!isSafeNonNegativeInteger(planned) || !isSafeNonNegativeInteger(completed) || !isSafeNonNegativeInteger(accepted) || !isSafeNonNegativeInteger(remaining)) {
    return;
  }
  if (completed > planned || accepted > planned || remaining > planned) {
    issue(issues, "invalid-record", path, "run status stage counts exceed plannedStages");
  }
}

function validateTranscript(
  path: string,
  raw: string | undefined,
  issues: StaticObservabilityIssue[],
): void {
  if (raw === undefined) {
    issue(issues, "transcript-missing", path, "referenced transcript does not exist");
    return;
  }
  let records = 0;
  for (const [index, line] of raw.split(/\r?\n/u).entries()) {
    if (line.trim() === "") continue;
    const lineNumber = index + 1;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (cause) {
      issue(issues, "transcript-invalid", path, cause instanceof Error ? cause.message : String(cause), lineNumber);
      continue;
    }
    if (!isRecord(value) || typeof value.type !== "string" || value.type === "") {
      issue(issues, "transcript-invalid", path, "transcript record requires a non-empty type", lineNumber);
      continue;
    }
    records += 1;
  }
  if (records === 0) issue(issues, "transcript-invalid", path, "transcript contains no records");
}

function fileSummary(
  name: StaticObservabilityFileName,
  path: string,
  required: boolean,
  raw: string | undefined,
  records: number,
): StaticObservabilityFile {
  return { name, path, required, present: raw !== undefined, records };
}

/** Analyze already-loaded run artifacts without performing I/O. */
export function analyzeStaticObservability(
  input: StaticObservabilityInput,
): StaticObservabilityReport {
  const runDir = resolve(input.runDir);
  const runId = basename(runDir);
  const issues: StaticObservabilityIssue[] = [];
  const logPath = join(runDir, "log.jsonl");
  const tracePath = join(runDir, "trace.jsonl");
  const trajectoryPath = join(runDir, "trajectory.jsonl");
  const progressPath = join(runDir, "progress.jsonl");
  const statusPath = join(runDir, "status.json");
  // A run's trajectory is recorded in two forms. The stream is the record and
  // the document beside it is folded from it, so whichever is there describes
  // the run — and the checks below read one document either way.
  const foldedTrajectory = parseTrajectory(input.trajectoryStream);
  const trajectoryText = foldedTrajectory === undefined ? input.trajectory : JSON.stringify(foldedTrajectory);

  addRequiredFileIssue(issues, logPath, "log", input.log);
  addRequiredFileIssue(issues, tracePath, "trace", input.trace);
  addRequiredFileIssue(issues, trajectoryPath, "trajectory", trajectoryText);

  const logRecords = parseJsonl(logPath, input.log, issues);
  const traceRecords = parseJsonl(tracePath, input.trace, issues);
  const progressRecords = parseJsonl(progressPath, input.progress, issues);
  const trajectory = parseJson(trajectoryPath, trajectoryText, issues);
  const status = parseJson(statusPath, input.status, issues);
  if (input.log !== undefined && logRecords.length === 0 && input.log.trim() !== "") {
    issue(issues, "empty-file", logPath, "log contains no valid records");
  }
  if (input.trace !== undefined && traceRecords.length === 0 && input.trace.trim() !== "") {
    issue(issues, "empty-file", tracePath, "trace contains no valid records");
  }

  const logTraceIds = validateLogRecords(logRecords, runId, logPath, issues);
  const traceResult = validateTraceRecords(traceRecords, runId, tracePath, issues);
  validateTraceIds(logTraceIds, traceResult.traceIds, runDir, issues);
  for (const { value: record, line } of logRecords) {
    if (isNonEmptyString(record.span_id) && !traceResult.spanIds.has(record.span_id)) {
      issue(issues, "log-span-missing", logPath, `log references span ${record.span_id}, absent from trace.jsonl`, line);
    }
  }

  const transcriptPaths = new Set<string>();
  const handoffRecordPaths = new Set<string>();
  if (trajectory !== undefined) {
    validateTrajectory(trajectory, runId, trajectoryPath, issues);
    collectTranscriptPaths(trajectory, runDir, transcriptPaths);
    collectHandoffRecordPaths(trajectory, runDir, handoffRecordPaths);
  }
  validateProgressRecords(progressRecords, progressPath, issues);
  for (const { value: record } of progressRecords) {
    collectTranscriptPaths(record, runDir, transcriptPaths);
    collectHandoffRecordPaths(record, runDir, handoffRecordPaths);
  }
  validateStatus(status, statusPath, issues);
  const transcriptContents = input.transcripts ?? {};
  for (const path of transcriptPaths) validateTranscript(path, transcriptContents[path], issues);
  validateHandoffReferences(input.handoffRecords ?? {}, input.results ?? {}, runDir, issues);

  const files: readonly StaticObservabilityFile[] = [
    fileSummary("log", logPath, true, input.log, logRecords.length),
    fileSummary("trace", tracePath, true, input.trace, traceRecords.length),
    fileSummary("trajectory", trajectoryPath, true, trajectoryText, trajectory === undefined ? 0 : 1),
    fileSummary("progress", progressPath, false, input.progress, progressRecords.length),
    fileSummary("status", statusPath, false, input.status, status === undefined ? 0 : 1),
  ];
  return {
    runDir,
    runId,
    valid: issues.length === 0,
    files,
    transcriptPaths: [...transcriptPaths].sort(),
    handoffRecordPaths: [...handoffRecordPaths].sort(),
    logRecordCount: logRecords.length,
    traceRecordCount: traceRecords.length,
    progressRecordCount: progressRecords.length,
    issues,
  };
}

function readOptional(
  fileSystem: FileSystem.FileSystem,
  path: string,
): Effect.Effect<string | undefined, StaticObservabilityReadError> {
  return fileSystem.readFileString(path).pipe(
    Effect.catchAll((cause) => cause._tag === "SystemError" && cause.reason === "NotFound"
      ? Effect.succeed(undefined)
      : Effect.fail(new StaticObservabilityReadError({ path, message: cause.message }))),
  );
}

/** Read a run directory and perform the same static analysis used by tests and callers. */
export function inspectStaticObservability(
  runDir: string,
): Effect.Effect<StaticObservabilityReport, StaticObservabilityReadError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const resolvedRunDir = resolve(runDir);
    const [log, trace, trajectoryStream, progress, status] = yield* Effect.all([
      readOptional(fileSystem, join(resolvedRunDir, "log.jsonl")),
      readOptional(fileSystem, join(resolvedRunDir, "trace.jsonl")),
      readOptional(fileSystem, join(resolvedRunDir, "trajectory.jsonl")),
      readOptional(fileSystem, join(resolvedRunDir, "progress.jsonl")),
      readOptional(fileSystem, join(resolvedRunDir, "status.json")),
    ] as const, { concurrency: "unbounded" });
    const initial = analyzeStaticObservability({
      runDir: resolvedRunDir,
      log,
      trace,
      trajectoryStream,
      progress,
      status,
    });
    const transcriptEntries = yield* Effect.forEach(
      initial.transcriptPaths,
      (path) => readOptional(fileSystem, path).pipe(Effect.map((content) => [path, content] as const)),
      { concurrency: "unbounded" },
    );
    const handoffEntries = yield* Effect.forEach(
      initial.handoffRecordPaths,
      (path) => readOptional(fileSystem, path).pipe(Effect.map((content) => [path, content] as const)),
      { concurrency: "unbounded" },
    );
    const handoffRecords = Object.fromEntries(handoffEntries);
    const resultEntries = yield* Effect.forEach(
      collectResultPaths(handoffRecords, resolvedRunDir),
      (path) => readOptional(fileSystem, path).pipe(Effect.map((content) => [path, content] as const)),
      { concurrency: "unbounded" },
    );
    return analyzeStaticObservability({
      runDir: resolvedRunDir,
      log,
      trace,
      trajectoryStream,
      progress,
      status,
      transcripts: Object.fromEntries(transcriptEntries),
      handoffRecords,
      results: Object.fromEntries(resultEntries),
    });
  });
}

/** Stable plain-text output for offline review and shell logs. */
export function formatStaticObservabilityReport(report: StaticObservabilityReport): string {
  const state = report.valid ? "PASS" : "FAIL";
  const lines = [
    `OBSERVABILITY ${state}: ${report.runId}`,
    `run: ${report.runDir}`,
    `records: log=${report.logRecordCount} trace=${report.traceRecordCount} progress=${report.progressRecordCount} transcripts=${report.transcriptPaths.length} handoffs=${report.handoffRecordPaths.length}`,
  ];
  for (const file of report.files) {
    const marker = file.present ? "present" : file.required ? "missing" : "absent (optional)";
    lines.push(`file ${file.name}: ${marker} records=${file.records} path=${file.path}`);
  }
  if (report.issues.length === 0) {
    lines.push("issues: none");
  } else {
    lines.push(`issues: ${report.issues.length}`);
    for (const issue of report.issues) {
      const location = issue.line === undefined ? issue.path : `${issue.path}:${issue.line}`;
      lines.push(`- ${issue.code} ${location}: ${issue.message}`);
    }
  }
  return lines.join("\n");
}
