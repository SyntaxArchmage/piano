import { isAbsolute, relative, sep } from "node:path";

/** Whether `child` is `parent` or lives below it. `relative` resolves both
 * sides itself, so a relative, `.`-bearing or `..`-bearing input cannot
 * smuggle an escape past the callers that use this as a safety check; a NUL
 * byte fails the same way. Pass `includeEqual: false` at the sites that must
 * treat `parent` itself as outside — the run directory nested in its own
 * source workspace, for instance. */
export function pathWithin(parent: string, child: string, includeEqual = true): boolean {
  const childRelative = relative(parent, child);
  if (childRelative === "") return includeEqual;
  // Only the whole `..` segment leaves the parent: a directory called
  // `..cache` is a child like any other, and reading it as an escape would
  // both skip the protected names inside it and reject legitimate snapshots.
  const escapes = childRelative === ".." || childRelative.startsWith(`..${sep}`);
  return !escapes && !isAbsolute(childRelative) && !childRelative.includes("\0");
}
