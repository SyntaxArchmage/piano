import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join, sep } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";
import {
  allocateMapWorkspace,
  applyWinnerWorkspace,
  cleanupMapWorkspaces,
  recoverMapWorkspaces,
  diffWorkspaceContent,
} from "../../packages/orchestrator/src/index.js";
import {
  diffWorkspaceLstat,
  inventoryWorkspaceLstat,
  restoreWorkspaceChanges,
  restoreWorkspaceLstat,
  snapshotWorkspaceContent,
  workspaceContentChanges,
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
  it("prefers a detached Git worktree for a clean repository and cleans its metadata", async () => {
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
      ));
      const record = JSON.parse(await readFile(binding.recordPath!, "utf8")) as { strategy: string; status: string };
      expect(record).toMatchObject({ strategy: "git-worktree", status: "active" });
      await expect(readFile(join(binding.cwd, "kernel.py"), "utf8")).resolves.toBe("baseline\n");

      const finalized = await runEffect(session, cleanupMapWorkspaces(session.runDir, "git-clean", { sourceCwd: root }));
      expect(finalized[0]).toMatchObject({ key: "job-1/tournament/slot-0", status: "cleaned", phase: "cleaned" });
      await expect(stat(binding.cwd)).rejects.toMatchObject({ code: "ENOENT" });
      expect(JSON.parse(await readFile(binding.recordPath!, "utf8"))).toMatchObject({ status: "cleaned" });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("applies a selected dirty/non-Git snapshot back to the source and supports explicit recovery preservation", async () => {
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
      ));
      expect(JSON.parse(await readFile(binding.recordPath!, "utf8"))).toMatchObject({ strategy: "directory-snapshot" });
      await rm(join(binding.cwd, "kernel.py"));
      await writeFile(join(binding.cwd, "winner.py"), "selected\n");

      const recovered = await runEffect(session, recoverMapWorkspaces(session.runDir, "snapshot", root));
      expect(recovered).toHaveLength(1);
      expect(recovered[0]).toMatchObject({ key: "job-1/tournament/slot-0", cwd: binding.cwd });
      await runEffect(session, applyWinnerWorkspace(session.runDir, "snapshot", binding.key, root));
      await runEffect(session, cleanupMapWorkspaces(session.runDir, "snapshot", { sourceCwd: root }));
      await expect(readFile(join(root, "winner.py"), "utf8")).resolves.toBe("selected\n");
      await expect(stat(join(root, "kernel.py"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(binding.cwd)).rejects.toMatchObject({ code: "ENOENT" });

      const preserved = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "preserve",
        1, [{ kind: "map", regionId: "tournament", slot: 1 }],
        root,
      ));
      await runEffect(session, cleanupMapWorkspaces(session.runDir, "preserve", { sourceCwd: root, preserve: true }));
      expect(JSON.parse(await readFile(preserved.recordPath!, "utf8"))).toMatchObject({ status: "preserved", phase: "preserved" });
      expect((await stat(preserved.cwd)).isDirectory()).toBe(true);
      await runEffect(session, cleanupMapWorkspaces(session.runDir, "preserve", { sourceCwd: root }));
      await expect(stat(preserved.cwd)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("restores the source when applying a snapshot fails after partial deletion", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-apply-rollback-source-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-apply-rollback-run-"));
    const blocked = join(root, "blocked");
    let slotBlocked: string | undefined;
    try {
      await writeFile(join(root, "a.txt"), "baseline\n");
      await mkdir(blocked);
      await writeFile(join(blocked, "kept.txt"), "must survive\n");
      await chmod(blocked, 0o500);
      const session = await sessionFor(root, runRoot);
      const binding = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "apply-rollback",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
      ));
      slotBlocked = join(binding.cwd, "blocked");
      await writeFile(join(binding.cwd, "winner.txt"), "winner\n");

      await expect(runEffect(session, applyWinnerWorkspace(session.runDir, "apply-rollback", binding.key, root)))
        .rejects.toThrow();
      await expect(readFile(join(root, "a.txt"), "utf8")).resolves.toBe("baseline\n");
      await expect(readFile(join(blocked, "kept.txt"), "utf8")).resolves.toBe("must survive\n");
    } finally {
      await chmod(blocked, 0o700).catch(() => undefined);
      if (slotBlocked !== undefined) await chmod(slotBlocked, 0o700).catch(() => undefined);
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
      ));
      await replace(binding.cwd, outside);

      await expect(runEffect(session, allocateMapWorkspace(
        session.runDir,
        "slot-substitution",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
      ))).rejects.toThrow(/symlink|substitution|realpath/u);
      await expect(runEffect(session, recoverMapWorkspaces(session.runDir, "slot-substitution", root)))
        .rejects.toThrow(/symlink|substitution|realpath/u);
      await expect(runEffect(session, applyWinnerWorkspace(session.runDir, "slot-substitution", binding.key, root)))
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
      ));
      await rm(binding.cwd, { recursive: true, force: true });

      await expect(runEffect(session, allocateMapWorkspace(
        session.runDir,
        "slot-missing",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
      ))).rejects.toThrow(/workspace slot .* is missing at/u);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("preserves an internal file symlink when allocating a directory snapshot", async () => {
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
      ));

      expect(binding.strategy).toBe("directory-snapshot");
      expect((await lstat(join(binding.cwd, "link.txt"))).isSymbolicLink()).toBe(true);
      await expect(readlink(join(binding.cwd, "link.txt"))).resolves.toMatch(/target\.txt$/u);
      await expect(readFile(join(binding.cwd, "target.txt"), "utf8")).resolves.toBe("target\n");

      await runEffect(session, applyWinnerWorkspace(session.runDir, "internal-link", binding.key, root));
      expect((await lstat(join(root, "link.txt"))).isSymbolicLink()).toBe(true);
      await expect(readlink(join(root, "link.txt"))).resolves.toBe("target.txt");
      await runEffect(session, cleanupMapWorkspaces(session.runDir, "internal-link", { sourceCwd: root }));
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("rejects a FIFO during directory-snapshot allocation without opening or blocking on it", async () => {
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
      ))).rejects.toThrow(/unsupported filesystem node/u);
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
      ));
      await rm(session.runDir, { recursive: true, force: true });
      await replace(session.runDir, outside);

      const options = { sourceCwd: root };
      await expect(runEffect(session, recoverMapWorkspaces(session.runDir, "run-root-replacement", root)))
        .rejects.toThrow(/run directory|symlink|non-directory|realpath/u);
      await expect(runEffect(session, cleanupMapWorkspaces(session.runDir, "run-root-replacement", options)))
        .rejects.toThrow(/run directory|symlink|non-directory|realpath/u);
      await expect(runEffect(session, allocateMapWorkspace(
        session.runDir,
        "run-root-replacement",
        1, [{ kind: "map", regionId: "other", slot: 1 }],
        root,
      ))).rejects.toThrow(/run directory|symlink|non-directory|realpath/u);

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
      ));
      const second = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "scoped-cleanup",
        1, [{ kind: "map", regionId: "second", slot: 0 }],
        secondRoot,
      ));

      const cleaned = await runEffect(session, cleanupMapWorkspaces(session.runDir, "scoped-cleanup", {
        sourceCwd: firstRoot,
        keys: [first.key],
      }));
      expect(cleaned.map((record) => record.key)).toEqual([first.key]);
      await expect(stat(first.cwd)).rejects.toMatchObject({ code: "ENOENT" });
      expect((await stat(second.cwd)).isDirectory()).toBe(true);

      await runEffect(session, cleanupMapWorkspaces(session.runDir, "scoped-cleanup", {
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
      ));
      const second = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "job-scoped-cleanup",
        2, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
      ));

      const cleaned = await runEffect(session, cleanupMapWorkspaces(session.runDir, "job-scoped-cleanup", {
        sourceCwd: root,
        keyPrefix: "job-1/",
      }));
      expect(cleaned.map((record) => record.key)).toEqual([first.key]);
      await expect(stat(first.cwd)).rejects.toMatchObject({ code: "ENOENT" });
      // The other job's slot stays active: a paused job keeps it so its
      // continue can rebind instead of finding a swept tombstone.
      expect(JSON.parse(await readFile(second.recordPath!, "utf8"))).toMatchObject({ key: second.key, status: "active" });
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
      ));
      const slotB = await runEffect(session, allocateMapWorkspace(
        session.runDir, "git-winner-run",
        1, [{ kind: "map", regionId: "tournament", slot: 1 }], root,
      ));
      expect(JSON.parse(await readFile(slotA.recordPath!, "utf8"))).toMatchObject({ strategy: "git-worktree" });

      // Each slot edits its detached worktree; slot B is the winner.
      await writeFile(join(slotA.cwd, "kernel.py"), "loser-a\n");
      await writeFile(join(slotB.cwd, "kernel.py"), "WINNER\n");

      const applied = await runEffect(session, applyWinnerWorkspace(session.runDir, "git-winner-run", slotB.key, root));
      expect(applied.method).toBe("git-ff");
      await runEffect(session, cleanupMapWorkspaces(session.runDir, "git-winner-run", { sourceCwd: root }));

      // The source HEAD advanced by ONE fast-forward and now holds the winner.
      expect(applied.commit).toBeDefined();
      expect(applied.commit).not.toBe(baseHead);
      await expect(readFile(join(root, "kernel.py"), "utf8")).resolves.toBe("WINNER\n");
      const newHead = (await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" })).stdout.trim();
      expect(newHead).toBe(applied.commit);
      // The winner commit still exists and is a descendant of the base.
      expect((await execFileAsync("git", ["-C", root, "rev-list", "--count", `${applied.commit}^{}..${applied.commit}`], { encoding: "utf8" })).stdout.trim())
        .toBeDefined();
      // The winning commit is reachable via a retained piano ref.
      expect((await execFileAsync("git", ["-C", root, "for-each-ref", "refs/piano/"], { encoding: "utf8" })).stdout).toContain(applied.commit);

      // Losing slot A never reached the source.
      await expect(readFile(join(root, "kernel.py"), "utf8")).resolves.toBe("WINNER\n");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("keeps a git slot recoverable when worktree removal fails", async () => {
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
      ));
      const record = JSON.parse(await readFile(binding.recordPath!, "utf8")) as Record<string, unknown>;
      await writeFile(binding.recordPath!, `${JSON.stringify({ ...record, gitRoot: join(root, "missing-git-root") }, null, 2)}\n`);

      await expect(runEffect(session, cleanupMapWorkspaces(session.runDir, "git-cleanup-failure", { sourceCwd: root })))
        .rejects.toThrow(/git worktree cleanup failed/u);
      await expect(stat(binding.cwd)).resolves.toMatchObject({});
      expect(JSON.parse(await readFile(binding.recordPath!, "utf8"))).toMatchObject({
        status: "active",
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
      ));
      const record = JSON.parse(await readFile(binding.recordPath!, "utf8")) as Record<string, unknown>;
      await writeFile(binding.recordPath!, `${JSON.stringify({ ...record, gitRoot: foreign }, null, 2)}\n`);

      await expect(runEffect(session, cleanupMapWorkspaces(session.runDir, "git-root-binding", { sourceCwd: root })))
        .rejects.toThrow(/does not match source Git common root/u);
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
      ));
      await rm(binding.cwd, { recursive: true, force: true });
      await symlink(outside, binding.cwd);

      await expect(runEffect(session, cleanupMapWorkspaces(session.runDir, "preserve-slot-substitution", {
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
      ));
      await rm(binding.cwd, { recursive: true, force: true });
      await mkdir(binding.cwd);
      await writeFile(join(binding.cwd, "attacker.txt"), "not run-owned\n");

      await expect(runEffect(session, cleanupMapWorkspaces(session.runDir, "preserve-ordinary-slot-substitution", {
        sourceCwd: root,
        preserve: true,
      }))).rejects.toThrow(/run-owned|allocated directory|identity marker/u);
      await expect(readFile(join(binding.cwd, "attacker.txt"), "utf8")).resolves.toBe("not run-owned\n");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("rejects a replacement whose record identity matches but durable marker is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-preserve-marker-slot-source-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-preserve-marker-slot-run-"));
    try {
      await writeFile(join(root, "source.txt"), "source\n");
      const session = await sessionFor(root, runRoot);
      const binding = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "preserve-marker-substitution",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
      ));
      const record = JSON.parse(await readFile(binding.recordPath!, "utf8")) as {
        slotIdentity: { dev: number; ino: number; birthtimeMs: number; marker: string };
      };
      await rm(binding.cwd, { recursive: true, force: true });
      await mkdir(binding.cwd);
      await writeFile(join(binding.cwd, "attacker.txt"), "not run-owned\n");
      const replacement = await lstat(binding.cwd);
      record.slotIdentity = {
        ...record.slotIdentity,
        dev: replacement.dev,
        ino: replacement.ino,
        birthtimeMs: replacement.birthtimeMs,
      };
      await writeFile(binding.recordPath!, `${JSON.stringify(record, null, 2)}\n`);

      await expect(runEffect(session, cleanupMapWorkspaces(session.runDir, "preserve-marker-substitution", {
        sourceCwd: root,
        preserve: true,
      }))).rejects.toThrow(/identity marker is missing or invalid/u);
      await expect(readFile(join(binding.cwd, "attacker.txt"), "utf8")).resolves.toBe("not run-owned\n");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("requires every legacy apply record to name the declared source workspace", async () => {
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
      ));
      const second = await runEffect(session, allocateMapWorkspace(
        session.runDir,
        "source-binding",
        1, [{ kind: "map", regionId: "tournament", slot: 1 }],
        root,
      ));
      const record = JSON.parse(await readFile(first.recordPath!, "utf8")) as Record<string, unknown>;
      await writeFile(first.recordPath!, `${JSON.stringify({ ...record, sourceCwd: second.cwd }, null, 2)}\n`);

      await expect(runEffect(session, applyWinnerWorkspace(session.runDir, "source-binding", first.key, root)))
        .rejects.toThrow(/different source workspace/u);
      await expect(readFile(join(root, "source.txt"), "utf8")).resolves.toBe("source\n");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("fails winner carry when update-ref cannot retain the commit and preserves the slot", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-git-ref-failure-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-git-ref-failure-run-"));
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
        "git-ref-failure",
        1, [{ kind: "map", regionId: "tournament", slot: 0 }],
        root,
      ));
      await writeFile(join(binding.cwd, "source.txt"), "winner\n");
      await mkdir(join(root, ".git", "refs", "piano"), { recursive: true });
      await writeFile(join(root, ".git", "refs", "piano", "git-ref-failure"), "ref-path-blocker\n");

      await expect(runEffect(session, applyWinnerWorkspace(session.runDir, "git-ref-failure", binding.key, root)))
        .rejects.toThrow(/winner commit could not be retained/u);
      await expect(stat(binding.cwd)).resolves.toMatchObject({});
      await expect(runEffect(session, cleanupMapWorkspaces(session.runDir, "git-ref-failure", {
        sourceCwd: root,
        preserve: true,
      }))).resolves.toMatchObject([{ status: "preserved", phase: "preserved" }]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });
});

describe("[§6] read-only winner-content gate", () => {
  it("round-trips a POSIX backslash filename without treating it as a separator", async () => {
    if (sep === "\\") return;
    const root = await mkdtemp(join(tmpdir(), "piano-backslash-root-"));
    const before = await mkdtemp(join(tmpdir(), "piano-backslash-before-"));
    await rm(before, { recursive: true, force: true });
    const filename = "dir\\file.txt";
    try {
      await writeFile(join(root, filename), "baseline\n");
      await snapshotWorkspaceContent(root, before);
      await writeFile(join(root, filename), "changed\n");
      await expect(workspaceContentChanges(before, root)).resolves.toEqual([
        { path: filename, kind: "modified" },
      ]);
      await restoreWorkspaceChanges(root, before, [{ path: filename, kind: "modified" }]);
      await expect(readFile(join(root, filename), "utf8")).resolves.toBe("baseline\n");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(before, { recursive: true, force: true });
    }
  });

  it("does not exclude ordinary uppercase infrastructure-looking names on Linux", async () => {
    if (process.platform !== "linux") return;
    const left = await mkdtemp(join(tmpdir(), "piano-case-sensitive-left-"));
    const right = await mkdtemp(join(tmpdir(), "piano-case-sensitive-right-"));
    try {
      await writeFile(join(left, ".GIT"), "application\n");
      await writeFile(join(left, ".PIANO-RUN.LOCK"), "application\n");
      await expect(diffWorkspaceContent(left, right)).resolves.toEqual({
        equal: false,
        differing: [".GIT", ".PIANO-RUN.LOCK"],
      });
    } finally {
      await rm(left, { recursive: true, force: true });
      await rm(right, { recursive: true, force: true });
    }
  });

  it("preserves an internal file symlink through snapshot, change, and rollback", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-symlink-root-"));
    const before = await mkdtemp(join(tmpdir(), "piano-symlink-before-"));
    await rm(before, { recursive: true, force: true });
    try {
      await writeFile(join(root, "target.txt"), "target\n");
      await chmod(join(root, "target.txt"), 0o755);
      await symlink("target.txt", join(root, "link.txt"));

      await snapshotWorkspaceContent(root, before);
      expect((await lstat(join(before, "link.txt"))).isSymbolicLink()).toBe(true);
      await expect(readlink(join(before, "link.txt"))).resolves.toBe("target.txt");
      expect((await lstat(join(before, "target.txt"))).mode & 0o111).toBe(0o111);

      await rm(join(root, "link.txt"));
      await writeFile(join(root, "other.txt"), "other\n");
      await symlink("other.txt", join(root, "link.txt"));
      await writeFile(join(root, "target.txt"), "changed\n");
      const changes = await workspaceContentChanges(before, root);
      expect(changes).toEqual([
        { path: "link.txt", kind: "modified" },
        { path: "other.txt", kind: "added" },
        { path: "target.txt", kind: "modified" },
      ]);

      await restoreWorkspaceChanges(root, before, changes);
      expect((await lstat(join(root, "link.txt"))).isSymbolicLink()).toBe(true);
      await expect(readlink(join(root, "link.txt"))).resolves.toBe("target.txt");
      await expect(readFile(join(root, "target.txt"), "utf8")).resolves.toBe("target\n");
      expect((await lstat(join(root, "target.txt"))).mode & 0o111).toBe(0o111);
    } finally {
      await rm(root, { recursive: true, force: true });
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

      await expect(snapshotWorkspaceContent(root, snapshot)).rejects.toThrow(/external content/);
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

      await expect(snapshotWorkspaceContent(root, snapshot)).rejects.toThrow(/absolute symlink targets/);
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

      await expect(snapshotWorkspaceContent(root, snapshot)).rejects.toThrow(/unsupported filesystem node/u);
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
    try {
      await writeFile(join(baseline, "keep.txt"), "baseline\n");
      await mkdir(join(baseline, "nested"), { recursive: true });
      await writeFile(join(baseline, "nested", "keep.txt"), "nested baseline\n");
      await rm(candidate, { recursive: true, force: true });
      await snapshotWorkspaceContent(baseline, candidate);
      await writeFile(join(outside, "secret.txt"), "must remain outside\n");
      await mkdir(join(outside, "directory"), { recursive: true });
      await writeFile(join(outside, "directory", "secret.txt"), "must remain outside\n");
      await symlink(join(outside, "secret.txt"), join(candidate, "external-file.link"));
      await symlink(join(outside, "directory"), join(candidate, "external-directory.link"));
      await rm(join(candidate, "nested"), { recursive: true, force: true });
      await symlink(join(outside, "directory"), join(candidate, "nested"));
      const fifo = join(candidate, "worker.pipe");
      await execFileAsync("mkfifo", [fifo]);

      await expect(diffWorkspaceContent(baseline, candidate)).rejects.toThrow();

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
      await snapshotWorkspaceContent(baseline, candidate);

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
      await snapshotWorkspaceContent(source, baseline, [runDir]);

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
      await snapshotWorkspaceContent(source, baseline);

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
    const beforeFile = await mkdtemp(join(tmpdir(), "piano-symlink-type-before-file-"));
    const beforeLink = await mkdtemp(join(tmpdir(), "piano-symlink-type-before-link-"));
    await rm(beforeFile, { recursive: true, force: true });
    await rm(beforeLink, { recursive: true, force: true });
    try {
      await writeFile(join(root, "target.txt"), "target\n");
      await writeFile(join(root, "entry.txt"), "file\n");
      await chmod(join(root, "entry.txt"), 0o755);
      await snapshotWorkspaceContent(root, beforeFile);

      await rm(join(root, "entry.txt"));
      await symlink("target.txt", join(root, "entry.txt"));
      expect(await workspaceContentChanges(beforeFile, root)).toContainEqual({ path: "entry.txt", kind: "modified" });
      await restoreWorkspaceChanges(root, beforeFile, [{ path: "entry.txt", kind: "modified" }]);
      expect((await lstat(join(root, "entry.txt"))).isFile()).toBe(true);
      expect((await lstat(join(root, "entry.txt"))).mode & 0o111).toBe(0o111);

      await rm(join(root, "entry.txt"));
      await symlink("target.txt", join(root, "entry.txt"));
      await snapshotWorkspaceContent(root, beforeLink);
      await rm(join(root, "entry.txt"));
      await writeFile(join(root, "entry.txt"), "replacement\n");
      expect(await workspaceContentChanges(beforeLink, root)).toContainEqual({ path: "entry.txt", kind: "modified" });
      await restoreWorkspaceChanges(root, beforeLink, [{ path: "entry.txt", kind: "modified" }]);
      expect((await lstat(join(root, "entry.txt"))).isSymbolicLink()).toBe(true);
      await expect(readlink(join(root, "entry.txt"))).resolves.toBe("target.txt");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(beforeFile, { recursive: true, force: true });
      await rm(beforeLink, { recursive: true, force: true });
    }
  });

  it("rejects traversal and absolute paths before legacy rollback mutates anything", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-legacy-safe-root-"));
    const before = await mkdtemp(join(tmpdir(), "piano-legacy-safe-before-"));
    const outside = await mkdtemp(join(tmpdir(), "piano-legacy-safe-outside-"));
    try {
      await writeFile(join(root, "keep.txt"), "keep\n");
      await writeFile(join(outside, "escape.txt"), "outside\n");
      await expect(restoreWorkspaceChanges(root, before, [{ path: "../escape.txt", kind: "added" }]))
        .rejects.toThrow(/unsafe workspace rollback path|escapes/u);
      await expect(restoreWorkspaceChanges(root, before, [{ path: join(outside, "escape.txt"), kind: "added" }]))
        .rejects.toThrow(/unsafe workspace rollback path|escapes/u);
      await expect(readFile(join(root, "keep.txt"), "utf8")).resolves.toBe("keep\n");
      await expect(readFile(join(outside, "escape.txt"), "utf8")).resolves.toBe("outside\n");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(before, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects legacy rollback paths with symlink ancestors", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-legacy-link-root-"));
    const before = await mkdtemp(join(tmpdir(), "piano-legacy-link-before-"));
    const outside = await mkdtemp(join(tmpdir(), "piano-legacy-link-outside-"));
    try {
      await mkdir(join(before, "nested"));
      await writeFile(join(before, "nested", "file.txt"), "baseline\n");
      await writeFile(join(outside, "file.txt"), "outside\n");
      await symlink(outside, join(root, "nested"));

      await expect(restoreWorkspaceChanges(root, before, [{ path: "nested/file.txt", kind: "modified" }]))
        .rejects.toThrow(/symlink|ancestor/u);
      await expect(readFile(join(outside, "file.txt"), "utf8")).resolves.toBe("outside\n");
      await expect(readlink(join(root, "nested"))).resolves.toBe(outside);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(before, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("reports equality only when both trees hold identical application content", async () => {
    const left = await mkdtemp(join(tmpdir(), "piano-gate-left-"));
    const right = await mkdtemp(join(tmpdir(), "piano-gate-right-"));
    try {
      await writeFile(join(left, "kernel.py"), "WINNER\n");
      await writeFile(join(right, "kernel.py"), "WINNER\n");
      await expect(diffWorkspaceContent(left, right)).resolves.toEqual({ equal: true, differing: [] });

      await writeFile(join(right, "kernel.py"), "LOSER\n");
      await expect(diffWorkspaceContent(left, right)).resolves.toEqual({
        equal: false,
        differing: ["kernel.py"],
      });
    } finally {
      await rm(left, { recursive: true, force: true });
      await rm(right, { recursive: true, force: true });
    }
  });

  it("detects non-execute permission changes in the content gate", async () => {
    const left = await mkdtemp(join(tmpdir(), "piano-gate-mode-left-"));
    const right = await mkdtemp(join(tmpdir(), "piano-gate-mode-right-"));
    try {
      await writeFile(join(left, "kernel.py"), "same\n");
      await writeFile(join(right, "kernel.py"), "same\n");
      await chmod(join(left, "kernel.py"), 0o640);
      await chmod(join(right, "kernel.py"), 0o600);

      await expect(diffWorkspaceContent(left, right)).resolves.toEqual({
        equal: false,
        differing: ["kernel.py"],
      });
    } finally {
      await rm(left, { recursive: true, force: true });
      await rm(right, { recursive: true, force: true });
    }
  });

  it("treats files present on only one side as differing", async () => {
    const left = await mkdtemp(join(tmpdir(), "piano-gate-absent-"));
    const right = await mkdtemp(join(tmpdir(), "piano-gate-absent-"));
    try {
      await writeFile(join(left, "only-left.py"), "x\n");
      await writeFile(join(right, "only-right.txt"), "y\n");
      const result = await diffWorkspaceContent(left, right);
      expect(result.equal).toBe(false);
      expect([...result.differing].sort()).toEqual(["only-left.py", "only-right.txt"]);
    } finally {
      await rm(left, { recursive: true, force: true });
      await rm(right, { recursive: true, force: true });
    }
  });

  it("always ignores run-infrastructure names regardless of the excluded set", async () => {
    const left = await mkdtemp(join(tmpdir(), "piano-gate-infra-"));
    const right = await mkdtemp(join(tmpdir(), "piano-gate-infra-"));
    try {
      await writeFile(join(left, "kernel.py"), "a\n");
      await mkdir(join(left, ".git"), { recursive: true });
      await writeFile(join(left, ".git", "config"), "ignored\n");
      await writeFile(join(left, ".piano-run.lock"), "ignored\n");
      await writeFile(join(right, "kernel.py"), "a\n");
      await expect(diffWorkspaceContent(left, right)).resolves.toEqual({ equal: true, differing: [] });
    } finally {
      await rm(left, { recursive: true, force: true });
      await rm(right, { recursive: true, force: true });
    }
  });

  it("honours a shared-source exclusion only when it is a subtree of the walked root, so a winner nested under the run dir is not emptied", async () => {
    const source = await mkdtemp(join(tmpdir(), "piano-gate-source-"));
    // The winner slot is materialised *under* the shared source's run directory,
    // mirroring how allocateMapWorkspace seeds snapshots under the run dir.
    const runDir = join(source, "runs");
    await mkdir(runDir, { recursive: true });
    const winner = join(runDir, "slots", "race%2Fslot-1");
    await mkdir(winner, { recursive: true });

    await writeFile(join(source, "kernel.py"), "WINNER\n");
    await writeFile(join(winner, "kernel.py"), "WINNER\n");
    // Run-management evidence on the shared source that consolidation must ignore
    // because it is engine state, not application content.
    await writeFile(join(source, "runs", "evidence.json"), "ignored\n");

    // Equal application files + infra-only run subtree on the source side:
    // the winner (nested under the excluded run dir) must still be scanned in
    // full, and the source's run subtree must be excluded.
    const diff = await diffWorkspaceContent(source, winner, [runDir]);
    expect(diff).toEqual({ equal: true, differing: [] });

    // A genuine leftover on one side still surfaces as a mismatch.
    await writeFile(join(source, "extra.txt"), "leftover\n");
    await expect(diffWorkspaceContent(source, winner, [runDir])).resolves.toEqual({
      equal: false,
      differing: ["extra.txt"],
    });
  });
});
