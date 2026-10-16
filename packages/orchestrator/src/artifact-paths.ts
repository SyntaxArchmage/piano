// Where a write may go: resolving artifact references to workspace paths,
// and preflighting a target against the real filesystem boundary (symlinks,
// aliases, nearest existing ancestor) before anything is written.
//
// Extracted verbatim from workflow-execution.ts; its users are the GPU-round
// materialization and, through it, the stage runner — the executor itself
// imports forward, so the dependency stays one-way.

import { FileSystem } from "@effect/platform";
import { Effect, Either } from "effect";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isUnsafeWorkspaceRelativePath } from "@piano/contract";
import { errorMessage, workflowError, type WorkflowError } from "./errors.js";
import { pathWithin } from "./path-within.js";
import type { WorkflowWorkspaceBinding } from "./workspace.js";

export function workspaceArtifactPath(
  workspace: WorkflowWorkspaceBinding,
  value: unknown,
  label: string,
  sourcePath: string,
): Effect.Effect<string, WorkflowError> {
  if (typeof value !== "string" || value.trim() === "") {
    return Effect.fail(workflowError("schedule", sourcePath, `${label} must be a non-empty artifact path`));
  }
  // Artifact references are a portable protocol, even when the current host
  // is POSIX. Do not let Windows-looking separators or drive prefixes become
  // ordinary POSIX filenames here; generic workspace filenames retain their
  // native platform semantics elsewhere.
  if (value.includes("\\") || /^[A-Za-z]:/u.test(value)) {
    return Effect.fail(workflowError(
      "schedule",
      sourcePath,
      `${label} must be a safe workspace-relative artifact path`,
    ));
  }
  if (isUnsafeWorkspaceRelativePath(value)) {
    return Effect.fail(workflowError(
      "schedule",
      sourcePath,
      `${label} must be a safe workspace-relative artifact path`,
    ));
  }
  const candidate = resolve(workspace.cwd, value);
  const rel = relative(resolve(workspace.cwd), candidate);
  if (rel === "" || rel === "." || rel.startsWith("..") || isAbsolute(rel)) {
    return Effect.fail(workflowError("schedule", sourcePath, `${label} must stay inside workspace ${workspace.cwd}`));
  }
  return Effect.succeed(candidate);
}

export interface PreflightPath {
  readonly path: string;
  /** Canonical identity used for alias rejection. For an absent target this
   * is the canonicalized nearest-existing-parent plus the remaining suffix. */
  readonly identity: string;
  readonly relativeRef: string;
}

export function isNotFoundFileSystemError(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null &&
    (((cause as { readonly reason?: unknown }).reason === "NotFound") ||
      ((cause as { readonly code?: unknown }).code === "ENOENT"));
}

export function isNotLinkFileSystemError(cause: unknown): boolean {
  return isNotFoundFileSystemError(cause) ||
    (typeof cause === "object" && cause !== null &&
      ((cause as { readonly description?: unknown }).description === "EINVAL" ||
        String((cause as { readonly message?: unknown }).message ?? "").includes("EINVAL")));
}

/** Validate a write target against a real filesystem boundary. This checks
 * every existing path component without following symlinks, then checks the
 * realpath of either the target or its nearest existing ancestor. */
export function preflightWritePath(
  fileSystem: FileSystem.FileSystem,
  root: string,
  target: string,
  label: string,
): Effect.Effect<PreflightPath, WorkflowError> {
  return Effect.gen(function* () {
    const rootPath = resolve(root);
    const targetPath = resolve(target);
    if (!pathWithin(rootPath, targetPath, false)) {
      return yield* Effect.fail(workflowError("schedule", targetPath, `${label} must stay inside ${rootPath}`));
    }
    const rootRealPath = yield* fileSystem.realPath(rootPath).pipe(
      Effect.mapError((cause) => workflowError("schedule", rootPath, `${label} boundary is not readable: ${errorMessage(cause)}`)),
    );
    let component = rootPath;
    const components = relative(rootPath, targetPath).split(sep).filter(Boolean);
    for (const part of components) {
      component = join(component, part);
      const link = yield* Effect.either(fileSystem.readLink(component));
      if (Either.isRight(link)) {
        return yield* Effect.fail(workflowError("schedule", targetPath, `${label} may not use a symbolic-link component: ${component}`));
      }
      if (!isNotLinkFileSystemError(link.left)) {
        return yield* Effect.fail(workflowError("schedule", targetPath, `${label} path inspection failed at ${component}: ${errorMessage(link.left)}`));
      }
      const componentStat = yield* Effect.either(fileSystem.stat(component));
      if (Either.isLeft(componentStat) && !isNotFoundFileSystemError(componentStat.left)) {
        return yield* Effect.fail(workflowError("schedule", targetPath, `${label} path inspection failed at ${component}: ${errorMessage(componentStat.left)}`));
      }
      if (Either.isRight(componentStat) && componentStat.right.type === "SymbolicLink") {
        return yield* Effect.fail(workflowError("schedule", targetPath, `${label} may not target a symbolic link: ${component}`));
      }
    }

    const targetStat = yield* Effect.either(fileSystem.stat(targetPath));
    let identity: string;
    if (Either.isRight(targetStat)) {
      if (targetStat.right.type !== "File") {
        return yield* Effect.fail(workflowError("schedule", targetPath, `${label} must be a regular file, got ${targetStat.right.type}`));
      }
      const targetRealPath = yield* fileSystem.realPath(targetPath).pipe(
        Effect.mapError((cause) => workflowError("schedule", targetPath, `${label} realpath check failed: ${errorMessage(cause)}`)),
      );
      if (!pathWithin(rootRealPath, targetRealPath, false)) {
        return yield* Effect.fail(workflowError("schedule", targetPath, `${label} resolves outside ${rootRealPath}`));
      }
      identity = targetRealPath;
    } else {
      if (!isNotFoundFileSystemError(targetStat.left)) {
        return yield* Effect.fail(workflowError("schedule", targetPath, `${label} target inspection failed: ${errorMessage(targetStat.left)}`));
      }
      let ancestor = dirname(targetPath);
      let ancestorRealPath: string | undefined;
      while (pathWithin(rootPath, ancestor, false) || resolve(ancestor) === rootPath) {
        const ancestorStat = yield* Effect.either(fileSystem.stat(ancestor));
        if (Either.isRight(ancestorStat)) {
          if (ancestorStat.right.type !== "Directory") {
            return yield* Effect.fail(workflowError("schedule", targetPath, `${label} parent ${ancestor} is not a directory`));
          }
          ancestorRealPath = yield* fileSystem.realPath(ancestor).pipe(
            Effect.mapError((cause) => workflowError("schedule", ancestor, `${label} ancestor realpath check failed: ${errorMessage(cause)}`)),
          );
          break;
        }
        if (!isNotFoundFileSystemError(ancestorStat.left)) {
          return yield* Effect.fail(workflowError("schedule", targetPath, `${label} ancestor inspection failed at ${ancestor}: ${errorMessage(ancestorStat.left)}`));
        }
        const parent = dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
      }
      if (ancestorRealPath === undefined || !pathWithin(rootRealPath, ancestorRealPath, false) && resolve(ancestorRealPath) !== resolve(rootRealPath)) {
        return yield* Effect.fail(workflowError("schedule", targetPath, `${label} nearest existing ancestor escapes ${rootRealPath}`));
      }
      identity = resolve(ancestorRealPath ?? rootRealPath, relative(ancestor, targetPath));
    }
    return {
      path: targetPath,
      identity,
      relativeRef: relative(rootPath, targetPath),
    };
  });
}

export function rejectPathAliases(
  paths: readonly { readonly label: string; readonly value: PreflightPath }[],
  sourcePath: string,
): Effect.Effect<void, WorkflowError> {
  for (let leftIndex = 0; leftIndex < paths.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < paths.length; rightIndex += 1) {
      const left = paths[leftIndex]!;
      const right = paths[rightIndex]!;
      const leftIdentity = resolve(left.value.identity);
      const rightIdentity = resolve(right.value.identity);
      const identitiesOverlap = leftIdentity === rightIdentity ||
        pathWithin(leftIdentity, rightIdentity, false) ||
        pathWithin(rightIdentity, leftIdentity, false);
      if (identitiesOverlap) {
        return Effect.fail(workflowError(
          "schedule",
          sourcePath,
          `GPU materialization rejects aliased paths: ${left.label} and ${right.label}`,
        ));
      }
    }
  }
  return Effect.succeed(undefined);
}
