// The io module is the only place Piano touches node:fs/child_process/fetch.
// These tests pin the adapter contract: typed IoError, exists semantics, BOM
// preservation, no-follow reads, and non-zero exit handling.
import { mkdtemp, rm, symlink, writeFile as writeFileRaw } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { io } from "../src/index.js";

async function root(): Promise<string> {
  return mkdtemp(join(tmpdir(), "piano-io-"));
}

describe("io", () => {
  it("reads and writes UTF-8 text without stripping a BOM", async () => {
    const dir = await root();
    try {
      const path = join(dir, "bom.txt");
      await writeFileRaw(path, "﻿hello", "utf8");
      await expect(Effect.runPromise(io.readText(path))).resolves.toBe("﻿hello");
      await Effect.runPromise(io.writeFile(join(dir, "out.txt"), "world"));
      await expect(Effect.runPromise(io.readText(join(dir, "out.txt")))).resolves.toBe("world");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a missing path as false and a failed read as IoError", async () => {
    const dir = await root();
    try {
      await expect(Effect.runPromise(io.exists(join(dir, "missing")))).resolves.toBe(false);
      const failure = await Effect.runPromise(Effect.flip(io.readText(join(dir, "missing"))));
      expect(failure).toMatchObject({ _tag: "IoError", operation: "readFile" });
      expect(io.isMissingPathError(failure.cause)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses to read through a final symlink", async () => {
    const dir = await root();
    try {
      const target = join(dir, "target.txt");
      const link = join(dir, "link.txt");
      await writeFileRaw(target, "secret", "utf8");
      await symlink(target, link);
      const failure = await Effect.runPromise(Effect.flip(io.readFileNoFollow(link)));
      expect(failure._tag).toBe("IoError");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("treats a non-zero exit as failure or data by function", async () => {
    const failed = await Effect.runPromise(Effect.flip(io.execFile("bash", ["-lc", "echo boom >&2; exit 3"])));
    expect(failed).toMatchObject({ _tag: "IoError", operation: "execFile" });
    const result = await Effect.runPromise(io.execFileResult("bash", ["-lc", "echo boom >&2; exit 3"]));
    expect(result).toMatchObject({ code: 3, stderr: "boom\n" });
    await expect(Effect.runPromise(io.execFile("bash", ["-lc", "echo ok"]))).resolves.toMatchObject({ code: 0, stdout: "ok\n" });
  });

  it("starts a detached process and exposes its pid", async () => {
    const child = await Effect.runPromise(io.spawnDetached(process.execPath, ["-e", "setTimeout(() => {}, 5000)"]));
    expect(child.pid).toBeGreaterThan(0);
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      // The child already exited.
    }
  });
});

describe("io.runShell", () => {
  it("returns a non-zero exit as data and captures output", async () => {
    const result = await Effect.runPromise(io.runShell("echo ok; echo bad >&2; exit 2", process.cwd()));
    expect(result).toMatchObject({ code: 2, stdout: "ok\n", stderr: "bad\n" });
  });
});
