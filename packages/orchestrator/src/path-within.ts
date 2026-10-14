import { isAbsolute, relative, resolve } from "node:path";

/** Whether `child` is `parent` or lives below it. Both sides are resolved
 * before the comparison, so a relative, `.`-bearing or `..`-bearing input
 * cannot smuggle an escape past the callers that use this as a safety check;
 * a NUL byte fails the same way. Pass `includeEqual: false` at the sites that
 * must treat `parent` itself as outside — the run directory nested in its own
 * source workspace, for instance. */
export function pathWithin(parent: string, child: string, includeEqual = true): boolean {
  const childRelative = relative(resolve(parent), resolve(child));
  if (childRelative === "") return includeEqual;
  return !childRelative.startsWith("..") && !isAbsolute(childRelative) && !childRelative.includes("\0");
}
