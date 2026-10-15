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
 * `resume.jsonl` records the whole table on every write, so the newest line is
 * the table — not a delta to be merged. */
export async function readResumeActors(runDir: string): Promise<Record<string, Record<string, unknown>>> {
  const records = await readStream(runDir, "resume.jsonl");
  const last = records.at(-1) as { actors?: Record<string, Record<string, unknown>> } | undefined;
  return last?.actors ?? {};
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
