import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  buildCommitMessage,
  parsePorcelainStatus,
  planLoopCommit,
  snapshotDirtyFiles,
} from "../../packages/orchestrator/src/loop-commit.js";

const execFileAsync = promisify(execFile);

describe("porcelain status parsing", () => {
  it("keeps paths exact, including spaces and pathspec metacharacters", () => {
    const stdout = [
      "?? weird[1]*?.txt",
      " M notes with spaces.md",
      "??   padded name  ",
      "R  renamed.txt",
      "old.txt",
      " R worktree.txt",
      "from.txt",
    ].join("\0") + "\0";
    expect(parsePorcelainStatus(stdout)).toEqual([
      { status: "??", path: "weird[1]*?.txt" },
      { status: " M", path: "notes with spaces.md" },
      { status: "??", path: "  padded name  " },
      { status: "R ", path: "renamed.txt", sourcePath: "old.txt" },
      { status: " R", path: "worktree.txt", sourcePath: "from.txt" },
    ]);
  });
});

describe("loop commit plan", () => {
  it("stages untracked paths by name and tracked worktree changes with -A", () => {
    expect(planLoopCommit([
      { status: "??", path: "new file.md" },
      { status: "??", path: "weird[1]*?.txt" },
      { status: " M", path: "edited.md" },
      { status: " D", path: "gone.md" },
      { status: "M ", path: "staged.md" },
      { status: "D ", path: "staged-gone.md" },
    ], new Set())).toEqual({
      add: ["new file.md", "weird[1]*?.txt"],
      update: ["edited.md", "gone.md"],
      paths: ["new file.md", "weird[1]*?.txt", "edited.md", "gone.md", "staged.md", "staged-gone.md"],
      changed: ["new file.md", "weird[1]*?.txt", "edited.md", "gone.md", "staged.md", "staged-gone.md"],
    });
  });

  it("commits both ends of a rename without restaging the missing source", () => {
    expect(planLoopCommit([
      { status: "R ", path: "renamed.md", sourcePath: "old.md" },
      { status: " R", path: "moved.md", sourcePath: "former.md" },
      { status: "RM", path: "edited-rename.md", sourcePath: "before.md" },
    ], new Set())).toEqual({
      add: ["moved.md"],
      update: [],
      paths: ["renamed.md", "old.md", "moved.md", "former.md", "edited-rename.md", "before.md"],
      changed: ["renamed.md", "moved.md", "edited-rename.md"],
    });
  });

  it("drops pre-existing dirty entries, both ends of a rename included", () => {
    expect(planLoopCommit([
      { status: "??", path: "user notes.md" },
      { status: "R ", path: "renamed.md", sourcePath: "pre-existing.md" },
      { status: " M", path: "tracked.md" },
    ], new Set(["user notes.md", "pre-existing.md", "tracked.md"]))).toEqual({
      add: [],
      update: [],
      paths: [],
      changed: [],
    });
  });

  it("drops paths that escape the workspace", () => {
    expect(planLoopCommit([
      { status: "??", path: "../outside.md" },
      { status: " M", path: "/absolute.md" },
    ], new Set())).toEqual({
      add: [],
      update: [],
      paths: [],
      changed: [],
    });
  });
});

describe("loop commit message", () => {
  it("states the operator and iteration and carries the evidence body", () => {
    expect(buildCommitMessage({
      ticket: "TR-1234",
      operator: "gemm",
      iteration: 2,
      hypothesis: "hide DTE wait",
      solution: "applied change 2",
      test: "160.50us / 2588.51 GB/s; verify passed",
    })).toEqual({
      subject: "[Feature](TR-1234): gemm R2",
      body: [
        "Root Cause:",
        "    hide DTE wait",
        "Solution:",
        "    applied change 2",
        "Test:",
        "    160.50us / 2588.51 GB/s; verify passed",
        "Impact area:",
        "    ops",
        "Fix status:",
        "    done",
      ].join("\n"),
    });
  });

  it("never truncates the iteration suffix when the operator name is long", () => {
    const message = buildCommitMessage({
      operator: "an-operator-name-that-is-much-too-long",
      iteration: 7,
      hypothesis: "why",
      solution: "what",
      test: "how",
    });
    expect(message.subject.startsWith("[Feature](no-ticket): an-operator-name")).toBe(true);
    expect(message.subject.endsWith(" R7")).toBe(true);
    expect(message.subject.length).toBeLessThanOrEqual(50);
  });
});

describe("dirty snapshot", () => {
  it("treats a non-git workspace as empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "piano-loop-snapshot-plain-"));
    try {
      await expect(Effect.runPromise(snapshotDirtyFiles(dir))).resolves.toEqual(new Set());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("includes both ends of a rename", async () => {
    const dir = await mkdtemp(join(tmpdir(), "piano-loop-snapshot-rename-"));
    try {
      await execFileAsync("git", ["-C", dir, "init", "-q", "-b", "main"], { encoding: "utf8" });
      await execFileAsync("git", ["-C", dir, "config", "user.name", "Test Agent"], { encoding: "utf8" });
      await execFileAsync("git", ["-C", dir, "config", "user.email", "agent@test.local"], { encoding: "utf8" });
      await writeFile(join(dir, "before.txt"), "content\n");
      await execFileAsync("git", ["-C", dir, "add", "before.txt"], { encoding: "utf8" });
      await execFileAsync("git", ["-C", dir, "commit", "-qm", "initial"], { encoding: "utf8" });
      await execFileAsync("git", ["-C", dir, "mv", "before.txt", "after.txt"], { encoding: "utf8" });

      const snapshot = await Effect.runPromise(snapshotDirtyFiles(dir));
      expect([...snapshot].sort()).toEqual(["after.txt", "before.txt"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails when a git workspace's status cannot be read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "piano-loop-snapshot-broken-"));
    try {
      await execFileAsync("git", ["-C", dir, "init", "-q", "-b", "main"], { encoding: "utf8" });
      await writeFile(join(dir, ".git", "index"), "corrupt\n");

      const exit = await Effect.runPromiseExit(snapshotDirtyFiles(dir));
      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) throw new Error("expected the snapshot to fail");
      expect(Cause.pretty(exit.cause)).toContain("cannot read workspace git status");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
