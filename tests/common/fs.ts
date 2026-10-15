// Shared filesystem helpers for tests that read the runs root back off disk:
// engine tests (resume.jsonl / progress.json) and session tests (trajectory).
// readJson mirrors the writers' single-JSON-document-per-file format.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

/** The event fields of a run's append-only stream, in the order written.
 *
 * Both `progress.jsonl` and `resume.jsonl` are one JSON object per line, so a
 * reader that wants the newest state takes the last record. */
export async function readStream(runDir: string, name: string): Promise<Record<string, unknown>[]> {
  const raw = await readFile(join(runDir, name), "utf8").catch(() => "");
  return raw.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The actor table a run last persisted.
 *
 * The ledger's `actor-turn` rows are the record: one row per conversation-state
 * change, newest row per actor winning, folded here the same way `foldActorTurns`
 * folds them in the orchestrator. The retired resume stream is not read: a run
 * that predates the rows is covered by the orchestrator's own fallback. */
export async function readResumeActors(runDir: string): Promise<Record<string, Record<string, unknown>>> {
  const records = await readStream(runDir, "progress.jsonl");
  const actors: Record<string, Record<string, unknown>> = {};
  for (const record of records) {
    if (record.kind !== "actor-turn") continue;
    actors[String(record.actorKey)] = {
      harness: record.harness,
      sessionId: record.sessionId,
      transcriptPath: record.transcriptPath,
      turns: record.turn,
      ...(record.continuation === undefined ? {} : { continuation: record.continuation }),
    };
  }
  return actors;
}

/** List every file under dir, recursively. */
export async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(path));
    else out.push(path);
  }
  return out;
}
