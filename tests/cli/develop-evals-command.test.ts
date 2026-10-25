import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evalsCommand } from "../../packages/cli/src/evals.js";
import { buildReport } from "../../packages/evals/src/scorer.js";
import type { CaseResult, EvalCase } from "../../packages/evals/src/types.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function resultFor(kase: EvalCase, status: CaseResult["status"] = "skipped"): CaseResult {
  return {
    caseId: kase.id,
    trial: 1,
    group: kase.group,
    ...(kase.dimensions === undefined ? {} : { dimensions: kase.dimensions }),
    tags: kase.tags.map(({ tag }) => tag),
    status,
    workspaceDir: "/tmp/develop-eval",
    trace: {
      complete: true,
      issues: [],
      messages: { count: 1, rounds: 1 },
      tokens: { count: 1, input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
      tools: { count: 2, failures: 0, names: ["read", "edit"], totalDurationMs: 0 },
      duration: { count: 0, totalMs: 0, maxMs: 0 },
      benchmarks: [],
      stages: status === "completed" && kase.dimensions !== undefined
        ? [{
            invocationId: "coding@root",
            stageId: "coding",
            worker: "basic",
            requestedThinkingLevel: kase.dimensions.effort,
            thinkingLevel: "off",
            tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
            toolCalls: { count: 2, failures: 0 },
          }]
        : [],
    },
    artifact: status === "completed"
      ? {
          verified: false,
          testSummary: { passed: 1264, failed: 3, skipped: 21, total: 1288, passRate: 1264 / 1267 },
        }
      : { verified: false },
    codeChanges: { files: 1, additions: 4, deletions: 2, total: 6, testIntegrity: { cheating: false, addedFiles: 0, modifiedFiles: 0, deletedFiles: 0 } },
    durationMs: 1000,
  };
}

describe("develop eval commands", () => {
  it("selects all generated single-stage coding cases", async () => {
    const seen: EvalCase[] = [];
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await Effect.runPromise(evalsCommand(["--group", "develop", "--dry-run"], {
      runCase: (_root, kase) => Effect.sync(() => {
        seen.push(kase);
        return resultFor(kase);
      }),
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen.map((kase) => kase.id)).size).toBe(seen.length);
    expect(seen.every((kase) => kase.dimensions !== undefined)).toBe(true);
    expect(output.mock.calls.map((call) => String(call[0])).join(""))
      .toContain("Matrix (develop)");
  });

  it("reports only persisted develop results", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "piano-develop-report-"));
    temporaryRoots.push(outputRoot);
    const runSetId = "eval-20260909T000000.000";
    const runSetDir = join(outputRoot, runSetId);
    await mkdir(runSetDir, { recursive: true });
    const developCase = {
      id: "footer-workflow-column-width-pi-deepseek-v4-flash-max",
      group: "develop",
      dimensions: {
        task: "footer-workflow-column-width",
        harness: "pi",
        model: "deepseek-v4-flash",
        effort: "max",
      },
      prompt: "fix",
      command: "true",
      workspace: "workspace",
      readout: { kind: "programmatic" as const, compileCommand: "true", verifyCommand: "npm test" },
      tags: [{ tag: "sw-dev", weight: 1 }],
    } satisfies EvalCase;
    const unrelated = { ...developCase, id: "unrelated", group: "tuning" };
    const report = buildReport(runSetId, "2026-09-09T00:00:00.000Z", [
      resultFor(developCase, "completed"),
      resultFor(unrelated, "completed"),
    ]);
    await writeFile(join(runSetDir, "report.json"), `${JSON.stringify(report)}\n`, "utf8");
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await Effect.runPromise(evalsCommand(["--report", "--group", "develop"], { outputRoot }).pipe(
      Effect.provide(NodeFileSystem.layer),
    ));

    const text = output.mock.calls.map((call) => String(call[0])).join("");
    expect(text).toContain("Matrix (develop)");
    expect(text).toContain(developCase.id);
    expect(text).toContain("/ pi");
    expect(text).toContain("pass%");
    expect(text).toContain("1264/1267");
    expect(text).toContain("99.8%");
    expect(text).toContain(`${String.fromCharCode(27)}[31m 99.8%`);
    expect(text).toContain("21");
    expect(text).toContain("requested=max effective=off");
    expect(text).toContain("LOC");
    expect(text).not.toContain("vs-base");
    expect(text).not.toContain("tok-eff");
    expect(text).not.toContain("unrelated#1");
    // eslint-disable-next-line no-control-regex -- compare visible report widths without SGR bytes
    const plain = text.replace(/\x1b\[[0-9;]*m/g, "");
    const matrix = plain.split("\n").slice(
      plain.split("\n").findIndex((line) => line.startsWith("Matrix (develop)")),
      plain.split("\n").findIndex((line) => line.startsWith("Overall")),
    );
    expect(Math.max(...matrix.map((line) => line.length))).toBeLessThanOrEqual(100);
  });
});