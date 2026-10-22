import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { clearAllCommand } from "../../packages/cli/src/clear.js";

describe("piano clear-all command ", () => {
  let root: string;
  const staleRun = "20200101T000000-aaaa1111";
  const recentRun = "20260823T000000-bbbb2222";

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T20:00:00.000Z"));
    root = await mkdtemp(join(tmpdir(), "piano-clear-all-command-"));
    for (const id of [staleRun, recentRun]) {
      const runDir = join(root, id);
      await mkdir(runDir, { recursive: true });
      await mkdir(join(runDir, "system-log"), { recursive: true });
      await writeFile(join(runDir, "system-log", "log.jsonl"), "{}\n", "utf8");
    }
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it("removes runs older than the requested window and keeps recent ones", async () => {
    await Effect.runPromise(clearAllCommand(["--days", "1", "--force"], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));

    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(root);
    expect(entries).toContain(recentRun);
    expect(entries).not.toContain(staleRun);
  });

  it("keeps directories with non-calendar run timestamps", async () => {
    const malformedRun = "20200132T000000-cccc3333";
    await mkdir(join(root, malformedRun), { recursive: true });

    await Effect.runPromise(clearAllCommand(["--days", "1", "--force"], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));

    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(root);
    expect(entries).toContain(malformedRun);
    expect(entries).not.toContain(staleRun);
  });

  it("reports no-op when nothing is stale", async () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await Effect.runPromise(clearAllCommand(["--days", "36500", "--force"], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
      expect(out).toHaveBeenCalledWith(expect.stringContaining("no stale runs"));
    } finally {
      out.mockRestore();
    }
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(root)).toHaveLength(2);
  });

  it("refuses non-interactive removal without --force when there are stale runs", async () => {
    const exit = await Effect.runPromiseExit(clearAllCommand(["--days", "1"], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
    expect(exit._tag).toBe("Failure");
  });

  it("rejects --days and --hours together", async () => {
    const exit = await Effect.runPromiseExit(clearAllCommand(["--days", "1", "--hours", "2"], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      expect(exit.cause.error._tag).toBe("CliArgumentError");
    }
  });
});
