import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { dirname } from "node:path";
import { evalMetricsPath } from "@piano/base";
import { z } from "zod";
import {
  TrajectoryReadError,
  TrajectoryRecordError,
  type TrajectoryStreamDescriptor,
} from "./types.js";

function detail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function streamPath(runDir: string, descriptor: TrajectoryStreamDescriptor): string {
  return evalMetricsPath(runDir, descriptor.path);
}

export function appendRecord<T>(
  runDir: string,
  descriptor: TrajectoryStreamDescriptor,
  schema: z.ZodType<T>,
  value: T,
): Effect.Effect<void, TrajectoryRecordError, FileSystem.FileSystem> {
  const path = streamPath(runDir, descriptor);
  return Effect.gen(function* () {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      return yield* Effect.fail(new TrajectoryRecordError(
        path,
        `invalid ${descriptor.schema} record: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
      ));
    }
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.makeDirectory(dirname(path), { recursive: true }).pipe(
      Effect.mapError((cause) => new TrajectoryRecordError(path, `mkdir: ${detail(cause)}`)),
    );
    yield* fileSystem.writeFileString(path, `${JSON.stringify(parsed.data)}\n`, { flag: "a" }).pipe(
      Effect.mapError((cause) => new TrajectoryRecordError(path, `append: ${detail(cause)}`)),
    );
  });
}

export function readRecords<T>(
  runDir: string,
  descriptor: TrajectoryStreamDescriptor,
  schema: z.ZodType<T>,
): Effect.Effect<readonly T[], TrajectoryReadError, FileSystem.FileSystem> {
  const path = streamPath(runDir, descriptor);
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const exists = yield* fileSystem.exists(path).pipe(
      Effect.mapError((cause) => new TrajectoryReadError(path, `exists: ${detail(cause)}`)),
    );
    if (!exists) return [];
    const source = yield* fileSystem.readFileString(path).pipe(
      Effect.mapError((cause) => new TrajectoryReadError(path, `read: ${detail(cause)}`)),
    );
    const records: T[] = [];
    for (const [index, line] of source.split("\n").entries()) {
      if (line.trim() === "") continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch (cause) {
        return yield* Effect.fail(new TrajectoryReadError(path, `line ${index + 1} is not JSON: ${detail(cause)}`));
      }
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        return yield* Effect.fail(new TrajectoryReadError(
          path,
          `line ${index + 1} is not ${descriptor.schema}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
        ));
      }
      records.push(parsed.data);
    }
    return records;
  });
}
