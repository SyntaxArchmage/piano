import { execFile } from "node:child_process";
import { lstat, mkdtemp, readFile, rename, rm, symlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { beginGitMetadataTransaction, GitMetadataTransactionError } from "../../packages/orchestrator/src/git-metadata-transaction.js";

const execFileAsync = promisify(execFile);

/** The module delivers its failures on an Effect channel; the suite drives both
 * channels to completion so the assertions stay about Git state. */
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const failure = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(effect));
const begin = (sourceCwd: string) => run(beginGitMetadataTransaction(sourceCwd));

async function git(cwd: string, args: readonly string[]): Promise<string> {
  return (await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8" })).stdout.trim();
}
async function succeeds(cwd: string, args: readonly string[]): Promise<boolean> {
  try { await git(cwd, args); return true; } catch { return false; }
}
async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "piano-git-transaction-"));
  await git(root, ["init", "-q", "-b", "main"]); await git(root, ["config", "user.email", "piano-tests@example.invalid"]); await git(root, ["config", "user.name", "Piano Tests"]);
  await writeFile(join(root, "code.txt"), "baseline\n"); await writeFile(join(root, "staged.txt"), "baseline\n");
  await git(root, ["add", "."]); await git(root, ["commit", "-q", "-m", "baseline"]); return root;
}

describe(" Git metadata transaction", () => {
  it("rolls back a commit/new branch and restores the exact staged index without touching worktree files", async () => {
    const root = await repository();
    try {
      await writeFile(join(root, "staged.txt"), "staged before carry\n"); await git(root, ["add", "staged.txt"]); await git(root, ["update-index", "--split-index"]);
      const originalHead = await git(root, ["rev-parse", "HEAD"]); const indexPath = await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"]); const originalIndex = await readFile(indexPath);
      const mergeHeadPath = await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"]);
      const transaction = await begin(root);
      await git(root, ["switch", "-q", "-c", "worker"]); await git(root, ["commit", "-q", "-m", "worker"]);
      await writeFile(join(root, "worktree-only.txt"), "preserved\n"); await git(root, ["add", "worktree-only.txt"]); await writeFile(mergeHeadPath, `${originalHead}\n`); await run(transaction.observe());
      const result = await run(transaction.rollback());
      expect(result.restored).toBe(true); expect(result.residues).toEqual(expect.arrayContaining(["unreachable objects retained", "reflog entries retained"]));
      expect(await git(root, ["symbolic-ref", "HEAD"])).toBe("refs/heads/main"); expect(await git(root, ["rev-parse", "HEAD"])).toBe(originalHead);
      expect(await succeeds(root, ["show-ref", "--verify", "--quiet", "refs/heads/worker"])).toBe(false); expect(await readFile(indexPath)).toEqual(originalIndex);
      await expect(readFile(mergeHeadPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(root, "worktree-only.txt"), "utf8")).resolves.toBe("preserved\n");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("restores detached HEAD semantics", async () => {
    const root = await repository();
    try {
      const original = await git(root, ["rev-parse", "HEAD"]); await git(root, ["switch", "-q", "--detach", original]); const transaction = await begin(root);
      await writeFile(join(root, "code.txt"), "worker\n"); await git(root, ["add", "code.txt"]); await git(root, ["commit", "-q", "-m", "worker"]); await run(transaction.observe()); await run(transaction.rollback());
      expect(await git(root, ["rev-parse", "HEAD"])).toBe(original); expect(await succeeds(root, ["symbolic-ref", "-q", "HEAD"])).toBe(false);
      await expect(readFile(join(root, "code.txt"), "utf8")).resolves.toBe("worker\n");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("fails closed when a ref changes after observe", async () => {
    const root = await repository();
    try {
      const original = await git(root, ["rev-parse", "HEAD"]); const transaction = await begin(root);
      await writeFile(join(root, "code.txt"), "worker\n"); await git(root, ["add", "code.txt"]); await git(root, ["commit", "-q", "-m", "worker"]); const workerHead = await git(root, ["rev-parse", "HEAD"]);
      await run(transaction.observe()); await git(root, ["update-ref", "refs/heads/concurrent", original]);
      await expect(failure(transaction.rollback())).resolves.toMatchObject({ code: "concurrent-mutation" });
      expect(await git(root, ["rev-parse", "HEAD"])).toBe(workerHead); expect(await succeeds(root, ["show-ref", "--verify", "--quiet", "refs/heads/concurrent"])).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("fails closed when index or marker metadata changes after observe", async () => {
    const root = await repository();
    try {
      const transaction = await begin(root);
      const indexPath = await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
      const markerPath = await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"]);
      await writeFile(join(root, "code.txt"), "worker\n"); await git(root, ["add", "code.txt"]);
      await writeFile(markerPath, `${await git(root, ["rev-parse", "HEAD"])}\n`); await run(transaction.observe());
      await writeFile(indexPath, "external index mutation\n"); await writeFile(markerPath, "external marker mutation\n");
      await expect(failure(transaction.rollback())).resolves.toMatchObject({ code: "concurrent-mutation" });
      await expect(readFile(indexPath, "utf8")).resolves.toBe("external index mutation\n");
      await expect(readFile(markerPath, "utf8")).resolves.toBe("external marker mutation\n");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("fails closed when a metadata lock appears after observe", async () => {
    const root = await repository();
    try {
      const transaction = await begin(root);
      await writeFile(join(root, "code.txt"), "worker\n"); await git(root, ["add", "code.txt"]); await git(root, ["commit", "-q", "-m", "worker"]);
      const markerPath = await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"]); await writeFile(markerPath, `${await git(root, ["rev-parse", "HEAD"])}\n`);
      await writeFile(join(root, "staged.txt"), "staged worker\n"); await git(root, ["add", "staged.txt"]); await run(transaction.observe());
      await writeFile(`${markerPath}.lock`, "held\n");
      await expect(failure(transaction.rollback())).resolves.toMatchObject({ code: "unsafe-mutation" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("captures post-worker state when the worker throws before explicit observe", async () => {
    const root = await repository();
    try {
      const original = await git(root, ["rev-parse", "HEAD"]); const transaction = await begin(root);
      await writeFile(join(root, "code.txt"), "worker threw\n"); await git(root, ["add", "code.txt"]); await git(root, ["commit", "-q", "-m", "worker failed"]);
      try { throw new Error("worker failed"); } catch { /* caller rolls back without a completed observe */ }
      const result = await run(transaction.rollback());
      expect(result.restored).toBe(true); expect(await git(root, ["rev-parse", "HEAD"])).toBe(original);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("does not follow a predictable rollback temp symlink", async () => {
    const root = await repository();
    try {
      const transaction = await begin(root);
      const indexPath = await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
      const outside = join(root, "outside.txt"); const predictable = `${indexPath}.piano-rollback`;
      await writeFile(outside, "must remain\n"); await symlink(outside, predictable);
      await writeFile(join(root, "code.txt"), "worker\n"); await git(root, ["add", "code.txt"]); await git(root, ["commit", "-q", "-m", "worker"]);
      await run(transaction.observe()); const result = await run(transaction.rollback());
      expect(result.restored).toBe(true); expect(await readFile(outside, "utf8")).toBe("must remain\n");
      expect((await lstat(predictable)).isSymbolicLink()).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("handles linked worktrees with common refs and per-worktree HEAD/index", async () => {
    const root = await repository(); const parent = await mkdtemp(join(tmpdir(), "piano-linked-parent-")); const linked = join(parent, "linked");
    try {
      await git(root, ["worktree", "add", "-q", linked, "-b", "linked"]);
      const original = await git(linked, ["rev-parse", "HEAD"]); const transaction = await begin(linked);
      await writeFile(join(linked, "code.txt"), "linked worker\n"); await git(linked, ["add", "code.txt"]); await git(linked, ["switch", "-q", "-c", "linked-worker"]); await git(linked, ["commit", "-q", "-m", "linked worker"]);
      await run(transaction.observe()); const result = await run(transaction.rollback());
      expect(result.restored).toBe(true); expect(await git(linked, ["symbolic-ref", "HEAD"])).toBe("refs/heads/linked"); expect(await git(linked, ["rev-parse", "HEAD"])).toBe(original);
      expect(await succeeds(root, ["show-ref", "--verify", "--quiet", "refs/heads/linked-worker"])).toBe(false);
    } finally { await rm(linked, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); await rm(parent, { recursive: true, force: true }); }
  });

  it("refuses an initial lock or rebase/sequencer operation", async () => {
    const root = await repository();
    try {
      const indexPath = await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"]); await writeFile(`${indexPath}.lock`, "held\n");
      await expect(failure(beginGitMetadataTransaction(root))).resolves.toMatchObject({ code: "unsafe-mutation" }); await rm(`${indexPath}.lock`);
      const refPath = await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "refs/heads/main"]); await writeFile(`${refPath}.lock`, "held\n");
      await expect(failure(beginGitMetadataTransaction(root))).resolves.toMatchObject({ code: "unsafe-mutation" }); await rm(`${refPath}.lock`);
      const rebaseDir = await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "rebase-merge"]); await mkdir(rebaseDir);
      await expect(failure(beginGitMetadataTransaction(root))).resolves.toMatchObject({ code: "unsafe-mutation" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("detects locks created after begin in Git roots and refs on every snapshot", async () => {
    const root = await repository();
    try {
      const gitDir = await git(root, ["rev-parse", "--absolute-git-dir"]);
      const commonDir = await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
      const refsDir = join(gitDir, "refs", "heads");
      const transaction = await begin(root);
      for (const [index, metadataRoot] of [...new Set([gitDir, commonDir])].entries()) {
        const lateRootLock = join(metadataRoot, `late-metadata-${index}.lock`);
        await writeFile(lateRootLock, "held\n");
        await expect(failure(transaction.observe())).resolves.toMatchObject({ code: "unsafe-mutation" });
        await rm(lateRootLock);
      }
      const lateRefLock = join(refsDir, "late-ref.lock");
      await writeFile(lateRefLock, "held\n");
      await expect(failure(transaction.observe())).resolves.toMatchObject({ code: "unsafe-mutation" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("makes commit and rollback fail closed for changes after the last observe", async () => {
    const root = await repository();
    try {
      const transaction = await begin(root);
      await run(transaction.observe());
      await writeFile(join(root, "code.txt"), "external\n");
      await git(root, ["add", "code.txt"]);
      await expect(failure(transaction.commit())).resolves.toMatchObject({ code: "concurrent-mutation" });
      await expect(failure(transaction.rollback())).resolves.toMatchObject({ code: "concurrent-mutation" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("allows multiple authorized observe turns and rolls back their accumulated metadata", async () => {
    const root = await repository();
    try {
      const original = await git(root, ["rev-parse", "HEAD"]);
      const transaction = await begin(root);
      await writeFile(join(root, "code.txt"), "worker turn one\n");
      await git(root, ["add", "code.txt"]);
      await git(root, ["commit", "-q", "-m", "worker turn one"]);
      await run(transaction.observe());
      await writeFile(join(root, "code.txt"), "worker turn two\n");
      await git(root, ["add", "code.txt"]);
      await git(root, ["commit", "-q", "-m", "worker turn two"]);
      await run(transaction.observe());
      expect(await run(transaction.rollback())).toMatchObject({ restored: true });
      expect(await git(root, ["rev-parse", "HEAD"])).toBe(original);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("does not restore a symbolic ref when only its derived OID changes", async () => {
    const root = await repository();
    try {
      await git(root, ["symbolic-ref", "refs/heads/alias", "refs/heads/main"]);
      const original = await git(root, ["rev-parse", "HEAD"]);
      const transaction = await begin(root);
      await writeFile(join(root, "code.txt"), "worker\n");
      await git(root, ["add", "code.txt"]);
      await git(root, ["commit", "-q", "-m", "worker"]);
      await run(transaction.observe());
      expect(await run(transaction.rollback())).toMatchObject({ restored: true });
      expect(await git(root, ["rev-parse", "HEAD"])).toBe(original);
      expect(await git(root, ["symbolic-ref", "refs/heads/alias"])).toBe("refs/heads/main");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("fails closed when the worktree Git entry or refs root is a symlink", async () => {
    const root = await repository();
    try {
      const realGit = join(root, "git-real");
      await rename(join(root, ".git"), realGit);
      await symlink(realGit, join(root, ".git"), "dir");
      await expect(failure(beginGitMetadataTransaction(root))).resolves.toMatchObject({ code: "unsafe-mutation" });
    } finally { await rm(root, { recursive: true, force: true }); }

    const refsRoot = await repository();
    try {
      const gitDir = await git(refsRoot, ["rev-parse", "--absolute-git-dir"]);
      const refs = join(gitDir, "refs");
      const outside = await mkdtemp(join(tmpdir(), "piano-external-refs-"));
      await rm(refs, { recursive: true });
      await symlink(outside, refs, "dir");
      await expect(failure(beginGitMetadataTransaction(refsRoot))).resolves.toMatchObject({ code: "unsafe-mutation" });
      await rm(outside, { recursive: true, force: true });
    } finally { await rm(refsRoot, { recursive: true, force: true }); }
  });

  it("fails closed for bare repositories but is a no-op outside Git", async () => {
    const bare = await mkdtemp(join(tmpdir(), "piano-bare-")); const nonGit = await mkdtemp(join(tmpdir(), "piano-outside-"));
    try {
      await git(bare, ["init", "--bare", "-q"]);
      await expect(failure(beginGitMetadataTransaction(bare))).resolves.toMatchObject({ code: "unsafe-mutation" });
      const transaction = await begin(nonGit); expect(transaction.kind).toBe("non-git"); expect(await run(transaction.rollback())).toMatchObject({ kind: "non-git", restored: true });
    } finally { await rm(bare, { recursive: true, force: true }); await rm(nonGit, { recursive: true, force: true }); }
  });

  it("is a non-Git no-op", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-non-git-transaction-"));
    try {
      await writeFile(join(root, "file.txt"), "unchanged\n"); const transaction = await begin(root);
      expect(transaction.kind).toBe("non-git"); expect(await run(transaction.observe())).toEqual([]); expect(await run(transaction.rollback())).toMatchObject({ kind: "non-git", restored: true });
      await expect(readFile(join(root, "file.txt"), "utf8")).resolves.toBe("unchanged\n");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("reports a raw rollback failure under the rollback code", async () => {
    const root = await repository();
    try {
      const transaction = await begin(root);
      await rm(join(root, ".git"), { recursive: true, force: true });
      await expect(failure(transaction.rollback())).resolves.toMatchObject({ code: "restore-failed" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("delivers a raw filesystem failure as a typed capture failure", async () => {
    const parent = await mkdtemp(join(tmpdir(), "piano-absent-source-"));
    try {
      const absent = join(parent, "absent");
      const error = await failure(beginGitMetadataTransaction(absent));
      expect(error).toBeInstanceOf(GitMetadataTransactionError);
      expect(error).toMatchObject({ code: "capture-failed" });
      expect(error.message).toContain("ENOENT");
      expect(error.message).toContain(absent);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("commit accepts worker metadata without restoring it", async () => {
    const root = await repository();
    try {
      const original = await git(root, ["rev-parse", "HEAD"]); const transaction = await begin(root);
      await writeFile(join(root, "code.txt"), "accepted\n"); await git(root, ["add", "code.txt"]); await git(root, ["commit", "-q", "-m", "accepted"]); const accepted = await git(root, ["rev-parse", "HEAD"]);
      await run(transaction.observe()); await run(transaction.commit()); expect(accepted).not.toBe(original); expect(await git(root, ["rev-parse", "HEAD"])).toBe(accepted);
      await expect(failure(transaction.rollback())).resolves.toMatchObject({ code: "invalid-state" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
