import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { loadCases } from "../src/case-loader.js";

function caseYaml(id: string, group: string, tags: readonly string[]): string {
  const tagLines = tags.map((tag) => `  - tag: ${tag}\n    weight: 1`).join("\n");
  return `version: 1
id: ${id}
group: ${group}
prompt: Do the thing.
command: piano -p <prompt>
workspace: workspace
readout:
  kind: programmatic
  compileCommand: "true"
  verifyCommand: "true"
tags:
${tagLines}
`;
}

async function writeCase(root: string, id: string, group: string, tags: readonly string[]): Promise<void> {
  await mkdir(join(root, "workloads", id), { recursive: true });
  await writeFile(join(root, "workloads", id, "case.yaml"), caseYaml(id, group, tags), "utf8");
}

const run = (root: string, options?: { group?: string; caseId?: string }) =>
  Effect.runPromise(loadCases(root, options).pipe(Effect.provide(NodeFileSystem.layer)));

describe("loadCases group filtering", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "piano-load-cases-"));
    await writeCase(root, "gemv", "tuning", ["tflops", "correctness"]);
    await writeCase(root, "cuda-gemm", "tuning-cuda", ["tflops", "correctness"]);
    await writeCase(root, "edit-json", "agentic", ["correctness"]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("selects a whole group family by name prefix", async () => {
    // A keyword names a family, not one exact string: `tuning` covers
    // `tuning-cuda` too, the same way one display family renders both.
    expect((await run(root, { group: "tuning" })).map((kase) => kase.id).sort()).toEqual(["cuda-gemm", "gemv"]);
    expect((await run(root, { group: "tuning-cuda" })).map((kase) => kase.id).sort()).toEqual(["cuda-gemm"]);
    expect((await run(root, { group: "agentic" })).map((kase) => kase.id).sort()).toEqual(["edit-json"]);
    // The prefix stops at the `-` boundary, so a longer word is not a prefix.
    expect(await run(root, { group: "tun" })).toEqual([]);
  });

  it("assembles every case carrying the keyword as a tag", async () => {
    expect((await run(root, { group: "tflops" })).map((kase) => kase.id).sort()).toEqual(["cuda-gemm", "gemv"]);
    expect((await run(root, { group: "correctness" })).map((kase) => kase.id).sort()).toEqual(["cuda-gemm", "edit-json", "gemv"]);
  });

  it("keeps the case-id filter independent and composable", async () => {
    expect((await run(root, { group: "tflops", caseId: "cuda-gemm" })).map((kase) => kase.id)).toEqual(["cuda-gemm"]);
    expect(await run(root, { group: "nope" })).toEqual([]);
  });
});
