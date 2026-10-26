/** Domain-neutral validation for paths that cross the workspace boundary. */
import { sep } from "node:path";

type WorkspaceRelativePathViolation = "empty" | "blank" | "nul" | "absolute" | "segment";

const workspacePathSeparator = sep === "\\" ? /[\\/]/u : /\//u;
const windowsDrivePath = /^[A-Za-z]:/u;

/** Return the first reason `path` is unsafe as a workspace-relative path. */
export function workspaceRelativePathViolation(path: string): WorkspaceRelativePathViolation | undefined {
  if (path.length === 0) return "empty";
  if (path.includes("\0")) return "nul";
  if (path.trim() === "") return "blank";
  if (path.startsWith("/") || (sep === "\\" && path.startsWith("\\")) ||
    (sep === "\\" && windowsDrivePath.test(path))) return "absolute";
  if (path.split(workspacePathSeparator).some((segment) => segment === "" || segment === "." || segment === "..")) return "segment";
  return undefined;
}

/** Shared boolean boundary for worker projections and orchestrator winner
 * commits. Callers retain ownership of error messages. */
export function isUnsafeWorkspaceRelativePath(path: string): boolean {
  return workspaceRelativePathViolation(path) !== undefined;
}
