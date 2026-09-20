import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { evalsCommand, parseEvalsArgs } from "../../packages/cli/src/evals.js";
import { DEFAULT_PERFORMANCE_TIMEOUT_MS } from "../../packages/evals/src/driver.js";
import { buildReport } from "../../packages/evals/src/scorer.js";
import { formatReport } from "../../packages/evals/src/report.js";
import type { CaseResult } from "../../packages/evals/src/types.js";

function caseFixture(value: number, overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    caseId: "tuning-case",
    trial: 1,
    group: "g",
    tags: [],
    status: "completed",
    workspaceDir: "/tmp/ws",
    trajectory: {
      messageCount: 2, assistantMessageCount: 1, rounds: 1, toolCallCount: 1, toolNames: [],
      inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 2,
    },
    artifact: { verified: true, value },
    metric: { name: "tflops", direction: "higher" },
    ...overrides,
  };
}

function reportFixture(runSetId: string, cases: readonly CaseResult[]): string {
  return JSON.stringify(buildReport(runSetId, "2026-08-25T00:00:00.000Z", [...cases]));
}

describe("piano evals timeout (ISSUE-CODEX-011)", () => {
  it("parses an explicit timeout in seconds as milliseconds for the driver", async () => {
    const options = await Effect.runPromise(parseEvalsArgs(["--group", "tuning", "--timeout", "21600"]));
    expect(options).toMatchObject({ group: "tuning", timeoutMs: 21_600_000 });
  });

  it("rejects a missing or non-positive timeout value", async () => {
    for (const args of [["--timeout"], ["--timeout", "0"], ["--timeout", "--group"]]) {
      const result = await Effect.runPromiseExit(parseEvalsArgs(args));
      expect(result._tag).toBe("Failure");
    }
  });

  it("keeps the default performance window long enough for an iterative workflow", () => {
    expect(DEFAULT_PERFORMANCE_TIMEOUT_MS).toBe(6 * 60 * 60 * 1000);
  });

  it("parses variant and baseline replay controls", async () => {
    await expect(Effect.runPromise(parseEvalsArgs(["--variant", "candidate", "--record-baseline"])))
      .resolves.toMatchObject({ variant: "candidate", recordBaseline: true, replayBaseline: false });
    await expect(Effect.runPromiseExit(parseEvalsArgs(["--record-baseline", "--replay-baseline"])))
      .resolves.toMatchObject({ _tag: "Failure" });
  });
});

describe("piano evals --report (offline analysis)", () => {
  it("parses report mode with its selection, compare and runset controls", async () => {
    await expect(Effect.runPromise(parseEvalsArgs(["--report"])))
      .resolves.toMatchObject({ report: true, compare: false });
    await expect(Effect.runPromise(parseEvalsArgs(["--report", "--compare", "--runset", "eval-20260101T000000.000"])))
      .resolves.toMatchObject({ report: true, compare: true, runSet: "eval-20260101T000000.000" });
    await expect(Effect.runPromise(parseEvalsArgs(["--report", "--group", "tuning-cuda"])))
      .resolves.toMatchObject({ report: true, group: "tuning-cuda" });
    await expect(Effect.runPromise(parseEvalsArgs(["--report", "--case", "cuda-matmul-tuning-pi-dsv4f"])))
      .resolves.toMatchObject({ report: true, caseId: "cuda-matmul-tuning-pi-dsv4f" });
    await expect(Effect.runPromise(parseEvalsArgs(["--report", "--details"])))
      .resolves.toMatchObject({ report: true, details: true });
    // --details is a report-mode control.
    await expect(Effect.runPromiseExit(parseEvalsArgs(["--details"])))
      .resolves.toMatchObject({ _tag: "Failure" });
  });

  it("rejects report mode combined with run options and orphan compare/runset flags", async () => {
    for (const args of [
      ["--report", "--dry-run"],
      ["--report", "--trials", "2"],
      ["--compare"],
      ["--runset", "eval-20260101T000000.000"],
      ["--report", "--runset"],
      ["--report", "--runset", "eval-1", "--runset", "eval-2"],
    ]) {
      const result = await Effect.runPromiseExit(parseEvalsArgs(args));
      expect(result._tag).toBe("Failure");
    }
  });

  it("renders the latest persisted run set and its delta without running cases", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-evals-report-"));
    try {
      for (const id of ["eval-20260101T000000.000", "eval-20260102T000000.000"]) {
        await mkdir(join(root, id), { recursive: true });
        await writeFile(join(root, id, "report.json"), reportFixture(id, [caseFixture(id.endsWith("02T000000.000") ? 12 : 10)]), "utf8");
      }
      const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      try {
        await Effect.runPromise(evalsCommand(["--report", "--compare"], { historyRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
        const text = output.mock.calls.map((call) => String(call[0])).join("");
        expect(text).toContain("Workflow evals report");
        expect(text).toContain("run set: eval-20260102T000000.000");
        expect(text).toContain("Δ vs previous run set");
        expect(text).toContain("eval-20260101T000000.000 → eval-20260102T000000.000");
        expect(text).toContain("+20.0%"); // final 10 → 12 on a higher-better metric
      } finally {
        output.mockRestore();
      }
      // An unknown run set fails with a clear message.
      const missing = await Effect.runPromiseExit(
        evalsCommand(["--report", "--runset", "eval-19990101T000000.000"], { historyRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      expect(missing._tag).toBe("Failure");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("scopes --report to the latest run set holding the selected group or case", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-evals-report-sel-"));
    const paired = (value: number): CaseResult[] => [
      caseFixture(1, { caseId: "coding-case", group: "coding", tags: ["tflops"] }),
      caseFixture(value, { caseId: "tuning-case", group: "tuning", tags: ["tflops"] }),
    ];
    const runSets: Record<string, CaseResult[]> = {
      "eval-20260101T000000.000": paired(10),
      "eval-20260102T000000.000": paired(12),
      // Newest: a leftover coding dry run holding no tuning case at all.
      "eval-20260103T000000.000": [caseFixture(1, { caseId: "coding-case", group: "coding", tags: ["tflops"] })],
      // Even newer: a stale all-skipped dry-run stub must not hijack a selection.
      "eval-20260104T000000.000": [caseFixture(1, { caseId: "coding-case", group: "coding", tags: ["tflops"], status: "skipped" })],
    };
    try {
      for (const [id, cases] of Object.entries(runSets)) {
        await mkdir(join(root, id), { recursive: true });
        await writeFile(join(root, id, "report.json"), reportFixture(id, cases), "utf8");
      }
      const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      try {
        await Effect.runPromise(evalsCommand(["--report", "--group", "tuning", "--compare"], { historyRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
        const text = output.mock.calls.map((call) => String(call[0])).join("");
        // The tuning-case row comes from its newest occurrence (0102, value
        // 12), even though coding-only run sets are newer; the comparison row
        // is its previous occurrence (0101, value 10).
        expect(text).toContain("run set: eval-20260102T000000.000");
        expect(text).toContain("Matrix (tuning)"); // assembled view: one row is enough
        expect(text).toContain("eval-20260101T000000.000 → eval-20260102T000000.000");
        expect(text).toContain("tuning-case#1");
        expect(text).not.toContain("coding-case#1");
        expect(text).toContain("+20.0%"); // final 10 → 12 within the selection
        output.mockClear();
        // A skipped stub row never counts toward a matching selection either.
        await Effect.runPromise(evalsCommand(["--report", "--group", "coding", "--compare"], { historyRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
        const coding = output.mock.calls.map((call) => String(call[0])).join("");
        expect(coding).toContain("run set: eval-20260103T000000.000");
        expect(coding).toContain("eval-20260102T000000.000 → eval-20260103T000000.000");
        expect(coding).toContain("coding-case#1");
        // A tag keyword assembles the newest occurrence of every tagged case
        // across run sets into one matrix: coding-case from 0103,
        // tuning-case from 0102, compared against their previous records.
        output.mockClear();
        await Effect.runPromise(evalsCommand(["--report", "--group", "tflops", "--compare"], { historyRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
        const board = output.mock.calls.map((call) => String(call[0])).join("");
        expect(board).toContain("run set: gathered eval-20260102T000000.000..eval-20260103T000000.000");
        expect(board).toContain("Matrix (tflops)");
        expect(board).toContain("tuning-case#1");
        expect(board).toContain("coding-case#1");
        expect(board).toContain("+20.0%"); // tuning-case 10 → 12 between its records
        // --case scopes the same way.
        await Effect.runPromise(evalsCommand(["--report", "--case", "tuning-case"], { historyRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
      } finally {
        output.mockRestore();
      }
      // An unfiltered --report renders the newest stored report verbatim —
      // compact by default (matrix + summary; the per-case detail block is
      // opt-in via --details).
      const stored = JSON.parse(await readFile(join(root, "eval-20260104T000000.000", "report.json"), "utf8"));
      const output2 = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      try {
        await Effect.runPromise(evalsCommand(["--report"], { historyRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
        const text = output2.mock.calls.map((call) => String(call[0])).join("");
        expect(text).toContain("run set: eval-20260104T000000.000");
        expect(text).toBe(formatReport(stored, { details: false }) + "\n");
        expect(text).not.toContain("# Cases");
        output2.mockClear();
        // --details restores the per-case process print.
        await Effect.runPromise(evalsCommand(["--report", "--details"], { historyRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
        const detailed = output2.mock.calls.map((call) => String(call[0])).join("");
        expect(detailed).toContain("# Cases");
        expect(detailed).toBe(formatReport(stored) + "\n");
      } finally {
        output2.mockRestore();
      }
      // A selection no persisted run set holds fails cleanly.
      const missing = await Effect.runPromiseExit(
        evalsCommand(["--report", "--group", "nope"], { historyRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      expect(missing._tag).toBe("Failure");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// An interrupted `piano evals` run (the eval matrix killer: a process-group
// teardown mid-sweep) must still leave every FINISHED case visible to
// `--report`: the driver persists report.json and per-case history as each
// case lands, not only once at the end of the whole invocation.
describe("piano evals per-case persistence", () => {
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

  async function runSetReport(historyRoot: string) {
    const entries = await readdir(historyRoot);
    const [runSet] = entries.filter((name) => /^eval-\d{8}T\d{6}\.\d{3}$/.test(name));
    if (runSet === undefined) throw new Error("no run set persisted");
    return JSON.parse(await readFile(join(historyRoot, runSet, "report.json"), "utf8"));
  }

  it("keeps the first case's report and history when a later case fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-evals-persist-"));
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await makeWorkloads(root, ["case-a", "case-b"]);
      const runCase = (_r: string, kase: { id: string }) =>
        kase.id === "case-a"
          ? Effect.succeed(caseFixture(10, { caseId: "case-a", group: "tuning-cuda" }))
          : Effect.fail(new Error("interrupted"));
      const exit = await Effect.runPromiseExit(
        evalsCommand(["--root", root], { historyRoot: root, runCase: runCase as never }).pipe(
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      expect(exit._tag).toBe("Failure");
      const report = await runSetReport(root);
      expect(report.cases.map((row: { caseId: string }) => row.caseId)).toEqual(["case-a"]);
      const history = await readFile(join(root, "case-a", "history.jsonl"), "utf8");
      expect(history.trim().split("\n")).toHaveLength(1);
      expect(await readdir(join(root, "case-b")).catch(() => [])).toEqual([]);
    } finally {
      output.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists every case of a fully successful invocation", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-evals-persist-"));
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await makeWorkloads(root, ["case-a", "case-b"]);
      const runCase = (_r: string, kase: { id: string }) =>
        Effect.succeed(caseFixture(10, { caseId: kase.id, group: "tuning-cuda" }));
      await Effect.runPromise(
        evalsCommand(["--root", root], { historyRoot: root, runCase: runCase as never }).pipe(
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      const report = await runSetReport(root);
      expect(report.cases.map((row: { caseId: string }) => row.caseId)).toEqual(["case-a", "case-b"]);
    } finally {
      output.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});
