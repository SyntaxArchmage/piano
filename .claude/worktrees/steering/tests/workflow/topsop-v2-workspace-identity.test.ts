import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const HELPER = join(ROOT, "recipes", "topsop-v2-workspace-identity.py");
const roots: string[] = [];

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function git(root: string, ...args: string[]): Buffer {
  return execFileSync("git", ["-C", root, ...args]);
}

function identity(root: string): {
  algorithm: string;
  head: string;
  tracked_diff_sha256: string;
  untracked: Array<{ path: string; sha256: string }>;
  dirty: boolean;
  workspace_diff_digest: string;
} {
  return JSON.parse(
    execFileSync("python3", [HELPER, "--workspace", root], {
      encoding: "utf8",
    }),
  ) as ReturnType<typeof identity>;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("topsop v2 canonical workspace identity", () => {
  it("reproduces the tracked-plus-untracked manifest used by durable state", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-v2-workspace-identity-"));
    roots.push(root);
    git(root, "init", "-q");
    git(root, "config", "user.name", "Piano Test");
    git(root, "config", "user.email", "piano@example.invalid");
    await writeFile(join(root, "tracked.txt"), "baseline\n");
    git(root, "add", "tracked.txt");
    git(root, "commit", "-qm", "baseline");

    await writeFile(join(root, "tracked.txt"), "candidate\n");
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "z.txt"), "z\n");
    await writeFile(join(root, "nested", "a.txt"), "a\n");

    const first = identity(root);
    const trackedDigest = sha256(git(root, "diff", "HEAD"));
    const expectedUntracked = [
      { path: "nested/a.txt", sha256: `sha256:${sha256("a\n")}` },
      { path: "z.txt", sha256: `sha256:${sha256("z\n")}` },
    ];
    const manifest = [
      `tracked:${trackedDigest}\n`,
      ...expectedUntracked.map(
        ({ path, sha256: digest }) => `untracked:${path}:${digest.slice(7)}\n`,
      ),
    ].join("");

    expect(first).toMatchObject({
      algorithm: "topsop-v2-workspace-manifest-v1",
      head: git(root, "rev-parse", "HEAD").toString().trim(),
      tracked_diff_sha256: `sha256:${trackedDigest}`,
      untracked: expectedUntracked,
      dirty: true,
      workspace_diff_digest: `sha256:${sha256(manifest)}`,
    });
    expect(identity(root)).toEqual(first);

    await writeFile(join(root, "nested", "a.txt"), "changed\n");
    expect(identity(root).workspace_diff_digest).not.toBe(first.workspace_diff_digest);
  });

  it("writes the same identity atomically outside the measured workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-v2-workspace-output-"));
    const evidenceRoot = await mkdtemp(join(tmpdir(), "piano-v2-evidence-output-"));
    roots.push(root, evidenceRoot);
    git(root, "init", "-q");
    git(root, "config", "user.name", "Piano Test");
    git(root, "config", "user.email", "piano@example.invalid");
    await writeFile(join(root, "tracked.txt"), "baseline\n");
    git(root, "add", "tracked.txt");
    git(root, "commit", "-qm", "baseline");

    const output = join(evidenceRoot, "workspace-identity.json");
    execFileSync("python3", [HELPER, "--workspace", root, "--output", output]);

    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(identity(root));

    expect(() =>
      execFileSync("python3", [
        HELPER,
        "--workspace",
        root,
        "--output",
        join(root, "workspace-identity.json"),
      ], { stdio: "pipe" }),
    ).toThrow();
  });
});
