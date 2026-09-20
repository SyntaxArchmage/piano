// Shared filesystem helpers for tests that read the runs root back off disk:
// engine tests (resume.json / progress.json) and session tests (trajectory).
// readJson mirrors the writers' single-JSON-document-per-file format.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
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
