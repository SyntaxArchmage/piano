import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { basename, join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";
import {
  allocateMapWorkspace,
  applyWinnerWorkspace,
  applyWorkspaceChangeSet,
  cleanupMapWorkspaces,
  freezeWorkspaceBaseline,
  prepareMapLaneFork,
  workspaceBaselineChanges,
  workspaceRefName,
} from "../../packages/orchestrator/src/index.js";
import {
  diffWorkspaceLstat,
  inventoryWorkspaceLstat,
  restoreWorkspaceLstat,
  snapshotWorkspaceLstat,
} from "../../packages/orchestrator/src/workspace.js";

const execFileAsync = promisify(execFile);

async function sessionFor(root: string, runRoot: string) {
  return Effect.runPromise(
    createSession({ root: runRoot, cwd: root, runsRoot: join(runRoot, "runs") }).pipe(
      Effect.provide(NodeFileSystem.layer),
    ),
  );
}

function runEffect<A>(
  session: Awaited<ReturnType<typeof sessionFor>>,
  effect: Effect.Effect<A, unknown, Logging | import("@effect/platform").FileSystem.FileSystem>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(
    Effect.provideService(Logging, loggingService(session.log, session.trace)),
    Effect.provide(NodeFileSystem.layer),
  ));
}

describe(" workspace lifecycle", () => {
  it("prefers a lane branch worktree for a clean repository and cleans its metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-git-workspace-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-git-run-"));
    try {
      await execFileAsync("git", ["init", "-q", root]);
      await execFileAsync("git", ["-C", root, "config", "user.email", "piano-tests@example.invalid"]);
      await execFileAsync("git", ["-C", root, "config", "user.name", "Piano Tests"]);
      await writeFile(join(root, "kernel.py"), "baseline\n");
      await execFileAsync("git", ["-C", root, "add", "kernel.py"]);
      await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "baseline"]);
      const session = await sessionFor(root, runRoot);
      const binding = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "git-clean",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
        { mnemonic: "test" },));
      const record = JSON.parse(await readFile(binding.recordPath!, "utf8")) as { strategy: string; phase: string };
      expect(record).toMatchObject({ strategy: "git-worktree", phase: "allocated" });
      await expect(readFile(join(binding.cwd, "kernel.py"), "utf8")).resolves.toBe("baseline\n");

      await runEffect(session, cleanupMapWorkspaces(session.runDir, { sourceCwd: root }));
      await expect(stat(binding.cwd)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(binding.recordPath!)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("applies a selected dirty/non-Git lane back to the source and supports explicit recovery preservation", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-snapshot-workspace-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-snapshot-run-"));
    try {
      await writeFile(join(root, "kernel.py"), "baseline\n");
      const session = await sessionFor(root, runRoot);
      const binding = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "snapshot",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
        { mnemonic: "test" },));
      expect(JSON.parse(await readFile(binding.recordPath!, "utf8"))).toMatchObject({ strategy: "store-worktree" });
      await rm(join(binding.cwd, "kernel.py"));
      await writeFile(join(binding.cwd, "winner.py"), "selected\n");

      // Reallocation is the recovery path: it rebinds the same lane.
      const rebound = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "snapshot",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
        { mnemonic: "test" },));
      expect(rebound.cwd).toBe(binding.cwd);
      await runEffect(session, applyWinnerWorkspace(session.runDir, binding.key, root));
      await runEffect(session, cleanupMapWorkspaces(session.runDir, { sourceCwd: root }));
      await expect(readFile(join(root, "winner.py"), "utf8")).resolves.toBe("selected\n");
      await expect(stat(join(root, "kernel.py"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(binding.cwd)).rejects.toMatchObject({ code: "ENOENT" });

      const preserved = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "preserve",
        1, [{ kind: "map", regionId: "tournament", slot: 1 }],
        root,
        { mnemonic: "test" },));
      await runEffect(session, cleanupMapWorkspaces(session.runDir, { sourceCwd: root, preserve: true }));
      expect(JSON.parse(await readFile(preserved.recordPath!, "utf8"))).toMatchObject({ phase: "preserved" });
      expect((await stat(preserved.cwd)).isDirectory()).toBe(true);
      await runEffect(session, cleanupMapWorkspaces(session.runDir, { sourceCwd: root }));
      await expect(stat(preserved.cwd)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("refuses a store-lane carry when the parent changed a winner path after the fork", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-store-conflict-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-store-conflict-run-"));
    try {
      await writeFile(join(root, "kernel.py"), "baseline\n");
      await writeFile(join(root, "untouched.txt"), "parent\n");
      const session = await sessionFor(root, runRoot);
      const binding = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "store-conflict",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
        { mnemonic: "test" },));
      expect(binding.strategy).toBe("store-worktree");
      // The winner edits kernel.py; the user edits the same file mid-run.
      await writeFile(join(binding.cwd, "kernel.py"), "winner\n");
      await writeFile(join(binding.cwd, "winner-only.txt"), "winner\n");
      await writeFile(join(root, "kernel.py"), "parent edit\n");

      const applied = await runEffect(session, applyWinnerWorkspace(session.runDir, binding.key, root));
      expect(applied.method).toBe("delta-applied");
      expect(applied.skipped?.reason).toMatch(/changed after branch allocation at: kernel\.py/u);
      // Neither side is clobbered: the parent keeps its edit and the winner's
      // work stays in its slot for recovery.
      await expect(readFile(join(root, "kernel.py"), "utf8")).resolves.toBe("parent edit\n");
      await expect(stat(join(root, "winner-only.txt"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(binding.cwd, "winner-only.txt"), "utf8")).resolves.toBe("winner\n");
      await expect(readFile(join(root, "untouched.txt"), "utf8")).resolves.toBe("parent\n");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: "the slot directory",
      replace: async (cwd: string, outside: string) => {
        await rm(cwd, { recursive: true, force: true });
        await symlink(outside, cwd);
      },
    },
    {
      label: "a slot ancestor",
      replace: async (cwd: string, outside: string) => {
        const slots = join(cwd, "..");
        await rm(slots, { recursive: true, force: true });
        await symlink(outside, slots);
      },
    },
  ])("rejects symlink substitution of $label during allocation reuse, recovery, and apply", async ({ replace }) => {
    const root = await mkdtemp(join(tmpdir(), "piano-slot-substitution-root-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-slot-substitution-run-"));
    const outside = await mkdtemp(join(tmpdir(), "piano-slot-substitution-outside-"));
    try {
      await writeFile(join(root, "source.txt"), "source\n");
      const session = await sessionFor(root, runRoot);
      const binding = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "slot-substitution",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
        { mnemonic: "test" },));
      await replace(binding.cwd, outside);

      await expect(runEffect(session, allocateMapWorkspace(
        session.runDir,
        "slot-substitution",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
        { mnemonic: "test" },))).rejects.toThrow(/symlink|substitution|realpath/u);
      await expect(runEffect(session, applyWinnerWorkspace(session.runDir, binding.key, root)))
        .rejects.toThrow(/symlink|substitution|realpath/u);
      await expect(readFile(join(root, "source.txt"), "utf8")).resolves.toBe("source\n");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("keeps the existing-record missing-slot error during allocation reuse", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-slot-missing-root-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-slot-missing-run-"));
    try {
      const session = await sessionFor(root, runRoot);
      const binding = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "slot-missing",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
        { mnemonic: "test" },));
      await rm(binding.cwd, { recursive: true, force: true });

      await expect(runEffect(session, allocateMapWorkspace(
        session.runDir,
        "slot-missing",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
        { mnemonic: "test" },))).rejects.toThrow(/workspace slot .* is missing at/u);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("preserves an internal file symlink when allocating a store worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-internal-link-source-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-internal-link-run-"));
    try {
      await writeFile(join(root, "target.txt"), "target\n");
      await symlink("target.txt", join(root, "link.txt"));
      const session = await sessionFor(root, runRoot);
      const binding = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "internal-link",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
        { mnemonic: "test" },));

      expect(binding.strategy).toBe("store-worktree");
      expect((await lstat(join(binding.cwd, "link.txt"))).isSymbolicLink()).toBe(true);
      await expect(readlink(join(binding.cwd, "link.txt"))).resolves.toMatch(/target\.txt$/u);
      await expect(readFile(join(binding.cwd, "target.txt"), "utf8")).resolves.toBe("target\n");

      await runEffect(session, applyWinnerWorkspace(session.runDir, binding.key, root));
      expect((await lstat(join(root, "link.txt"))).isSymbolicLink()).toBe(true);
      await expect(readlink(join(root, "link.txt"))).resolves.toBe("target.txt");
      await runEffect(session, cleanupMapWorkspaces(session.runDir, { sourceCwd: root }));
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("rejects a FIFO during store-worktree allocation without opening or blocking on it", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-fifo-source-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-fifo-run-"));
    try {
      await writeFile(join(root, "source.txt"), "source\n");
      await execFileAsync("mkfifo", [join(root, "worker.pipe")]);
      const session = await sessionFor(root, runRoot);

      await expect(runEffect(session, allocateMapWorkspace(
        session.runDir,
        "fifo-source",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
        { mnemonic: "test" },))).rejects.toThrow(/unsupported filesystem node/u);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: "symlink",
      replace: async (runDir: string, outside: string) => symlink(outside, runDir),
    },
    {
      label: "ordinary file",
      replace: async (runDir: string, _outside: string) => writeFile(runDir, "replacement\n"),
    },
  ])("fails closed when the final runDir node is replaced by a $label", async ({ replace }) => {
    const root = await mkdtemp(join(tmpdir(), "piano-run-root-replacement-source-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-run-root-replacement-parent-"));
    const outside = await mkdtemp(join(tmpdir(), "piano-run-root-replacement-outside-"));
    try {
      await writeFile(join(root, "source.txt"), "source\n");
      await writeFile(join(outside, "sentinel.txt"), "must remain untouched\n");
      const session = await sessionFor(root, runRoot);
      await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "run-root-replacement",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
        { mnemonic: "test" },));
      await rm(session.runDir, { recursive: true, force: true });
      await replace(session.runDir, outside);

      const options = { sourceCwd: root };
      await expect(runEffect(session, cleanupMapWorkspaces(session.runDir, options)))
        .rejects.toThrow(/run directory|symlink|non-directory|realpath/u);
      await expect(runEffect(session, allocateMapWorkspace(
        session.runDir,
        "run-root-replacement",
        1, [{ kind: "map", regionId: "other", slot: 1 }],
        root,
        { mnemonic: "test" },))).rejects.toThrow(/run directory|symlink|non-directory|realpath/u);

      await expect(readFile(join(outside, "sentinel.txt"), "utf8")).resolves.toBe("must remain untouched\n");
      await expect(stat(join(outside, "workspaces"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("validates and cleans only explicitly selected workspace records", async () => {
    const firstRoot = await mkdtemp(join(tmpdir(), "piano-scoped-cleanup-a-"));
    const secondRoot = await mkdtemp(join(tmpdir(), "piano-scoped-cleanup-b-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-scoped-cleanup-run-"));
    try {
      await writeFile(join(firstRoot, "source.txt"), "first\n");
      await writeFile(join(secondRoot, "source.txt"), "second\n");
      const session = await sessionFor(firstRoot, runRoot);
      const first = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "scoped-cleanup",
        1, [{ kind: "map", regionId: "first", slot: 0 }],
        firstRoot,
        { mnemonic: "test" },));
      const second = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "scoped-cleanup",
        1, [{ kind: "map", regionId: "second", slot: 0 }],
        secondRoot,
        { mnemonic: "test" },));

      await runEffect(session, cleanupMapWorkspaces(session.runDir, {
        sourceCwd: firstRoot,
        keys: [first.key],
      }));
      await expect(stat(first.cwd)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(first.recordPath!)).rejects.toMatchObject({ code: "ENOENT" });
      expect((await stat(second.cwd)).isDirectory()).toBe(true);

      await runEffect(session, cleanupMapWorkspaces(session.runDir, {
        sourceCwd: secondRoot,
        keys: [second.key],
      }));
    } finally {
      await rm(firstRoot, { recursive: true, force: true });
      await rm(secondRoot, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("scopes the run-end cleanup to one job's slot keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-job-scoped-cleanup-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-job-scoped-cleanup-run-"));
    try {
      await writeFile(join(root, "source.txt"), "source\n");
      const session = await sessionFor(root, runRoot);
      const first = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "job-scoped-cleanup",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
        { mnemonic: "test" },));
      const second = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "job-scoped-cleanup",
        2, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
        { mnemonic: "test" },));

      await runEffect(session, cleanupMapWorkspaces(session.runDir, {
        sourceCwd: root,
        keyPrefix: "job-1/",
      }));
      await expect(stat(first.cwd)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(first.recordPath!)).rejects.toMatchObject({ code: "ENOENT" });
      // The other job's slot stays active: a paused job keeps it so its
      // continue can rebind instead of finding it deleted.
      expect(JSON.parse(await readFile(second.recordPath!, "utf8"))).toMatchObject({ key: second.key, phase: "allocated" });
      expect((await stat(second.cwd)).isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("fast-forwards a winning git-worktree slot commit onto the source HEAD instead of content-copying", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-git-winner-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-git-winner-run-"));
    try {
      await execFileAsync("git", ["init", "-q", root]);
      await execFileAsync("git", ["-C", root, "config", "user.email", "piano-tests@example.invalid"]);
      await execFileAsync("git", ["-C", root, "config", "user.name", "Piano Tests"]);
      await writeFile(join(root, "kernel.py"), "baseline\n");
      await execFileAsync("git", ["-C", root, "add", "kernel.py"]);
      await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "baseline"]);
      const baseHead = (await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" })).stdout.trim();

      const session = await sessionFor(root, runRoot);
      const slotA = await runEffect(session, allocateMapWorkspace(
        session.runDir, "git-winner-run",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }], root,
        { mnemonic: "test" },));
      const slotB = await runEffect(session, allocateMapWorkspace(
        session.runDir, "git-winner-run",
        1, [{ kind: "map", regionId: "tournament", slot: 1 }], root,
        { mnemonic: "test" },));
      expect(JSON.parse(await readFile(slotA.recordPath!, "utf8"))).toMatchObject({ strategy: "git-worktree" });

      // Each slot edits its own lane worktree; slot B is the winner.
      await writeFile(join(slotA.cwd, "kernel.py"), "loser-a\n");
      await writeFile(join(slotB.cwd, "kernel.py"), "WINNER\n");

      const applied = await runEffect(session, applyWinnerWorkspace(session.runDir, slotB.key, root));
      expect(applied.method).toBe("git-ff");
      await runEffect(session, cleanupMapWorkspaces(session.runDir, { sourceCwd: root }));

      // The source HEAD advanced by ONE fast-forward and now holds the winner.
      expect(applied.commit).toBeDefined();
      expect(applied.commit).not.toBe(baseHead);
      await expect(readFile(join(root, "kernel.py"), "utf8")).resolves.toBe("WINNER\n");
      const newHead = (await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" })).stdout.trim();
      expect(newHead).toBe(applied.commit);
      // The winner commit still exists and is a descendant of the base.
      expect((await execFileAsync("git", ["-C", root, "rev-list", "--count", `${applied.commit}^{}..${applied.commit}`], { encoding: "utf8" })).stdout.trim())
        .toBeDefined();
      // The winner's commit lives on its lane branch, which survives cleanup.
      const winnerBranch = "tuna/test/lane-1";
      expect((await execFileAsync("git", ["-C", root, "rev-parse", winnerBranch], { encoding: "utf8" })).stdout.trim())
        .toBe(applied.commit);
      // The losing lane keeps its own branch, checkpointed with its edits.
      const loserTip = (await execFileAsync("git", ["-C", root, "rev-parse", "--verify", "refs/heads/tuna/test/lane-0"], { encoding: "utf8" })).stdout.trim();
      expect(loserTip).not.toBe(baseHead);
      expect((await execFileAsync("git", ["-C", root, "show", `${loserTip}:kernel.py`], { encoding: "utf8" })).stdout).toBe("loser-a\n");

      // Losing slot A never reached the source.
      await expect(readFile(join(root, "kernel.py"), "utf8")).resolves.toBe("WINNER\n");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("keeps a git slot recoverable when its worktree metadata is broken", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-git-cleanup-failure-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-git-cleanup-failure-run-"));
    try {
      await execFileAsync("git", ["init", "-q", root]);
      await execFileAsync("git", ["-C", root, "config", "user.email", "piano-tests@example.invalid"]);
      await execFileAsync("git", ["-C", root, "config", "user.name", "Piano Tests"]);
      await writeFile(join(root, "source.txt"), "source\n");
      await execFileAsync("git", ["-C", root, "add", "source.txt"]);
      await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "baseline"]);
      const session = await sessionFor(root, runRoot);
      const binding = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "git-cleanup-failure",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
        { mnemonic: "test" },));
      // Drop the repository's admin entry for the worktree while leaving the
      // lane and its pointer intact: removal then fails, but the slot must
      // stay recoverable rather than being half-deleted.
      await rm(join(root, ".git", "worktrees", basename(binding.cwd)), { recursive: true, force: true });

      await expect(runEffect(session, cleanupMapWorkspaces(session.runDir, { sourceCwd: root })))
        .rejects.toThrow(/not checked out on its lane branch|git worktree cleanup failed/u);
      await expect(stat(binding.cwd)).resolves.toMatchObject({});
      expect(JSON.parse(await readFile(binding.recordPath!, "utf8"))).toMatchObject({
        phase: "cleaning",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("rejects a git record whose root is not bound to the source common repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-git-root-binding-source-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-git-root-binding-run-"));
    const foreign = await mkdtemp(join(tmpdir(), "piano-git-root-binding-foreign-"));
    try {
      await execFileAsync("git", ["init", "-q", root]);
      await execFileAsync("git", ["-C", root, "config", "user.email", "piano-tests@example.invalid"]);
      await execFileAsync("git", ["-C", root, "config", "user.name", "Piano Tests"]);
      await writeFile(join(root, "source.txt"), "source\n");
      await execFileAsync("git", ["-C", root, "add", "source.txt"]);
      await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "baseline"]);
      await execFileAsync("git", ["init", "-q", foreign]);

      const session = await sessionFor(root, runRoot);
      const binding = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "git-root-binding",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
        { mnemonic: "test" },));
      // Rewrite both the pointer and the record so ownership still holds, but
      // the named repository is no longer the source's common root.
      await mkdir(join(foreign, ".git", "worktrees"), { recursive: true });
      await writeFile(join(binding.cwd, ".git"), `gitdir: ${join(foreign, ".git", "worktrees", "forged")}\n`);
      const record = JSON.parse(await readFile(binding.recordPath!, "utf8")) as Record<string, unknown>;
      await writeFile(binding.recordPath!, `${JSON.stringify({ ...record, gitRoot: foreign }, null, 2)}\n`);

      await expect(runEffect(session, cleanupMapWorkspaces(session.runDir, { sourceCwd: root })))
        .rejects.toThrow(/not checked out on its lane branch|does not match source Git common root/u);
      await expect(stat(binding.cwd)).resolves.toMatchObject({});
      expect(JSON.parse(await readFile(binding.recordPath!, "utf8"))).toMatchObject({ phase: "cleaning" });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
      await rm(foreign, { recursive: true, force: true });
    }
  });

  it("does not preserve a slot replaced by a symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-preserve-slot-source-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-preserve-slot-run-"));
    const outside = await mkdtemp(join(tmpdir(), "piano-preserve-slot-outside-"));
    try {
      await writeFile(join(root, "source.txt"), "source\n");
      await writeFile(join(outside, "must-remain.txt"), "outside\n");
      const session = await sessionFor(root, runRoot);
      const binding = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "preserve-slot-substitution",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
        { mnemonic: "test" },));
      await rm(binding.cwd, { recursive: true, force: true });
      await symlink(outside, binding.cwd);

      await expect(runEffect(session, cleanupMapWorkspaces(session.runDir, {
        sourceCwd: root,
        preserve: true,
      }))).rejects.toThrow(/symlink|substitution|realpath/u);
      await expect(readFile(join(outside, "must-remain.txt"), "utf8")).resolves.toBe("outside\n");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("does not preserve a slot replaced by another ordinary directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-preserve-ordinary-slot-source-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-preserve-ordinary-slot-run-"));
    try {
      await writeFile(join(root, "source.txt"), "source\n");
      const session = await sessionFor(root, runRoot);
      const binding = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "preserve-ordinary-slot-substitution",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
        { mnemonic: "test" },));
      await rm(binding.cwd, { recursive: true, force: true });
      await mkdir(binding.cwd);
      await writeFile(join(binding.cwd, "attacker.txt"), "not run-owned\n");

      await expect(runEffect(session, cleanupMapWorkspaces(session.runDir, {
        sourceCwd: root,
        preserve: true,
      }))).rejects.toThrow(/run-owned|allocated directory|identity marker/u);
      await expect(readFile(join(binding.cwd, "attacker.txt"), "utf8")).resolves.toBe("not run-owned\n");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("rejects a replacement whose forged worktree pointer is outside the owning repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-preserve-marker-slot-source-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-preserve-marker-slot-run-"));
    const outside = await mkdtemp(join(tmpdir(), "piano-preserve-marker-outside-"));
    try {
      await writeFile(join(root, "source.txt"), "source\n");
      const session = await sessionFor(root, runRoot);
      const binding = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "preserve-marker-substitution",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
        { mnemonic: "test" },));
      await rm(binding.cwd, { recursive: true, force: true });
      await mkdir(binding.cwd);
      await writeFile(join(binding.cwd, "attacker.txt"), "not run-owned\n");
      await writeFile(join(binding.cwd, ".git"), `gitdir: ${outside}\n`);

      await expect(runEffect(session, cleanupMapWorkspaces(session.runDir, {
        sourceCwd: root,
        preserve: true,
      }))).rejects.toThrow(/does not belong/u);
      await expect(readFile(join(binding.cwd, "attacker.txt"), "utf8")).resolves.toBe("not run-owned\n");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("requires every apply record to name the declared source workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-source-binding-root-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-source-binding-run-"));
    try {
      await writeFile(join(root, "source.txt"), "source\n");
      const session = await sessionFor(root, runRoot);
      const first = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "source-binding",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
        { mnemonic: "test" },));
      const second = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "source-binding",
        1, [{ kind: "map", regionId: "tournament", slot: 1 }],
        root,
        { mnemonic: "test" },));
      const record = JSON.parse(await readFile(first.recordPath!, "utf8")) as Record<string, unknown>;
      await writeFile(first.recordPath!, `${JSON.stringify({ ...record, sourceCwd: second.cwd }, null, 2)}\n`);

      await expect(runEffect(session, applyWinnerWorkspace(session.runDir, first.key, root)))
        .rejects.toThrow(/different source workspace/u);
      await expect(readFile(join(root, "source.txt"), "utf8")).resolves.toBe("source\n");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("keeps the winner on its lane branch when the source advanced past the fork", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-git-nonfastforward-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-git-nonfastforward-run-"));
    try {
      await execFileAsync("git", ["init", "-q", root]);
      await execFileAsync("git", ["-C", root, "config", "user.email", "piano-tests@example.invalid"]);
      await execFileAsync("git", ["-C", root, "config", "user.name", "Piano Tests"]);
      await writeFile(join(root, "source.txt"), "source\n");
      await execFileAsync("git", ["-C", root, "add", "source.txt"]);
      await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "baseline"]);
      const session = await sessionFor(root, runRoot);
      const binding = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "git-nonfastforward",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,

        { mnemonic: "test" },));
      await writeFile(join(binding.cwd, "source.txt"), "winner\n");
      // The user keeps working on the source branch while the lane runs.
      await writeFile(join(root, "unrelated.txt"), "user edit\n");
      await execFileAsync("git", ["-C", root, "add", "unrelated.txt"]);
      await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "user progress"]);

      const applied = await runEffect(session, applyWinnerWorkspace(session.runDir, binding.key, root));
      expect(applied.skipped).toBeDefined();
      // The winner's work is safe on its lane branch even though it did not land.
      expect((await execFileAsync("git", ["-C", root, "rev-parse", "tuna/test/lane-0"], { encoding: "utf8" })).stdout.trim())
        .toBe(applied.commit);
      await expect(readFile(join(root, "source.txt"), "utf8")).resolves.toBe("source\n");
      await runEffect(session, cleanupMapWorkspaces(session.runDir, { sourceCwd: root }));
      await expect(stat(binding.cwd)).rejects.toMatchObject({ code: "ENOENT" });
      // Cleanup removes the worktree but keeps the lane branch.
      expect((await execFileAsync("git", ["-C", root, "rev-parse", "tuna/test/lane-0"], { encoding: "utf8" })).stdout.trim())
        .toBe(applied.commit);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("seeds one commit of unsaved content and forks every lane from it", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-dirty-source-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-dirty-source-run-"));
    try {
      await execFileAsync("git", ["init", "-q", root]);
      await execFileAsync("git", ["-C", root, "config", "user.email", "piano-tests@example.invalid"]);
      await execFileAsync("git", ["-C", root, "config", "user.name", "Piano Tests"]);
      await writeFile(join(root, "tracked.txt"), "committed\n");
      await execFileAsync("git", ["-C", root, "add", "tracked.txt"]);
      await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "baseline"]);
      const baseHead = (await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" })).stdout.trim();
      // Unsaved edits and an untracked file must still reach every lane.
      await writeFile(join(root, "tracked.txt"), "unsaved\n");
      await writeFile(join(root, "untracked.txt"), "untracked\n");

      const session = await sessionFor(root, runRoot);
      const frames = [{ kind: "map" as const, regionId: "tournament", slot: 0 }];
      const fork = await prepareMapLaneFork(root, {
        runDir: session.runDir,
        runId: "dirty",
        jobOrdinal: 1,
        frames,
      });
      expect(fork.strategy).toBe("git-worktree");
      expect(fork.sourceBranch).toBe(
        (await execFileAsync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8" })).stdout.trim(),
      );
      const first = await runEffect(session, allocateMapWorkspace(
        session.runDir, "dirty",
        1, frames, root,

        { mnemonic: "test", fork },));
      const second = await runEffect(session, allocateMapWorkspace(
        session.runDir, "dirty",
        1, [{ kind: "map", regionId: "tournament", slot: 1 }], root,

        { mnemonic: "test", fork },));

      await expect(readFile(join(first.cwd, "tracked.txt"), "utf8")).resolves.toBe("unsaved\n");
      await expect(readFile(join(second.cwd, "untracked.txt"), "utf8")).resolves.toBe("untracked\n");
      // The user's branch and index are untouched; the seed is only reachable
      // through the lane branches.
      expect((await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" })).stdout.trim()).toBe(baseHead);
      const firstRecord = JSON.parse(await readFile(first.recordPath!, "utf8")) as { baseCommit: string; laneBranch: string };
      const secondRecord = JSON.parse(await readFile(second.recordPath!, "utf8")) as { baseCommit: string };
      expect(firstRecord.baseCommit).toBe(secondRecord.baseCommit);
      expect(firstRecord.baseCommit).not.toBe(baseHead);
      await execFileAsync("git", ["-C", root, "merge-base", "--is-ancestor", baseHead, firstRecord.baseCommit]);
      expect(firstRecord.laneBranch).toBe("tuna/test/lane-0");
      expect((await execFileAsync("git", ["-C", root, "rev-parse", firstRecord.laneBranch], { encoding: "utf8" })).stdout.trim())
        .toBe(firstRecord.baseCommit);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("keeps lane numbers monotonic while every branch survives cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-lane-numbers-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-lane-numbers-run-"));
    try {
      await execFileAsync("git", ["init", "-q", root]);
      await execFileAsync("git", ["-C", root, "config", "user.email", "piano-tests@example.invalid"]);
      await execFileAsync("git", ["-C", root, "config", "user.name", "Piano Tests"]);
      await writeFile(join(root, "source.txt"), "source\n");
      await execFileAsync("git", ["-C", root, "add", "source.txt"]);
      await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "baseline"]);
      const session = await sessionFor(root, runRoot);

      const branches: string[] = [];
      for (const slot of [0, 1, 2]) {
        const binding = await runEffect(session, allocateMapWorkspace(
          session.runDir, "lane-numbers",
          1, [{ kind: "map", regionId: "tournament", slot }], root,

          { mnemonic: "test" },));
        branches.push((JSON.parse(await readFile(binding.recordPath!, "utf8")) as { laneBranch: string }).laneBranch);
        await runEffect(session, cleanupMapWorkspaces(session.runDir, { sourceCwd: root, keys: [binding.key] }));
      }
      expect(branches).toEqual(["tuna/test/lane-0", "tuna/test/lane-1", "tuna/test/lane-2"]);
      // Cleanup removed every worktree but kept every branch.
      for (const branch of branches) {
        await execFileAsync("git", ["-C", root, "rev-parse", "--verify", `refs/heads/${branch}`]);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("refuses to fork from an unborn branch or a detached HEAD", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-unforkable-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-unforkable-run-"));
    try {
      await execFileAsync("git", ["init", "-q", root]);
      await execFileAsync("git", ["-C", root, "config", "user.email", "piano-tests@example.invalid"]);
      await execFileAsync("git", ["-C", root, "config", "user.name", "Piano Tests"]);
      const session = await sessionFor(root, runRoot);
      const options = { mnemonic: "test" };
      await expect(runEffect(session, allocateMapWorkspace(
        session.runDir, "unforkable",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }], root,
        options,
      ))).rejects.toThrow(/no commits to fork/u);

      await writeFile(join(root, "source.txt"), "source\n");
      await execFileAsync("git", ["-C", root, "add", "source.txt"]);
      await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "baseline"]);
      await execFileAsync("git", ["-C", root, "checkout", "-q", "--detach", "HEAD"]);
      await expect(runEffect(session, allocateMapWorkspace(
        session.runDir, "unforkable",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }], root,
        options,
      ))).rejects.toThrow(/HEAD is detached/u);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("does not carry onto a different branch than the one the lane forked from", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-git-branch-switch-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-git-branch-switch-run-"));
    try {
      await execFileAsync("git", ["init", "-q", root]);
      await execFileAsync("git", ["-C", root, "config", "user.email", "piano-tests@example.invalid"]);
      await execFileAsync("git", ["-C", root, "config", "user.name", "Piano Tests"]);
      await writeFile(join(root, "source.txt"), "source\n");
      await execFileAsync("git", ["-C", root, "add", "source.txt"]);
      await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "baseline"]);
      const session = await sessionFor(root, runRoot);
      const binding = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "git-branch-switch",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,

        { mnemonic: "test" },));
      await writeFile(join(binding.cwd, "source.txt"), "winner\n");
      // The user switches branches mid-run.
      await execFileAsync("git", ["-C", root, "checkout", "-q", "-b", "other"]);

      const applied = await runEffect(session, applyWinnerWorkspace(session.runDir, binding.key, root));
      expect(applied.skipped?.reason).toMatch(/no longer checked out/u);
      await expect(readFile(join(root, "source.txt"), "utf8")).resolves.toBe("source\n");
      expect((await execFileAsync("git", ["-C", root, "rev-parse", "tuna/test/lane-0"], { encoding: "utf8" })).stdout.trim())
        .toBe(applied.commit);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });
});

describe("workspace snapshot and rollback", () => {
  it("preserves an internal file symlink through snapshot, change, and rollback", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-symlink-root-"));
    const runDir = await mkdtemp(join(tmpdir(), "piano-symlink-run-"));
    const before = await mkdtemp(join(tmpdir(), "piano-symlink-before-"));
    await rm(before, { recursive: true, force: true });
    try {
      await writeFile(join(root, "target.txt"), "target\n");
      await chmod(join(root, "target.txt"), 0o755);
      await symlink("target.txt", join(root, "link.txt"));

      await snapshotWorkspaceLstat(root, before);
      expect((await lstat(join(before, "link.txt"))).isSymbolicLink()).toBe(true);
      await expect(readlink(join(before, "link.txt"))).resolves.toBe("target.txt");
      expect((await lstat(join(before, "target.txt"))).mode & 0o111).toBe(0o111);
      const baseline = await freezeWorkspaceBaseline(root, { runDir, refName: workspaceRefName("test", "baselines/symlink") });

      await rm(join(root, "link.txt"));
      await writeFile(join(root, "other.txt"), "other\n");
      await symlink("other.txt", join(root, "link.txt"));
      await writeFile(join(root, "target.txt"), "changed\n");
      const changes = await workspaceBaselineChanges(baseline, root);
      expect(changes).toEqual([
        { path: "link.txt", kind: "modified" },
        { path: "other.txt", kind: "added" },
        { path: "target.txt", kind: "modified" },
      ]);

      await restoreWorkspaceLstat(root, before, changes);
      expect((await lstat(join(root, "link.txt"))).isSymbolicLink()).toBe(true);
      await expect(readlink(join(root, "link.txt"))).resolves.toBe("target.txt");
      await expect(readFile(join(root, "target.txt"), "utf8")).resolves.toBe("target\n");
      expect((await lstat(join(root, "target.txt"))).mode & 0o111).toBe(0o111);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runDir, { recursive: true, force: true });
      await rm(before, { recursive: true, force: true });
    }
  });

  it("fails closed before snapshotting an external file symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-symlink-external-root-"));
    const outside = await mkdtemp(join(tmpdir(), "piano-symlink-external-target-"));
    const snapshot = await mkdtemp(join(tmpdir(), "piano-symlink-external-snapshot-"));
    await rm(snapshot, { recursive: true, force: true });
    try {
      await writeFile(join(outside, "secret.txt"), "outside\n");
      await symlink(join(outside, "secret.txt"), join(root, "link.txt"));

      await expect(snapshotWorkspaceLstat(root, snapshot)).rejects.toThrow(/external content/);
      await expect(stat(snapshot)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
      await rm(snapshot, { recursive: true, force: true });
    }
  });

  it("fails closed before freezing an absolute internal file symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-symlink-absolute-root-"));
    const snapshot = await mkdtemp(join(tmpdir(), "piano-symlink-absolute-snapshot-"));
    await rm(snapshot, { recursive: true, force: true });
    try {
      await writeFile(join(root, "target.txt"), "live source\n");
      await symlink(join(root, "target.txt"), join(root, "link.txt"));

      await expect(snapshotWorkspaceLstat(root, snapshot)).rejects.toThrow(/absolute symlink targets/);
      await expect(lstat(join(snapshot, "link.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(snapshot, { recursive: true, force: true });
    }
  });

  it("keeps the exact rollback snapshot strict for special nodes", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-snapshot-special-root-"));
    const snapshot = await mkdtemp(join(tmpdir(), "piano-snapshot-special-snapshot-"));
    await rm(snapshot, { recursive: true, force: true });
    try {
      await execFileAsync("mkfifo", [join(root, "worker.pipe")]);

      await expect(snapshotWorkspaceLstat(root, snapshot)).rejects.toThrow(/unsupported filesystem node/u);
      await expect(stat(snapshot)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(snapshot, { recursive: true, force: true });
    }
  });

  it("keeps the strict gate closed but rolls back external/directory symlinks and FIFOs from an lstat diff", async () => {
    const baseline = await mkdtemp(join(tmpdir(), "piano-lstat-baseline-"));
    const candidate = await mkdtemp(join(tmpdir(), "piano-lstat-candidate-"));
    const outside = await mkdtemp(join(tmpdir(), "piano-lstat-outside-"));
    const strictSnapshot = join(tmpdir(), `piano-lstat-strict-${process.pid}-${Date.now()}`);
    try {
      await writeFile(join(baseline, "keep.txt"), "baseline\n");
      await mkdir(join(baseline, "nested"), { recursive: true });
      await writeFile(join(baseline, "nested", "keep.txt"), "nested baseline\n");
      await rm(candidate, { recursive: true, force: true });
      await snapshotWorkspaceLstat(baseline, candidate);
      await writeFile(join(outside, "secret.txt"), "must remain outside\n");
      await mkdir(join(outside, "directory"), { recursive: true });
      await writeFile(join(outside, "directory", "secret.txt"), "must remain outside\n");
      await symlink(join(outside, "secret.txt"), join(candidate, "external-file.link"));
      await symlink(join(outside, "directory"), join(candidate, "external-directory.link"));
      await rm(join(candidate, "nested"), { recursive: true, force: true });
      await symlink(join(outside, "directory"), join(candidate, "nested"));
      const fifo = join(candidate, "worker.pipe");
      await execFileAsync("mkfifo", [fifo]);

      await expect(snapshotWorkspaceLstat(candidate, strictSnapshot)).rejects.toThrow();

      const inventory = await inventoryWorkspaceLstat(candidate);
      expect(inventory).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "external-file.link", kind: "symlink" }),
        expect.objectContaining({ path: "external-directory.link", kind: "symlink" }),
        expect.objectContaining({ path: "worker.pipe", kind: "fifo" }),
      ]));
      expect(inventory.some((entry) => entry.path.startsWith("external-directory.link/"))).toBe(false);

      const changes = await diffWorkspaceLstat(baseline, candidate);
      expect(changes).toEqual([
        { path: "external-directory.link", kind: "added" },
        { path: "external-file.link", kind: "added" },
        { path: "nested", kind: "modified" },
        { path: "nested/keep.txt", kind: "deleted" },
        { path: "worker.pipe", kind: "added" },
      ]);

      await restoreWorkspaceLstat(candidate, baseline, changes);
      await expect(diffWorkspaceLstat(baseline, candidate)).resolves.toEqual([]);
      await expect(readFile(join(candidate, "keep.txt"), "utf8")).resolves.toBe("baseline\n");
      await expect(readFile(join(candidate, "nested", "keep.txt"), "utf8")).resolves.toBe("nested baseline\n");
      await expect(readFile(join(outside, "secret.txt"), "utf8")).resolves.toBe("must remain outside\n");
      await expect(readFile(join(outside, "directory", "secret.txt"), "utf8")).resolves.toBe("must remain outside\n");
    } finally {
      await rm(baseline, { recursive: true, force: true });
      await rm(candidate, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
      await rm(strictSnapshot, { recursive: true, force: true });
    }
  });

  it.each([
    { kind: "external symlink", replace: async (path: string, outside: string) => symlink(join(outside, "directory"), path) },
    { kind: "FIFO", replace: async (path: string) => execFileAsync("mkfifo", [path]) },
  ])("restores a baseline directory replaced by an $kind without removing through it", async ({ replace }) => {
    const baseline = await mkdtemp(join(tmpdir(), "piano-lstat-parent-baseline-"));
    const candidate = await mkdtemp(join(tmpdir(), "piano-lstat-parent-candidate-"));
    const outside = await mkdtemp(join(tmpdir(), "piano-lstat-parent-outside-"));
    try {
      await mkdir(join(baseline, "nested"), { recursive: true });
      await writeFile(join(baseline, "nested", "keep.txt"), "baseline\n");
      await mkdir(join(outside, "directory"), { recursive: true });
      await writeFile(join(outside, "directory", "must-remain.txt"), "outside\n");
      await rm(candidate, { recursive: true, force: true });
      await snapshotWorkspaceLstat(baseline, candidate);

      await rm(join(candidate, "nested"), { recursive: true, force: true });
      await replace(join(candidate, "nested"), outside);

      const changes = await diffWorkspaceLstat(baseline, candidate);
      expect(changes).toEqual([
        { path: "nested", kind: "modified" },
        { path: "nested/keep.txt", kind: "deleted" },
      ]);

      await restoreWorkspaceLstat(candidate, baseline, changes);
      await expect(readFile(join(candidate, "nested", "keep.txt"), "utf8")).resolves.toBe("baseline\n");
      await expect(readFile(join(outside, "directory", "must-remain.txt"), "utf8")).resolves.toBe("outside\n");
      await expect(diffWorkspaceLstat(baseline, candidate)).resolves.toEqual([]);
    } finally {
      await rm(baseline, { recursive: true, force: true });
      await rm(candidate, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("preserves an excluded run subtree while rollback ignores it in both diffs", async () => {
    const source = await mkdtemp(join(tmpdir(), "piano-lstat-excluded-source-"));
    const baseline = await mkdtemp(join(tmpdir(), "piano-lstat-excluded-baseline-"));
    const runDir = join(source, "runs", "session", ".piano-run");
    try {
      await writeFile(join(source, "app.txt"), "baseline\n");
      await mkdir(join(runDir, "evidence"), { recursive: true });
      await writeFile(join(runDir, "evidence", "trace.ndjson"), "run-owned evidence\n");
      await rm(baseline, { recursive: true, force: true });
      await snapshotWorkspaceLstat(source, baseline, [runDir]);

      await writeFile(join(source, "app.txt"), "candidate\n");
      await expect(diffWorkspaceLstat(baseline, source, [runDir])).resolves.toEqual([
        { path: "app.txt", kind: "modified" },
      ]);

      await restoreWorkspaceLstat(source, baseline, undefined, [runDir]);
      await expect(readFile(join(source, "app.txt"), "utf8")).resolves.toBe("baseline\n");
      await expect(readFile(join(runDir, "evidence", "trace.ndjson"), "utf8")).resolves.toBe("run-owned evidence\n");
      await expect(diffWorkspaceLstat(baseline, source, [runDir])).resolves.toEqual([]);
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(baseline, { recursive: true, force: true });
    }
  });

  it("restores empty directories and complete lstat modes exactly", async () => {
    const source = await mkdtemp(join(tmpdir(), "piano-lstat-modes-source-"));
    const baseline = await mkdtemp(join(tmpdir(), "piano-lstat-modes-baseline-"));
    await rm(baseline, { recursive: true, force: true });
    try {
      await chmod(source, 0o750);
      await mkdir(join(source, "empty"));
      await chmod(join(source, "empty"), 0o1750);
      await mkdir(join(source, "mode-dir"));
      await chmod(join(source, "mode-dir"), 0o1730);
      await snapshotWorkspaceLstat(source, baseline);

      await rm(join(source, "empty"), { recursive: true, force: true });
      await chmod(join(source, "mode-dir"), 0o700);
      await chmod(source, 0o700);

      const changes = await diffWorkspaceLstat(baseline, source);
      expect(changes).toEqual([
        { path: "", kind: "modified" },
        { path: "empty", kind: "deleted" },
        { path: "mode-dir", kind: "modified" },
      ]);
      await restoreWorkspaceLstat(source, baseline, changes);

      expect((await lstat(join(source, "empty"))).mode & 0o7777).toBe(0o1750);
      expect((await lstat(join(source, "mode-dir"))).mode & 0o7777).toBe(0o1730);
      expect((await lstat(source)).mode & 0o7777).toBe(0o750);
      await expect(diffWorkspaceLstat(baseline, source)).resolves.toEqual([]);
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(baseline, { recursive: true, force: true });
    }
  });

  it("records and restores regular-file to symlink type changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-symlink-type-root-"));
    const runDir = await mkdtemp(join(tmpdir(), "piano-symlink-type-run-"));
    const beforeFile = await mkdtemp(join(tmpdir(), "piano-symlink-type-before-file-"));
    const beforeLink = await mkdtemp(join(tmpdir(), "piano-symlink-type-before-link-"));
    await rm(beforeFile, { recursive: true, force: true });
    await rm(beforeLink, { recursive: true, force: true });
    try {
      await writeFile(join(root, "target.txt"), "target\n");
      await writeFile(join(root, "entry.txt"), "file\n");
      await chmod(join(root, "entry.txt"), 0o755);
      await snapshotWorkspaceLstat(root, beforeFile);
      const fileBaseline = await freezeWorkspaceBaseline(root, { runDir, refName: workspaceRefName("test", "baselines/as-file") });

      await rm(join(root, "entry.txt"));
      await symlink("target.txt", join(root, "entry.txt"));
      expect(await workspaceBaselineChanges(fileBaseline, root)).toContainEqual({ path: "entry.txt", kind: "modified" });
      await restoreWorkspaceLstat(root, beforeFile, [{ path: "entry.txt", kind: "modified" }]);
      expect((await lstat(join(root, "entry.txt"))).isFile()).toBe(true);
      expect((await lstat(join(root, "entry.txt"))).mode & 0o111).toBe(0o111);

      await rm(join(root, "entry.txt"));
      await symlink("target.txt", join(root, "entry.txt"));
      await snapshotWorkspaceLstat(root, beforeLink);
      const linkBaseline = await freezeWorkspaceBaseline(root, { runDir, refName: workspaceRefName("test", "baselines/as-link") });
      await rm(join(root, "entry.txt"));
      await writeFile(join(root, "entry.txt"), "replacement\n");
      expect(await workspaceBaselineChanges(linkBaseline, root)).toContainEqual({ path: "entry.txt", kind: "modified" });
      await restoreWorkspaceLstat(root, beforeLink, [{ path: "entry.txt", kind: "modified" }]);
      expect((await lstat(join(root, "entry.txt"))).isSymbolicLink()).toBe(true);
      await expect(readlink(join(root, "entry.txt"))).resolves.toBe("target.txt");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runDir, { recursive: true, force: true });
      await rm(beforeFile, { recursive: true, force: true });
      await rm(beforeLink, { recursive: true, force: true });
    }
  });

  it("rejects traversal and absolute rollback paths before mutating anything", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-rollback-safe-root-"));
    const before = await mkdtemp(join(tmpdir(), "piano-rollback-safe-before-"));
    const outside = await mkdtemp(join(tmpdir(), "piano-rollback-safe-outside-"));
    try {
      await writeFile(join(root, "keep.txt"), "keep\n");
      await writeFile(join(outside, "escape.txt"), "outside\n");
      await expect(restoreWorkspaceLstat(root, before, [{ path: "../escape.txt", kind: "added" }]))
        .rejects.toThrow(/unsafe workspace rollback path|escapes/u);
      await expect(restoreWorkspaceLstat(root, before, [{ path: join(outside, "escape.txt"), kind: "added" }]))
        .rejects.toThrow(/unsafe workspace rollback path|escapes/u);
      await expect(readFile(join(root, "keep.txt"), "utf8")).resolves.toBe("keep\n");
      await expect(readFile(join(outside, "escape.txt"), "utf8")).resolves.toBe("outside\n");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(before, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects rollback paths with symlink ancestors", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-rollback-link-root-"));
    const before = await mkdtemp(join(tmpdir(), "piano-rollback-link-before-"));
    const outside = await mkdtemp(join(tmpdir(), "piano-rollback-link-outside-"));
    try {
      await mkdir(join(before, "nested"));
      await writeFile(join(before, "nested", "file.txt"), "baseline\n");
      await writeFile(join(outside, "file.txt"), "outside\n");
      await symlink(outside, join(root, "nested"));

      await expect(restoreWorkspaceLstat(root, before, [{ path: "nested/file.txt", kind: "modified" }]))
        .rejects.toThrow(/symlink|ancestor/u);
      await expect(readFile(join(outside, "file.txt"), "utf8")).resolves.toBe("outside\n");
      await expect(readlink(join(root, "nested"))).resolves.toBe(outside);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(before, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("workspace baselines as commits", () => {
  it("freezes once per ref and answers the delta from the commit", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-baseline-run-"));
    const source = await mkdtemp(join(tmpdir(), "piano-baseline-source-"));
    try {
      await writeFile(join(source, "kept.txt"), "same\n");
      await writeFile(join(source, "edited.txt"), "before\n");
      await writeFile(join(source, "gone.txt"), "bye\n");
      const refName = workspaceRefName("exec-1", "baselines/job-1/root%2Ffanout");
      const first = await freezeWorkspaceBaseline(source, { runDir, refName, excludeUnder: [runDir] });
      const again = await freezeWorkspaceBaseline(source, { runDir, refName, excludeUnder: [runDir] });
      expect(again.commit).toBe(first.commit);

      await writeFile(join(source, "edited.txt"), "after\n");
      await rm(join(source, "gone.txt"));
      await writeFile(join(source, "new.txt"), "hi\n");
      await expect(workspaceBaselineChanges(first, source)).resolves.toEqual([
        { path: "edited.txt", kind: "modified" },
        { path: "gone.txt", kind: "deleted" },
        { path: "new.txt", kind: "added" },
      ]);
    } finally {
      await rm(runDir, { recursive: true, force: true });
      await rm(source, { recursive: true, force: true });
    }
  });

  it("applies only the winner delta and leaves the parent's unrelated files and run directory alone", async () => {
    const source = await mkdtemp(join(tmpdir(), "piano-delta-apply-"));
    const winner = await mkdtemp(join(tmpdir(), "piano-delta-winner-"));
    const runDir = join(source, "run");
    await mkdir(runDir, { recursive: true });
    try {
      await writeFile(join(source, "winner.txt"), "before\n");
      await writeFile(join(source, "kept.txt"), "same\n");
      await writeFile(join(source, "gone.txt"), "delete me\n");
      await writeFile(join(runDir, "evidence.txt"), "run state\n");
      const baseline = await freezeWorkspaceBaseline(source, {
        runDir,
        refName: workspaceRefName("exec-1", "baselines/job-1/root"),
        excludeUnder: [runDir],
      });

      // The winner slot changes two files and deletes a third; everything else
      // in the source is a parent file the carry must not touch.
      await writeFile(join(winner, "winner.txt"), "after\n");
      await writeFile(join(winner, "kept.txt"), "same\n");
      await writeFile(join(winner, "fresh.txt"), "new\n");
      const changes = await workspaceBaselineChanges(baseline, winner, [runDir]);
      expect(changes).toEqual([
        { path: "fresh.txt", kind: "added" },
        { path: "gone.txt", kind: "deleted" },
        { path: "winner.txt", kind: "modified" },
      ]);

      await applyWorkspaceChangeSet(source, { winnerContentDir: winner, changes }, [runDir]);

      await expect(readFile(join(source, "winner.txt"), "utf8")).resolves.toBe("after\n");
      await expect(readFile(join(source, "fresh.txt"), "utf8")).resolves.toBe("new\n");
      await expect(stat(join(source, "gone.txt"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(source, "kept.txt"), "utf8")).resolves.toBe("same\n");
      // The run's own evidence is excluded from the delta on both sides.
      await expect(readFile(join(runDir, "evidence.txt"), "utf8")).resolves.toBe("run state\n");
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(winner, { recursive: true, force: true });
    }
  });

  it("restores the pre-apply tree when a delta path cannot be written", async () => {
    if (process.getuid?.() === 0) return; // root bypasses the directory mode
    const source = await mkdtemp(join(tmpdir(), "piano-delta-rollback-"));
    const winner = await mkdtemp(join(tmpdir(), "piano-delta-rollback-winner-"));
    const blocked = join(source, "blocked");
    try {
      await mkdir(blocked);
      await writeFile(join(blocked, "kept.txt"), "must survive\n");
      await writeFile(join(source, "a.txt"), "baseline\n");
      await writeFile(join(winner, "a.txt"), "winner\n");
      await mkdir(join(winner, "blocked"), { recursive: true });
      await writeFile(join(winner, "blocked", "new.txt"), "cannot land\n");
      // Make the parent directory refuse the copy, then apply: the first
      // change lands and the second fails, so the rollback must undo the first.
      await chmod(blocked, 0o500);

      await expect(applyWorkspaceChangeSet(source, {
        winnerContentDir: winner,
        changes: [
          { path: "a.txt", kind: "modified" },
          { path: "blocked/new.txt", kind: "added" },
        ],
      })).rejects.toThrow();

      await expect(readFile(join(source, "a.txt"), "utf8")).resolves.toBe("baseline\n");
      await expect(readFile(join(blocked, "kept.txt"), "utf8")).resolves.toBe("must survive\n");
      await expect(stat(join(blocked, "new.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await chmod(blocked, 0o700).catch(() => undefined);
      await rm(source, { recursive: true, force: true });
      await rm(winner, { recursive: true, force: true });
    }
  });

  it("keeps a POSIX backslash filename verbatim in the delta", async () => {
    if (process.platform === "win32") return;
    const runDir = await mkdtemp(join(tmpdir(), "piano-baseline-backslash-"));
    const source = await mkdtemp(join(tmpdir(), "piano-baseline-backslash-source-"));
    const filename = "dir\\file.txt";
    try {
      await writeFile(join(source, filename), "before\n");
      const baseline = await freezeWorkspaceBaseline(source, {
        runDir,
        refName: workspaceRefName("test", "baselines/backslash"),
      });
      await writeFile(join(source, filename), "after\n");
      await expect(workspaceBaselineChanges(baseline, source)).resolves.toEqual([
        { path: filename, kind: "modified" },
      ]);
    } finally {
      await rm(runDir, { recursive: true, force: true });
      await rm(source, { recursive: true, force: true });
    }
  });

  it("always ignores infrastructure names", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-baseline-protected-"));
    const source = await mkdtemp(join(tmpdir(), "piano-baseline-protected-source-"));
    try {
      await writeFile(join(source, "app.txt"), "app\n");
      const baseline = await freezeWorkspaceBaseline(source, {
        runDir,
        refName: workspaceRefName("test", "baselines/protected"),
      });
      await writeFile(join(source, ".git"), "ignored\n");
      await writeFile(join(source, ".piano-run.lock"), "ignored\n");
      await expect(workspaceBaselineChanges(baseline, source)).resolves.toEqual([]);
    } finally {
      await rm(runDir, { recursive: true, force: true });
      await rm(source, { recursive: true, force: true });
    }
  });

  it("scans a winner nested under the run directory even when that run is excluded", async () => {
    const source = await mkdtemp(join(tmpdir(), "piano-baseline-nested-winner-"));
    const runDir = join(source, "runs", "exec");
    const winnerDir = join(runDir, "workspaces", "worktree-slot");
    await mkdir(winnerDir, { recursive: true });
    try {
      await writeFile(join(winnerDir, "kernel.py"), "winner\n");
      const baseline = await freezeWorkspaceBaseline(winnerDir, {
        runDir,
        refName: workspaceRefName("test", "baselines/nested-winner"),
      });
      await writeFile(join(winnerDir, "kernel.py"), "edited\n");
      await expect(workspaceBaselineChanges(baseline, winnerDir, [runDir])).resolves.toEqual([
        { path: "kernel.py", kind: "modified" },
      ]);
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  });

  it("refuses content the workspace walk refuses", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-baseline-external-"));
    const outside = await mkdtemp(join(tmpdir(), "piano-baseline-outside-"));
    const source = await mkdtemp(join(tmpdir(), "piano-baseline-link-"));
    try {
      await writeFile(join(outside, "secret.txt"), "outside\n");
      await symlink(join(outside, "secret.txt"), join(source, "escape.txt"));
      await expect(freezeWorkspaceBaseline(source, {
        runDir,
        refName: workspaceRefName("exec-1", "baselines/job-1/root"),
        excludeUnder: [runDir],
      })).rejects.toThrow(/symlink targets excluded or external content/u);
    } finally {
      await rm(runDir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
      await rm(source, { recursive: true, force: true });
    }
  });
});
