import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { writeFileAtomic } from "@piano/base";
import { workflowError } from "../../packages/orchestrator/src/errors.js";

const mapError = (path: string) => (cause: unknown) => workflowError("schedule", path, String(cause));
const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer)));
const runEither = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.runPromise(Effect.either(effect).pipe(Effect.provide(NodeFileSystem.layer)));

describe("writeFileAtomic", () => {
  it("replaces the target and leaves no staging file behind", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-atomic-"));
    try {
      const path = join(root, "value.json");
      await writeFile(path, "previous\n", "utf8");
      await run(writeFileAtomic(path, "next\n", {
        temporaryPath: () => `${path}.tmp`,
        mapError: mapError(path),
      }));
      expect(await readFile(path, "utf8")).toBe("next\n");
      expect(await readdir(root)).toEqual(["value.json"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  /** Whatever ends the write, the staging file must not outlive it: a failure
   * that leaves a half-written file behind is the case the cleanup exists for. */
  it("cleans the staging file up when the rename fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-atomic-fail-"));
    try {
      const path = join(root, "value.json");
      await mkdir(path);
      const result = await runEither(writeFileAtomic(path, "next\n", {
        temporaryPath: () => `${path}.tmp`,
        mapError: mapError(path),
      }));
      expect(result._tag).toBe("Left");
      expect(await readdir(root)).toEqual(["value.json"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a staging path that is the target, keeping the file intact", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-atomic-same-"));
    try {
      const path = join(root, "value.json");
      await writeFile(path, "previous\n", "utf8");
      const result = await runEither(writeFileAtomic(path, "next\n", {
        temporaryPath: () => path,
        mapError: mapError(path),
      }));
      expect(result).toMatchObject({ _tag: "Left" });
      expect(await readFile(path, "utf8")).toBe("previous\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
