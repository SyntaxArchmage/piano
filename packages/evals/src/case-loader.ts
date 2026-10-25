/**
 * Case loading (the read side of the case material): enumerate and parse the
 * immutable `case.yaml` manifests under the evals material root.
 *
 * The source root is resolved from this package's own source via
 * `import.meta.url`, so cases are found regardless of the caller's cwd.
 * Layout: `workloads/<case>/`.
 */
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "@piano/base";
import { parseCaseConfig } from "./case-config.js";
import { DriverError } from "./errors.js";
import type { EvalCase } from "./types.js";

// Source material (case.yaml, workflow.yml, workspace templates) is read-only
// non-code data that lives at the repository top level, under `evals/`
// (mirroring `recipes/`), NOT inside this package. `packages/evals/src/
// case-loader.ts` → `../../../evals` = the repository-root `evals/`.
export const DEFAULT_EVALS_ROOT = fileURLToPath(new URL("../../../evals", import.meta.url));

/** Resolve the workloads directory given an evals root. */
export function workloadsDir(root: string): string {
  return join(root, "workloads");
}

/** List case directory names under the workloads dir. */
export function listCaseDirs(
  root: string,
): Effect.Effect<readonly string[], DriverError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = workloadsDir(root);
    const exists = yield* fs.exists(dir).pipe(
      Effect.mapError((cause) => new DriverError({ message: String(cause), cause })),
    );
    if (!exists) return [] as const;
    const entries = yield* io.readdir(dir).pipe(
      Effect.mapError((cause) => new DriverError({ message: String(new Error(cause.message)), cause })),
    );
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  });
}

/** Load one case config from `workloads/<caseDir>/case.yaml`. */
export function loadCase(
  root: string,
  caseDir: string,
): Effect.Effect<EvalCase, DriverError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const configPath = join(workloadsDir(root), caseDir, "case.yaml");
    const source = yield* fs.readFileString(configPath).pipe(
      Effect.mapError((cause) => new DriverError({ message: `read ${configPath}: ${String(cause)}`, cause })),
    );
    return yield* parseCaseConfig(source, configPath);
  }).pipe(
    Effect.mapError((cause) => new DriverError({ message: cause.message, cause })),
  );
}

/**
 * Whether a case belongs to a selection keyword.
 *
 * A keyword names a whole family of groups, not one exact string: `--group
 * tuning` selects `tuning` and `tuning-cuda` alike, the same way one display
 * family renders both. Anything finer — a single case, a cross-cutting
 * concern — is what the grader tags are for. The match is exact or on the
 * `-` boundary, so `tuning` never selects a hypothetical `tuningX`.
 */
export function matchesSelectionKeyword(
  group: string,
  tags: readonly string[],
  keyword: string,
): boolean {
  return group === keyword || group.startsWith(`${keyword}-`) || tags.includes(keyword);
}

/** Load all case configs, optionally filtered by a selection keyword (a group
 * family name or a grader tag, so `tflops` assembles every case carrying that
 * tag) and/or case id. */
export function loadCases(
  root: string,
  options?: { group?: string; caseId?: string },
): Effect.Effect<readonly EvalCase[], DriverError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const dirs = yield* listCaseDirs(root);
    const loaded = yield* Effect.forEach(dirs, (dir) => loadCase(root, dir));
    const group = options?.group;
    const caseId = options?.caseId;
    let filtered = loaded;
    if (group !== undefined) {
      filtered = filtered.filter((kase) =>
        matchesSelectionKeyword(kase.group, kase.tags.map((tag) => tag.tag), group));
    }
    if (caseId !== undefined) filtered = filtered.filter((kase) => kase.id === caseId);
    return filtered;
  });
}
