import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
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

  it("keeps the permissions an existing target already had", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-atomic-mode-"));
    try {
      const path = join(root, "value.json");
      await writeFile(path, "previous\n", "utf8");
      await chmod(path, 0o600);
      await run(writeFileAtomic(path, "next\n", {
        temporaryPath: () => `${path}.tmp`,
        mapError: mapError(path),
      }));
      expect(await readFile(path, "utf8")).toBe("next\n");
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("replaces a symlink itself, taking no mode from its target", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-atomic-link-"));
    try {
      const real = join(root, "real.json");
      const link = join(root, "link.json");
      await writeFile(real, "target\n", "utf8");
      await chmod(real, 0o600);
      await symlink(real, link);
      await run(writeFileAtomic(link, "next\n", {
        temporaryPath: () => `${link}.tmp`,
        mapError: mapError(link),
      }));
      expect((await lstat(link)).isSymbolicLink()).toBe(false);
      expect(await readFile(link, "utf8")).toBe("next\n");
      expect(await readFile(real, "utf8")).toBe("target\n");
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
