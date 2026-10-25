/**
 * Launch mechanics: run a case's shell command in its sandbox (with timeout
 * and process-group termination), substitute its command template, and render
 * the live progress tick while a run is in flight.
 */
import { Effect } from "effect";
import { evalMetricsPath, io, runStatusPath } from "@piano/base";
import { parseJsonRecord } from "@piano/logging";
/** The eval launcher's shell boundary is the shared process adapter. */
export const runShell = io.runShell;

export function substituteCommand(command: string, vars: Record<string, string>): string {
  // Single pass: placeholders are matched as literal tokens and substituted
  // exactly once, so a substituted value is never rescanned (a prompt
  // containing another key's placeholder stays literal) and `$` patterns in
  // values carry no replacement semantics (callback form). Longest key first
  // prevents prefix shadowing; keys are regex-escaped because callers own
  // the map.
  const keys = Object.keys(vars).sort((a, b) => b.length - a.length);
  if (keys.length === 0) return command;
  const pattern = new RegExp(keys.map((key) => `<${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>`).join("|"), "g");
  return command.replace(pattern, (match) => vars[match.slice(1, -1)]!);
}

export function shellQuote(value: string): string {
  // Standard POSIX idiom for a literal single quote inside single quotes:
  // close the quote, emit an escaped `'`, reopen the quote -> `'\''`.
  // The previous `'"'"'` double-quote idiom also emitted stray backslashes
  // (`'\"'\"'`), which broke argv splitting for prompts containing apostrophes.
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function readStatus(runDir: string): Record<string, unknown> | undefined {
  try {
    // Synchronous UI/evidence contract: the progress tick and the transcript
    // fallback are plain functions, so the io read runs at this sync edge.
    const raw = Effect.runSync(io.readTextSync(runStatusPath(runDir)).pipe(
      Effect.catchAll(() => Effect.succeed(undefined)),
    ));
    return raw === undefined ? undefined : parseJsonRecord(raw);
  } catch {
    return undefined;
  }
}

/** One live-progress tick for a run still in flight: wall time, stage
 * completion from the progress snapshot, and the trajectory's iteration
 * count plus latest best metric from benchmark.jsonl. Everything read here
 * is append-only or atomically replaced, so a torn mid-write simply yields a
 * slightly stale (or skipped, returning undefined) tick. Exported for
 * testing; the CLI progress path is runCase's poller. */
export function progressTickLine(label: string, runDir: string, startedAt: number): string | undefined {
  const snapshot = readStatus(runDir);
  const completed = typeof snapshot?.completedStages === "number" ? snapshot.completedStages : undefined;
  const planned = typeof snapshot?.plannedStages === "number" ? snapshot.plannedStages : undefined;
  const current = typeof snapshot?.current === "object" && snapshot.current !== null
    ? snapshot.current as Record<string, unknown>
    : undefined;
  const currentStage = typeof current?.stageId === "string" ? current.stageId : undefined;
  let iteration: number | undefined;
  let best: string | undefined;
  // Synchronous presentation contract (one tick, no fiber): the io read runs
  // at this sync edge; a missing benchmark.jsonl reports the stage fields only.
  const rawMetrics = Effect.runSync(io.readTextSync(evalMetricsPath(runDir, "benchmark.jsonl")).pipe(
    Effect.catchAll(() => Effect.succeed(undefined)),
  ));
  if (rawMetrics !== undefined) {
    const records: { iteration?: number; metric?: { name?: string; best?: number } }[] = [];
    for (const line of rawMetrics.split("\n")) {
      if (line.trim() === "") continue;
      const record = parseJsonRecord(line);
      // A line torn mid-append is skipped; the next tick sees it whole.
      if (record !== undefined) records.push(record as { iteration?: number; metric?: { name?: string; best?: number } });
    }
    // All-time best across iterations. The latest record's metric.best is a
    // per-iteration value that dips when an idea is reverted, and a "best"
    // that goes backwards is misleading in a live monitor.
    let topBest: number | undefined;
    let topName: string | undefined;
    for (const record of records) {
      const value = record.metric?.best;
      if (typeof value !== "number") continue;
      if (typeof record.iteration === "number") iteration = Math.max(iteration ?? -1, record.iteration);
      if (topBest === undefined || value > topBest) {
        topBest = value;
        topName = record.metric?.name;
      }
    }
    if (topBest !== undefined) {
      best = `${topBest.toFixed(4)}${topName === undefined ? "" : ` ${topName}`}`;
    }
  }
  if (completed === undefined && iteration === undefined) return undefined;
  const parts = [
    `  ${label}`,
    `elapsed=${Math.round((Date.now() - startedAt) / 60_000)}m`,
    completed === undefined || planned === undefined ? undefined : `stages=${completed}/${planned}`,
    currentStage === undefined ? undefined : `current=${currentStage}`,
    iteration === undefined ? undefined : `iter=${iteration}`,
    best === undefined ? undefined : `best=${best}`,
  ];
  return parts.filter((part): part is string => part !== undefined).join(" ");
}
