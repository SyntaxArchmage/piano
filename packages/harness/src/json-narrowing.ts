/**
 * Lenient readers for the untrusted, JSON-shaped input every harness boundary
 * receives: a CLI's stdout line, an SDK callback's payload, a config file's
 * parsed value. Each one takes `unknown` and narrows it to a concrete type,
 * answering with `undefined` (or a fallback) when the value does not fit,
 * because a harness stream is *read* rather than validated — an unexpected
 * field must cost that one field, never the turn.
 *
 * Strict validation is `@piano/contract`'s job. What lives here is the
 * opposite discipline, and the family is kept in one place because these
 * variants are easy to confuse: `stringValue` keeps `""` while
 * `nonEmptyString` drops it, and both are correct at different call sites.
 * A reader that needs a policy of its own (trimming, sentinel rejection) keeps
 * that policy at its call site and builds on these.
 */

/** A parsed JSON object. Index reads yield `unknown`, so every field still has
 * to go through one of the readers below. */
export type JsonRecord = Record<string, unknown>;

/** An object, never an array and never `null`. */
export function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

/** Any string, the empty string included. */
export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** A string with content; `""` reads as absent, exactly like a number. */
export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** A string with content, or `fallback`. */
export function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

/** A finite number. `NaN` and `Infinity` read as absent — they cannot survive
 * a round trip through JSON, so they only ever arrive from a broken producer. */
export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A finite number, or `0`. */
export function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** The strings among an array's items, in order; every other item is dropped. */
export function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** A field that carries JSON as text — tool arguments, mostly: hand back the
 * parsed value when it parses, and the raw value when it is not text or not
 * JSON, so a producer that inlined an object is read as well as one that
 * stringified it. */
export function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
