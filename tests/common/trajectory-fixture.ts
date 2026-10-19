// Test-side spelling of "a run recorded this trajectory": fixtures are written
// in the document shape (events plus the turns that slice them) because that is
// how a test thinks about a run, and are laid down as the append-only stream
// that is all a run keeps now. One conversion, so every suite folds the same
// run its readers would.
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export interface TrajectoryFixture {
  readonly runId?: string;
  readonly events?: readonly unknown[];
  readonly turns?: ReadonlyArray<{ prompt: string; status: string; eventCount: number }>;
  readonly [key: string]: unknown;
}

/** Write one run's trajectory as stream records: one per turn, carrying the
 * events that turn owns. A fixture with no turns is one record holding them all. */
export async function writeTrajectoryRun(runDir: string, document: TrajectoryFixture): Promise<void> {
  const events = document.events ?? [];
  const turns = document.turns ?? [];
  const runId = document.runId ?? basename(runDir);
  // A real write always carries it; fixtures that do not care say zero.
  const promptLength = typeof document.promptLength === "number" ? document.promptLength : 0;
  const scalars = Object.fromEntries(
    Object.entries(document).filter(([key]) => !["events", "turns", "runId", "updatedAt"].includes(key)),
  );
  const records: Array<Record<string, unknown>> = [];
  let start = 0;
  let second = 0;
  for (const turn of turns) {
    records.push({
      ...scalars,
      runId,
      promptLength,
      timestamp: `2026-09-01T00:00:${String(second).padStart(2, "0")}.000Z`,
      prompt: turn.prompt,
      status: turn.status,
      events: events.slice(start, turn.eventCount),
    });
    start = turn.eventCount;
    second += 1;
  }
  if (turns.length === 0) {
    records.push({
      ...scalars,
      runId,
      promptLength,
      timestamp: "2026-09-01T00:00:00.000Z",
      events,
    });
  }
  await mkdir(join(runDir, "system-log"), { recursive: true });
  await writeFile(
    join(runDir, "system-log", "trajectory.jsonl"),
    records.map((record) => `${JSON.stringify(record)}\n`).join(""),
    "utf8",
  );
}
