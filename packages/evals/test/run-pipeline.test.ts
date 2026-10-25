import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { caseFixture, reportFixture } from "./case-result-fixture.js";
import { runEvalPipeline } from "../src/run-pipeline.js";
import { DriverError } from "../src/errors.js";
import { listRunSetIds, readRunSetReport, runSetReportPath } from "../src/runset.js";
import type { EvalRunOptions } from "../src/types.js";

async function makeWorkloads(root: string, ids: readonly string[]) {
  const template = await readFile(
    join(process.cwd(), "evals", "workloads", "cuda-matmul-tuning-pi-dsv4f", "case.yaml"),
    "utf8",
  );
  for (const id of ids) {
    await mkdir(join(root, "workloads", id), { recursive: true });
    await writeFile(
      join(root, "workloads", id, "case.yaml"),
      template.replace(/^id: .*$/m, `id: ${id}`),
      "utf8",
    );
  }
}

async function readPersistedReport(outputRoot: string) {
  const ids = await Effect.runPromise(listRunSetIds(outputRoot).pipe(Effect.provide(NodeFileSystem.layer)));
  const [runSet] = ids;
  if (runSet === undefined) throw new Error("no run set persisted");
  return await Effect.runPromise(
    readRunSetReport(outputRoot, runSet).pipe(Effect.provide(NodeFileSystem.layer)),
  );
}

function runOptions(overrides: Partial<Parameters<typeof runEvalPipeline>[0]> = {}) {
  return {
    dryRun: false,
    trials: 1,
    skipExisting: false,
    recordBaseline: false,
    replayBaseline: false,
    ...overrides,
  };
}

// An interrupted `piano evals` run (the eval matrix killer: a process-group
// teardown mid-sweep) must still leave every FINISHED case visible to
// `--report`: the pipeline persists report.json as each case lands, not only
// once at the end of the whole invocation.
describe("run pipeline per-case persistence", () => {
  it("keeps the first case's report and history when a later case fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-evals-persist-"));
    try {
      await makeWorkloads(root, ["case-a", "case-b"]);
      const runCase = (_r: string, kase: { id: string }) =>
        kase.id === "case-a"
          ? Effect.succeed(caseFixture(10, { caseId: "case-a", group: "tuning-cuda" }))
          : Effect.fail(new DriverError({ message: "interrupted" }));
      const exit = await Effect.runPromiseExit(
        runEvalPipeline(runOptions(), { root, outputRoot: root, runCase }).pipe(
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      expect(exit._tag).toBe("Failure");
      const report = await readPersistedReport(root);
      expect(report.cases.map((row: { caseId: string }) => row.caseId)).toEqual(["case-a"]);
      expect(await readdir(join(root, "case-b")).catch(() => [])).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists every case of a fully successful invocation", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-evals-persist-"));
    try {
      await makeWorkloads(root, ["case-a", "case-b"]);
      const runCase = (_r: string, kase: { id: string }) =>
        Effect.succeed(caseFixture(10, { caseId: kase.id, group: "tuning-cuda" }));
      await Effect.runPromise(
        runEvalPipeline(runOptions(), { root, outputRoot: root, runCase }).pipe(
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      const report = await readPersistedReport(root);
      expect(report.cases.map((row: { caseId: string }) => row.caseId)).toEqual(["case-a", "case-b"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips persisted attempts while retaining missing cases", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-evals-skip-existing-"));
    const calls: string[] = [];
    try {
      await makeWorkloads(root, ["case-a", "case-b", "case-c"]);
      const priorRunSet = "eval-20260101T000000.000";
      await mkdir(join(root, priorRunSet), { recursive: true });
      await writeFile(runSetReportPath(root, priorRunSet), reportFixture(priorRunSet, [
        caseFixture(10, { caseId: "case-a", group: "tuning-cuda" }),
        caseFixture(0, { caseId: "case-b", group: "tuning-cuda", status: "failed", error: "previous failure" }),
      ]), "utf8");

      const runCase = (_r: string, kase: { id: string }) => {
        calls.push(kase.id);
        return Effect.succeed(caseFixture(10, { caseId: kase.id, group: "tuning-cuda" }));
      };
      await Effect.runPromise(
        runEvalPipeline(runOptions({ skipExisting: true, parallel: 2 }), {
          root, outputRoot: root,
          runCase,
        }).pipe(Effect.provide(NodeFileSystem.layer)),
      );

      expect(calls.sort()).toEqual(["case-c"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs cases up to --parallel while serializing every persisted result", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-evals-parallel-"));
    let active = 0;
    let maxActive = 0;
    try {
      await makeWorkloads(root, ["case-a", "case-b", "case-c", "case-d"]);
      const runCase = (_r: string, kase: { id: string }) => Effect.gen(function* () {
        active += 1;
        maxActive = Math.max(maxActive, active);
        yield* Effect.sleep("30 millis");
        active -= 1;
        return caseFixture(10, { caseId: kase.id, group: "tuning-cuda" });
      });
      await Effect.runPromise(
        runEvalPipeline(runOptions({ parallel: 2 }), { root, outputRoot: root, runCase }).pipe(
          Effect.provide(NodeFileSystem.layer),
        ),
      );

      expect(maxActive).toBe(2);
      const report = await readPersistedReport(root);
      expect(report.cases.map((row: { caseId: string }) => row.caseId).sort())
        .toEqual(["case-a", "case-b", "case-c", "case-d"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("run pipeline baseline replay", () => {
  it("hands the pinned baseline to the case runner instead of re-evaluating", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-evals-replay-"));
    try {
      await makeWorkloads(root, ["case-a"]);
      await mkdir(join(root, "case-a"), { recursive: true });
      await writeFile(join(root, "case-a", "baseline.json"), JSON.stringify({
        baseline: { value: 10, rawOutput: "TFLOPS: 10", passed: true },
      }), "utf8");
      const seen: EvalRunOptions[] = [];
      const runCase = (_r: string, _kase: { id: string }, opts: EvalRunOptions) => {
        seen.push(opts);
        return Effect.succeed(caseFixture(10, { caseId: "case-a", group: "tuning-cuda" }));
      };
      await Effect.runPromise(
        runEvalPipeline(runOptions({ replayBaseline: true }), {
          root, outputRoot: root,
          runCase,
        }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      expect(seen).toHaveLength(1);
      expect(seen[0]?.baseline?.value).toBe(10);
      // One root parameter: an injected evals root keeps each case's copied
      // workspace beside its report instead of under the user's home.
      expect(seen[0]?.workspaceRoot).toBe(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails the case when no baseline is pinned", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-evals-replay-"));
    try {
      await makeWorkloads(root, ["case-a"]);
      const error = await Effect.runPromise(
        runEvalPipeline(runOptions({ replayBaseline: true }), {
          root, outputRoot: root,
          runCase: () => Effect.succeed(caseFixture(10, { caseId: "case-a", group: "tuning-cuda" })),
        }).pipe(Effect.flip, Effect.provide(NodeFileSystem.layer)),
      );
      expect(error.message).toContain('no pinned baseline for case "case-a"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("asks for no pinned baseline on a dry run", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-evals-replay-"));
    try {
      await makeWorkloads(root, ["case-a"]);
      const result = await Effect.runPromise(
        runEvalPipeline(runOptions({ dryRun: true, replayBaseline: true }), {
          root, outputRoot: root,
          runCase: (_r: string, kase: { id: string }) =>
            Effect.succeed(caseFixture(0, { caseId: kase.id, group: "tuning-cuda", status: "skipped" })),
        }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      expect(result.kind).toBe("report");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
