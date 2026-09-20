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

  it("parses bounded parallelism in inline and separated forms", async () => {
    await expect(Effect.runPromise(parseEvalsArgs(["--parallel=4"]))).resolves.toMatchObject({ parallel: 4 });
    await expect(Effect.runPromise(parseEvalsArgs(["--parallel", "3"]))).resolves.toMatchObject({ parallel: 3 });
    for (const args of [["--parallel=0"], ["--parallel=65"], ["--parallel=abc"], ["--parallel"]]) {
      await expect(Effect.runPromiseExit(parseEvalsArgs(args))).resolves.toMatchObject({ _tag: "Failure" });
    }
  });

  it("parses --skip-existing and keeps it out of report mode", async () => {
    await expect(Effect.runPromise(parseEvalsArgs(["--group", "tuning-cuda", "--skip-existing"])))
      .resolves.toMatchObject({ group: "tuning-cuda", skipExisting: true });
    await expect(Effect.runPromiseExit(parseEvalsArgs(["--report", "--skip-existing"])))
      .resolves.toMatchObject({ _tag: "Failure" });
  });
});

describe("piano evals --report (offline analysis)", () => {
  it("parses report mode with its selection, delta and runset controls", async () => {
    await expect(Effect.runPromise(parseEvalsArgs(["--report"])))
      .resolves.toMatchObject({ report: true, delta: false });
    await expect(Effect.runPromise(parseEvalsArgs(["--report", "--delta", "--group", "tuning-cuda"])))
      .resolves.toMatchObject({ report: true, delta: true, group: "tuning-cuda" });
    await expect(Effect.runPromise(parseEvalsArgs(["--report", "--group", "tuning-cuda"])))
      .resolves.toMatchObject({ report: true, group: "tuning-cuda" });
    await expect(Effect.runPromise(parseEvalsArgs(["--report", "--case", "cuda-matmul-tuning-pi-dsv4f"])))
      .resolves.toMatchObject({ report: true, caseId: "cuda-matmul-tuning-pi-dsv4f" });
    await expect(Effect.runPromise(parseEvalsArgs(["--report", "--details"])))
      .resolves.toMatchObject({ report: true, details: true });
    // --details and --delta are report-mode controls.
    await expect(Effect.runPromiseExit(parseEvalsArgs(["--details"])))
      .resolves.toMatchObject({ _tag: "Failure" });
  });

  it("rejects report mode combined with run options and orphan delta/runset flags", async () => {
    for (const args of [
      ["--report", "--dry-run"],
      ["--report", "--trials", "2"],
      ["--delta"],
      ["--runset", "eval-20260101T000000.000"],
      ["--report", "--runset"],
      ["--report", "--runset", "eval-1", "--runset", "eval-2"],
      ["--report", "--parallel=2"],
    ]) {
      const result = await Effect.runPromiseExit(parseEvalsArgs(args));
      expect(result._tag).toBe("Failure");
    }
  });

  it("scopes --delta to a selection and refuses --runset", async () => {
    // The Δ board diffs each case against its own previous record, so it has
    // nothing to scope to without --group or --case.
    const unselected = await Effect.runPromise(parseEvalsArgs(["--report", "--delta"]).pipe(Effect.flip));
    expect(unselected.message).toContain("--delta needs a selection");
    // ... and pinning one side with --runset would contradict that.
    const pinned = await Effect.runPromise(parseEvalsArgs([
      "--report", "--delta", "--group", "tuning", "--runset", "eval-20260101T000000.000",
    ]).pipe(Effect.flip));
    expect(pinned.message).toContain("cannot be combined with --runset");
  });

  it("renders the Δ board of the selected case without running cases", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-evals-report-"));
    try {
      for (const id of ["eval-20260101T000000.000", "eval-20260102T000000.000"]) {
        await mkdir(join(root, id), { recursive: true });
        await writeFile(join(root, id, "report.json"), reportFixture(id, [caseFixture(id.endsWith("02T000000.000") ? 12 : 10, { group: "tuning" })]), "utf8");
      }
      const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      try {
        await Effect.runPromise(evalsCommand(["--report", "--case", "tuning-case", "--delta"], { historyRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
        const text = output.mock.calls.map((call) => String(call[0])).join("");
        expect(text).toContain("Workflow evals report");
        // --case scopes which cases enter the board; it does not relabel them.
        // The case keeps its own group, and that group decides its display.
        expect(text).toContain("Matrix (tuning)");
        expect(text).toContain("Δ vs previous record (tuning)");
        expect(text).toContain("eval-20260101T000000.000 → eval-20260102T000000.000 (tuning-case#1)");
        expect(text).toContain("+2.0000"); // final 10 → 12, the arithmetic Δ
        expect(text).toContain("+20.0%"); // and the relative one
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
      caseFixture(1, { caseId: "agentic-case", group: "agentic", tags: ["tflops"] }),
      caseFixture(value, { caseId: "tuning-case", group: "tuning", tags: ["tflops"] }),
    ];
    const runSets: Record<string, CaseResult[]> = {
      "eval-20260101T000000.000": paired(10),
      "eval-20260102T000000.000": paired(12),
      // Newest: a leftover agentic dry run holding no tuning case at all.
      "eval-20260103T000000.000": [caseFixture(1, { caseId: "agentic-case", group: "agentic", tags: ["tflops"] })],
      // Even newer: a stale all-skipped dry-run stub must not hijack a selection.
      "eval-20260104T000000.000": [caseFixture(1, { caseId: "agentic-case", group: "agentic", tags: ["tflops"], status: "skipped" })],
    };
    try {
      for (const [id, cases] of Object.entries(runSets)) {
        await mkdir(join(root, id), { recursive: true });
        await writeFile(join(root, id, "report.json"), reportFixture(id, cases), "utf8");
      }
      const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      try {
        await Effect.runPromise(evalsCommand(["--report", "--group", "tuning", "--delta"], { historyRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
        const text = output.mock.calls.map((call) => String(call[0])).join("");
        // The tuning-case row comes from its newest occurrence (0102, value
        // 12), even though agentic-only run sets are newer; its Δ reference is
        // its own previous occurrence (0101, value 10).
        expect(text).toContain("run set: eval-20260102T000000.000");
        expect(text).toContain("Matrix (tuning)"); // assembled view: one row is enough
        expect(text).toContain("Δ vs previous record (tuning)");
        expect(text).toContain("eval-20260101T000000.000 → eval-20260102T000000.000 (tuning-case#1)");
        expect(text).toContain("tuning-case#1");
        expect(text).not.toContain("agentic-case#1");
        expect(text).toContain("+2.0000"); // final 10 → 12 within the selection
        expect(text).toContain("+20.0%");
        output.mockClear();
        // A skipped stub row never counts toward a matching selection either.
        await Effect.runPromise(evalsCommand(["--report", "--group", "agentic", "--delta"], { historyRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
        const agentic = output.mock.calls.map((call) => String(call[0])).join("");
        expect(agentic).toContain("run set: eval-20260103T000000.000");
        expect(agentic).toContain("eval-20260102T000000.000 → eval-20260103T000000.000 (agentic-case#1)");
        expect(agentic).toContain("agentic-case#1");
        // A tag keyword selects across groups but never relabels: agentic-case
        // (group agentic, from 0103) and tuning-case (group tuning, from 0102)
        // each keep their own group, so the board splits into one table per
        // group instead of one table named after the keyword.
        output.mockClear();
        await Effect.runPromise(evalsCommand(["--report", "--group", "tflops", "--delta"], { historyRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
        const board = output.mock.calls.map((call) => String(call[0])).join("");
        expect(board).toContain("run set: gathered eval-20260102T000000.000..eval-20260103T000000.000");
        expect(board).toContain("Matrix (agentic)");
        expect(board).toContain("Matrix (tuning)");
        expect(board).not.toContain("Matrix (tflops)");
        expect(board).toContain("Δ vs previous record (agentic)");
        expect(board).toContain("Δ vs previous record (tuning)");
        expect(board).toContain("tuning-case#1");
        expect(board).toContain("agentic-case#1");
        // One row per case, each carrying its own run-set pair.
        expect(board).toContain("eval-20260101T000000.000 → eval-20260102T000000.000 (tuning-case#1)");
        expect(board).toContain("eval-20260102T000000.000 → eval-20260103T000000.000 (agentic-case#1)");
        expect(board).toContain("+2.0000"); // tuning-case 10 → 12 between its records
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

  it("skips persisted attempts while retaining missing cases", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-evals-skip-existing-"));
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const calls: string[] = [];
    try {
      await makeWorkloads(root, ["case-a", "case-b", "case-c"]);
      const priorRunSet = "eval-20260101T000000.000";
      await mkdir(join(root, priorRunSet), { recursive: true });
      await writeFile(join(root, priorRunSet, "report.json"), reportFixture(priorRunSet, [
        caseFixture(10, { caseId: "case-a", group: "tuning-cuda" }),
        caseFixture(0, { caseId: "case-b", group: "tuning-cuda", status: "failed", error: "previous failure" }),
      ]), "utf8");

      const runCase = (_r: string, kase: { id: string }) => {
        calls.push(kase.id);
        return Effect.succeed(caseFixture(10, { caseId: kase.id, group: "tuning-cuda" }));
      };
      await Effect.runPromise(
        evalsCommand(["--root", root, "--skip-existing", "--parallel=2"], {
          historyRoot: root,
          runCase: runCase as never,
        }).pipe(Effect.provide(NodeFileSystem.layer)),
      );

      expect(calls.sort()).toEqual(["case-c"]);
    } finally {
      output.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs cases up to --parallel while serializing every persisted result", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-evals-parallel-"));
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
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
        evalsCommand(["--root", root, "--parallel=2"], { historyRoot: root, runCase: runCase as never }).pipe(
          Effect.provide(NodeFileSystem.layer),
        ),
      );

      expect(maxActive).toBe(2);
      const report = await runSetReport(root);
      expect(report.cases.map((row: { caseId: string }) => row.caseId).sort())
        .toEqual(["case-a", "case-b", "case-c", "case-d"]);
    } finally {
      output.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});
