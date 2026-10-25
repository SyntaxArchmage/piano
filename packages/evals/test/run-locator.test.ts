import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { findNewRunDir, matchNewRunDir } from "../src/run-locator.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("eval run-directory association", () => {
  it("returns the only new run", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-association-"));
    roots.push(root);
    await mkdir(join(root, "run-a"));

    const result = await Effect.runPromise(findNewRunDir(root, new Set(), "/tmp/workspace-a", Date.now() - 1_000));
    expect(result.path).toBe(join(root, "run-a"));
    expect(result.reason).toBeUndefined();
  });

  it("matches the workspace across concurrent new runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-association-"));
    roots.push(root);
    await mkdir(join(root, "run-a"));
    await mkdir(join(root, "run-b", "system-log"), { recursive: true });
    await writeFile(join(root, "run-b", "system-log", "log.jsonl"), JSON.stringify({ workspace: "/tmp/workspace-b" }));

    const result = await Effect.runPromise(findNewRunDir(root, new Set(), "/tmp/workspace-b", Date.now() - 1_000));
    expect(result.path).toBe(join(root, "run-b"));
    expect(result.candidates).toEqual(["run-a", "run-b"]);
  });

  it("does not attach a lone run that explicitly belongs to another workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-association-"));
    roots.push(root);
    await mkdir(join(root, "run-a", "system-log"), { recursive: true });
    await writeFile(join(root, "run-a", "system-log", "log.jsonl"), JSON.stringify({ workspace: "/tmp/other" }));

    const result = await Effect.runPromise(findNewRunDir(root, new Set(), "/tmp/workspace-a", Date.now() - 1_000));
    expect(result.path).toBeUndefined();
    expect(result.reason).toContain("does not reference workspace");
  });

  it("does not confuse a workspace prefix with another workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-association-"));
    roots.push(root);
    await mkdir(join(root, "run-a", "system-log"), { recursive: true });
    await writeFile(join(root, "run-a", "system-log", "log.jsonl"), JSON.stringify({ workspace: "/tmp/workspace-a-other" }));

    const result = await Effect.runPromise(findNewRunDir(root, new Set(), "/tmp/workspace-a", Date.now() - 1_000));
    expect(result.path).toBeUndefined();
    expect(result.reason).toContain("does not reference workspace");
  });

  it("fails closed when concurrent runs cannot be uniquely associated", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-association-"));
    roots.push(root);
    await mkdir(join(root, "run-a"));
    await mkdir(join(root, "run-b"));

    const result = await Effect.runPromise(findNewRunDir(root, new Set(), "/tmp/workspace-c", Date.now() - 1_000));
    expect(result.path).toBeUndefined();
    expect(result.reason).toContain("could not associate");
    expect(result.candidates).toEqual(["run-a", "run-b"]);
  });
});

describe("live-progress run-directory binding", () => {
  it("binds a lone candidate even before it emits evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-binding-"));
    roots.push(root);
    await mkdir(join(root, "run-a"));

    // The poller must not stall on a single new run that has not written its
    // first log line yet; completion-time findNewRunDir still fails closed.
    expect(matchNewRunDir(root, ["run-a"], "/tmp/workspace-a")).toBe("run-a");
  });

  it("binds only the uniquely matching run among concurrent candidates", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-binding-"));
    roots.push(root);
    await mkdir(join(root, "run-a"));
    await mkdir(join(root, "run-b", "system-log"), { recursive: true });
    await writeFile(join(root, "run-b", "system-log", "log.jsonl"), JSON.stringify({ workspace: "/tmp/workspace-b" }));

    expect(matchNewRunDir(root, ["run-a", "run-b"], "/tmp/workspace-b")).toBe("run-b");
  });

  it("returns undefined when concurrent candidates cannot be uniquely associated", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-binding-"));
    roots.push(root);
    await mkdir(join(root, "run-a", "system-log"), { recursive: true });
    await mkdir(join(root, "run-b", "system-log"), { recursive: true });

    // No evidence yet: the tick is skipped rather than borrowed from a
    // possibly foreign run.
    expect(matchNewRunDir(root, ["run-a", "run-b"], "/tmp/workspace-a")).toBeUndefined();
    await writeFile(join(root, "run-a", "system-log", "log.jsonl"), JSON.stringify({ workspace: "/tmp/workspace-a" }));
    await writeFile(join(root, "run-b", "system-log", "log.jsonl"), JSON.stringify({ workspace: "/tmp/workspace-a" }));
    // Ambiguous match: still undefined.
    expect(matchNewRunDir(root, ["run-a", "run-b"], "/tmp/workspace-a")).toBeUndefined();
  });
});
