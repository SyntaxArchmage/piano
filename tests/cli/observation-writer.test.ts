import { describe, expect, it } from "vitest";
import type { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { observationWriter } from "../../packages/cli/src/session-run.js";

/** A file system whose appends land only when the test lets them, so "the next
 * batch waited for the one before it" is a fact rather than a timing accident.
 * Only the two calls `appendJsonlLine` makes are provided. */
function gatedFileSystem(): {
  readonly fileSystem: FileSystem.FileSystem;
  readonly issued: readonly string[];
  readonly release: () => void;
  readonly crash: () => void;
} {
  const issued: string[] = [];
  let settle: ((outcome: Effect.Effect<void>) => void) | undefined;
  const fileSystem = {
    makeDirectory: () => Effect.void,
    writeFileString: (_path: string, line: string) =>
      Effect.async<void>((resume) => {
        issued.push(line);
        settle = resume;
      }),
  } as unknown as FileSystem.FileSystem;
  const land = (outcome: Effect.Effect<void>) => {
    const pending = settle;
    settle = undefined;
    pending?.(outcome);
  };
  return {
    fileSystem,
    issued,
    release: () => land(Effect.void),
    // `Effect.ignore` already swallows a mapped failure, so the only write that
    // can poison the chain is one that defects and rejects.
    crash: () => land(Effect.die("disk")),
  };
}

/** Let the writer's promise chain run as far as it can. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("observationWriter", () => {
  it("does not issue the next batch until the one before it has landed", async () => {
    const fs = gatedFileSystem();
    const writer = observationWriter("/run/observations.jsonl", fs.fileSystem);
    writer.append("a\n");
    writer.append("b\n");
    await tick();
    expect(fs.issued).toEqual(["a\n"]);
    fs.release();
    await tick();
    expect(fs.issued).toEqual(["a\n", "b\n"]);
    fs.release();
    await writer.flush();
  });

  it("writes the next batch even after one blows up", async () => {
    const fs = gatedFileSystem();
    const writer = observationWriter("/run/observations.jsonl", fs.fileSystem);
    writer.append("a\n");
    writer.append("b\n");
    await tick();
    fs.crash();
    await tick();
    expect(fs.issued).toEqual(["a\n", "b\n"]);
    fs.release();
    await writer.flush();
  });
});
