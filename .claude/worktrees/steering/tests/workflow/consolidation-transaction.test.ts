import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { selectionCarryingSchema } from "../../packages/trajectory/src/schemas.js";
import {
  prepareConsolidationEvidence,
  runConsolidationTransaction,
  type ConsolidationCarrying,
  type ConsolidationEvidenceInput,
} from "../../packages/orchestrator/src/consolidation-transaction.js";
import { workflowError } from "../../packages/orchestrator/src/errors.js";
import type {
  GitMetadataRollbackReport,
  GitMetadataTransaction,
} from "../../packages/orchestrator/src/git-metadata-transaction.js";
import { consolidateAndGate } from "../../packages/orchestrator/src/workflow-execution.js";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";

const execFileAsync = promisify(execFile);

interface Fixture {
  readonly root: string;
  readonly source: string;
  readonly runDir: string;
  readonly winner: string;
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "piano-consolidation-transaction-"));
  const source = join(root, "source");
  const runDir = join(root, "run");
  const winner = join(root, "winner");
  await mkdir(source);
  await mkdir(runDir);
  await mkdir(winner);
  await writeFile(join(source, "kernel.py"), "baseline\n");
  await writeFile(join(source, "untouched.txt"), "preserve\n");
  await writeFile(join(winner, "kernel.py"), "winner\n");
  return { root, source, runDir, winner };
}

async function cleanup(fixtureRoot: string): Promise<void> {
  await rm(fixtureRoot, { recursive: true, force: true });
}

async function evidenceInput(fixture: Fixture, overrides: Partial<ConsolidationEvidenceInput> = {}) {
  return prepareConsolidationEvidence({
    sourceCwd: fixture.source,
    runDir: fixture.runDir,
    winnerContentDir: fixture.winner,
    excludeUnder: [],
    ...overrides,
  });
}

function nonGitTransaction(sourceCwd: string, rollback: () => Promise<GitMetadataRollbackReport> = async () => ({
  kind: "non-git" as const,
  restored: true,
  changed: [],
  failures: [],
  residues: [],
})) {
  return {
    kind: "non-git" as const,
    sourceCwd,
    observe: async () => [],
    commit: async () => undefined,
    rollback,
  } satisfies GitMetadataTransaction;
}

async function runTransaction(
  evidence: Awaited<ReturnType<typeof prepareConsolidationEvidence>>,
  options: {
    readonly runTurn: () => Promise<void>;
    readonly persistAfterCarry?: () => Effect.Effect<void, ReturnType<typeof workflowError>, FileSystem.FileSystem>;
    readonly gitMetadataFactory?: (sourceCwd: string) => Promise<GitMetadataTransaction>;
    readonly repairAttempts?: number;
  },
): Promise<ConsolidationCarrying> {
  const effect = runConsolidationTransaction<FileSystem.FileSystem>({
    evidence,
    repairAttempts: options.repairAttempts ?? 0,
    runTurn: () => Effect.promise(options.runTurn),
    ...(options.persistAfterCarry === undefined ? {} : { persistAfterCarry: options.persistAfterCarry }),
    ...(options.gitMetadataFactory === undefined ? {} : { gitMetadataFactory: options.gitMetadataFactory }),
  });
  return Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer)));
}

describe("external consolidation transaction", () => {
  it("keeps source-state evidence optional while accepting the new carrying fields", () => {
    expect(selectionCarryingSchema.parse({ kind: "carry-failed" })).toEqual({ kind: "carry-failed" });
    expect(selectionCarryingSchema.parse({
      kind: "carry-failed",
      sourceState: "unknown",
      externalEvidenceRoot: "/tmp/piano-consolidation-evidence",
    })).toMatchObject({ sourceState: "unknown" });
  });

  it("keeps canonical snapshots outside source/run and cleans them after a successful legacy-shaped carry", async () => {
    const testFixture = await fixture();
    try {
      const evidence = await evidenceInput(testFixture);
      expect(relative(testFixture.source, evidence.externalRoot)).toMatch(/^\.\.[\\/]/u);
      expect(relative(testFixture.runDir, evidence.externalRoot)).toMatch(/^\.\.[\\/]/u);
      await expect(lstat(evidence.targetBeforeDir)).resolves.toBeDefined();
      await expect(lstat(evidence.winnerChangeDir)).resolves.toBeDefined();
      expect((await readdir(testFixture.source)).includes("executions")).toBe(false);

      const result = await runTransaction(evidence, {
        runTurn: async () => {
          await writeFile(join(testFixture.source, "kernel.py"), "winner\n");
          await rm(join(testFixture.source, "untouched.txt"), { force: true });
        },
      });

      expect(result).toMatchObject({ kind: "worker-consolidated", sourceState: "known" });
      await expect(readFile(join(testFixture.source, "kernel.py"), "utf8")).resolves.toBe("winner\n");
      await expect(lstat(evidence.externalRoot)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(lstat(join(testFixture.source, "executions"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await cleanup(testFixture.root);
    }
  });

  it("blocks before the first worker turn when source drifts after target-before is captured", async () => {
    const testFixture = await fixture();
    let turnCalls = 0;
    try {
      const evidence = await evidenceInput(testFixture);
      await writeFile(join(testFixture.source, "kernel.py"), "concurrent drift\n");
      const result = await runTransaction(evidence, {
        runTurn: async () => {
          turnCalls += 1;
        },
      });
      expect(result).toMatchObject({
        kind: "carry-failed",
        sourceState: "unknown",
        externalEvidenceRoot: evidence.externalRoot,
      });
      expect(result.reason).toMatch(/pre-worker consolidation baseline verification failed.*does not match target-before before first worker turn/u);
      expect(turnCalls).toBe(0);
      await expect(readFile(join(testFixture.source, "kernel.py"), "utf8")).resolves.toBe("concurrent drift\n");
    } finally {
      await cleanup(testFixture.root);
    }
  });

  it("rechecks the source baseline after Git transaction creation before the first worker turn", async () => {
    const testFixture = await fixture();
    let turnCalls = 0;
    let rollbackCalls = 0;
    try {
      const evidence = await evidenceInput(testFixture);
      const result = await runTransaction(evidence, {
        runTurn: async () => {
          turnCalls += 1;
        },
        gitMetadataFactory: async (sourceCwd) => {
          await writeFile(join(sourceCwd, "kernel.py"), "factory drift\n");
          return nonGitTransaction(sourceCwd, async () => {
            rollbackCalls += 1;
            return { kind: "non-git", restored: true, changed: [], failures: [], residues: [] };
          });
        },
      });
      expect(result).toMatchObject({ kind: "carry-failed", sourceState: "known" });
      expect(result).not.toHaveProperty("externalEvidenceRoot");
      expect(result.reason).toMatch(/pre-worker consolidation baseline verification failed after Git metadata transaction creation.*does not match target-before before first worker turn after Git metadata transaction creation/u);
      expect(turnCalls).toBe(0);
      expect(rollbackCalls).toBe(1);
      await expect(readFile(join(testFixture.source, "kernel.py"), "utf8")).resolves.toBe("baseline\n");
      await expect(lstat(evidence.externalRoot)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await cleanup(testFixture.root);
    }
  });

  it.each([
    ["success", "commit"],
    ["fully-restored rollback", "rollback"],
  ] as const)("keeps external evidence when convenience cleanup fails after %s", async (_label, cleanupPhase) => {
    const testFixture = await fixture();
    try {
      const evidence = await evidenceInput(testFixture);
      const transaction: GitMetadataTransaction = {
        kind: "non-git",
        sourceCwd: evidence.sourceCwd,
        observe: async () => [],
        commit: async () => {
          if (cleanupPhase === "commit") await rm(testFixture.runDir, { recursive: true, force: true });
        },
        rollback: async () => {
          if (cleanupPhase === "rollback") await rm(testFixture.runDir, { recursive: true, force: true });
          return { kind: "non-git", restored: true, changed: [], failures: [], residues: [] };
        },
      };
      const result = await runTransaction(evidence, {
        runTurn: async () => {
          if (cleanupPhase === "commit") {
            await writeFile(join(testFixture.source, "kernel.py"), "winner\n");
            await rm(join(testFixture.source, "untouched.txt"), { force: true });
          } else {
            await writeFile(join(testFixture.source, "kernel.py"), "wrong\n");
          }
        },
        gitMetadataFactory: async () => transaction,
      });
      expect(result).toMatchObject({
        kind: cleanupPhase === "commit" ? "worker-consolidated" : "carry-failed",
        sourceState: "known",
        externalEvidenceRoot: evidence.externalRoot,
      });
      await expect(lstat(evidence.externalRoot)).resolves.toBeDefined();
    } finally {
      await cleanup(testFixture.root);
    }
  });

  it("does not report a damaged external tree as recoverable after cleanup fails", async () => {
    const testFixture = await fixture();
    try {
      const evidence = await evidenceInput(testFixture);
      const result = await runTransaction(evidence, {
        runTurn: async () => {
          await writeFile(join(testFixture.source, "kernel.py"), "winner\n");
          await rm(join(testFixture.source, "untouched.txt"), { force: true });
        },
        gitMetadataFactory: async (sourceCwd) => ({
          ...nonGitTransaction(sourceCwd),
          commit: async () => {
            await rm(evidence.targetBeforeDir, { recursive: true, force: true });
            await rm(testFixture.runDir, { recursive: true, force: true });
          },
        }),
      });
      expect(result).toMatchObject({ kind: "worker-consolidated", sourceState: "known" });
      expect(result).not.toHaveProperty("externalEvidenceRoot");
      expect(result.reason).toMatch(/runDir convenience cleanup failed.*canonical external evidence manifest\/snapshot verification failed.*externalEvidenceRoot omitted/u);
      await expect(lstat(evidence.externalRoot)).resolves.toBeDefined();
    } finally {
      await cleanup(testFixture.root);
    }
  });

  it.each([
    ["sentinel", "sentinelPath"],
    ["convenience evidence", "convenienceEvidencePath"],
  ] as const)("preserves external evidence when %s is tampered", async (_label, field) => {
    const testFixture = await fixture();
    try {
      const evidence = await evidenceInput(testFixture);
      await writeFile(evidence[field], "tampered\n");
      const result = await runTransaction(evidence, {
        runTurn: async () => undefined,
      });
      expect(result.kind).toBe("carry-failed");
      expect(result.sourceState).toBe("unknown");
      expect(result.externalEvidenceRoot).toBe(evidence.externalRoot);
      await expect(lstat(evidence.externalRoot)).resolves.toBeDefined();
      await expect(readFile(join(testFixture.source, "kernel.py"), "utf8")).resolves.toBe("baseline\n");
    } finally {
      await cleanup(testFixture.root);
    }
  });

  it.each([
    ["deleted", async (runDir: string) => {
      await rm(runDir, { recursive: true, force: true });
    }],
    ["replaced by a symlink", async (runDir: string) => {
      await rm(runDir, { recursive: true, force: true });
      await symlink(resolve(runDir, "..", "source"), runDir);
    }],
  ] as const)("marks source state unknown when runDir is %s", async (_label, replaceRunDir) => {
    const testFixture = await fixture();
    try {
      const evidence = await evidenceInput(testFixture);
      await runTransaction(evidence, {
        runTurn: () => replaceRunDir(testFixture.runDir),
      }).then(async (result) => {
        expect(result.kind).toBe("carry-failed");
        expect(result.sourceState).toBe("unknown");
        expect(result.externalEvidenceRoot).toBe(evidence.externalRoot);
        await expect(lstat(evidence.externalRoot)).resolves.toBeDefined();
      });
    } finally {
      try {
        const info = await lstat(testFixture.runDir);
        if (info.isSymbolicLink()) await unlink(testFixture.runDir);
      } catch { /* fixture cleanup owns the remaining directory */ }
      await cleanup(testFixture.root);
    }
  });

  it.each([
    ["deleted", async (runDir: string, _replacement: string) => {
      await rm(runDir, { recursive: true, force: true });
    }],
    ["replaced by a symlink", async (runDir: string, replacement: string) => {
      await rm(runDir, { recursive: true, force: true });
      await symlink(replacement, runDir);
    }],
  ] as const)("detects a nested runDir %s without restoring or deleting it", async (_label, replaceRunDir) => {
    const testFixture = await fixture();
    const nestedRunDir = join(testFixture.source, ".piano-run");
    const replacement = join(testFixture.root, "run-replacement");
    await mkdir(nestedRunDir);
    await mkdir(replacement);
    try {
      const evidence = await evidenceInput(testFixture, { runDir: nestedRunDir });
      const result = await runTransaction(evidence, {
        runTurn: () => replaceRunDir(nestedRunDir, replacement),
      });
      expect(result).toMatchObject({
        kind: "carry-failed",
        sourceState: "unknown",
        externalEvidenceRoot: evidence.externalRoot,
      });
      await expect(lstat(evidence.externalRoot)).resolves.toBeDefined();
    } finally {
      try {
        const info = await lstat(nestedRunDir);
        if (info.isSymbolicLink()) await unlink(nestedRunDir);
      } catch { /* fixture cleanup owns a deleted nested run directory */ }
      await cleanup(testFixture.root);
    }
  });

  it("observes Git metadata even when a consolidation worker turn fails", async () => {
    const testFixture = await fixture();
    let observeCalls = 0;
    try {
      const evidence = await evidenceInput(testFixture);
      const transaction = nonGitTransaction(evidence.sourceCwd);
      const result = await Effect.runPromise(runConsolidationTransaction<FileSystem.FileSystem>({
        evidence,
        repairAttempts: 0,
        runTurn: () => Effect.gen(function* () {
          yield* Effect.promise(() => writeFile(join(testFixture.source, "kernel.py"), "partial\n"));
          return yield* Effect.fail(workflowError("schedule", testFixture.source, "forced worker failure"));
        }),
        gitMetadataFactory: async () => ({
          ...transaction,
          observe: async () => {
            observeCalls += 1;
            return [];
          },
        } satisfies GitMetadataTransaction),
      }).pipe(Effect.provide(NodeFileSystem.layer)));
      expect(result).toMatchObject({ kind: "carry-failed", sourceState: "known" });
      expect(observeCalls).toBe(1);
      await expect(readFile(join(testFixture.source, "kernel.py"), "utf8")).resolves.toBe("baseline\n");
    } finally {
      await cleanup(testFixture.root);
    }
  });

  it("records each repair turn with observe without treating the later observe as concurrency", async () => {
    const testFixture = await fixture();
    let turnCalls = 0;
    let observeCalls = 0;
    let commitCalls = 0;
    try {
      const evidence = await evidenceInput(testFixture);
      const result = await runTransaction(evidence, {
        repairAttempts: 1,
        runTurn: async () => {
          turnCalls += 1;
          if (turnCalls === 1) {
            await writeFile(join(testFixture.source, "kernel.py"), "wrong\n");
          } else {
            await writeFile(join(testFixture.source, "kernel.py"), "winner\n");
            await rm(join(testFixture.source, "untouched.txt"), { force: true });
          }
        },
        gitMetadataFactory: async (sourceCwd) => ({
          ...nonGitTransaction(sourceCwd),
          observe: async () => {
            observeCalls += 1;
            return [];
          },
          commit: async () => {
            commitCalls += 1;
          },
        } satisfies GitMetadataTransaction),
      });
      expect(result).toMatchObject({ kind: "worker-consolidated", sourceState: "known" });
      expect(turnCalls).toBe(2);
      expect(observeCalls).toBe(2);
      expect(commitCalls).toBe(1);
    } finally {
      await cleanup(testFixture.root);
    }
  });

  it("attempts Git rollback when filesystem rollback fails and preserves evidence", async () => {
    const testFixture = await fixture();
    const replacement = join(testFixture.root, "source-replacement");
    await mkdir(replacement);
    let rollbackCalls = 0;
    try {
      const evidence = await evidenceInput(testFixture);
      const result = await runTransaction(evidence, {
        runTurn: async () => {
          await rm(testFixture.source, { recursive: true, force: true });
          await symlink(replacement, testFixture.source);
        },
        gitMetadataFactory: async (sourceCwd) => nonGitTransaction(sourceCwd, async () => {
          rollbackCalls += 1;
          return { kind: "non-git", restored: true, changed: [], failures: [], residues: [] };
        }),
      });
      expect(result).toMatchObject({
        kind: "carry-failed",
        sourceState: "unknown",
        externalEvidenceRoot: evidence.externalRoot,
      });
      expect(rollbackCalls).toBe(1);
      await expect(lstat(evidence.externalRoot)).resolves.toBeDefined();
    } finally {
      try {
        const info = await lstat(testFixture.source);
        if (info.isSymbolicLink()) await unlink(testFixture.source);
      } catch { /* fixture cleanup owns a missing source */ }
      await cleanup(testFixture.root);
    }
  });

  it("records worker Git metadata in the turn and rolls it back with the failed gate", async () => {
    const testFixture = await fixture();
    try {
      await execFileAsync("git", ["-C", testFixture.source, "init", "-q"]);
      await execFileAsync("git", ["-C", testFixture.source, "config", "user.email", "piano-tests@example.invalid"]);
      await execFileAsync("git", ["-C", testFixture.source, "config", "user.name", "Piano Tests"]);
      await execFileAsync("git", ["-C", testFixture.source, "add", "-A"]);
      await execFileAsync("git", ["-C", testFixture.source, "commit", "-qm", "auto-commit boundary"]);
      const beforeHead = (await execFileAsync("git", ["-C", testFixture.source, "rev-parse", "HEAD"])).stdout.trim();
      const evidence = await evidenceInput(testFixture);
      const result = await runTransaction(evidence, {
        runTurn: async () => {
          await writeFile(join(testFixture.source, "kernel.py"), "wrong\n");
          await execFileAsync("git", ["-C", testFixture.source, "add", "kernel.py"]);
          await execFileAsync("git", ["-C", testFixture.source, "update-ref", "refs/piano/consolidation-test", "HEAD"]);
        },
      });
      expect(result).toMatchObject({ kind: "carry-failed", sourceState: "known" });
      expect((await execFileAsync("git", ["-C", testFixture.source, "rev-parse", "HEAD"])).stdout.trim()).toBe(beforeHead);
      await expect(execFileAsync("git", ["-C", testFixture.source, "show-ref", "--verify", "--quiet", "refs/piano/consolidation-test"])).rejects.toBeDefined();
      await expect(readFile(join(testFixture.source, "kernel.py"), "utf8")).resolves.toBe("baseline\n");
    } finally {
      await cleanup(testFixture.root);
    }
  });

  it.each([
    ["gate", async (source: string) => writeFile(join(source, "kernel.py"), "wrong\n"), undefined],
    ["persistence", async (source: string) => writeFile(join(source, "kernel.py"), "winner\n"), Effect.fail(workflowError("schedule", "persist", "forced persistence failure"))],
  ] as const)("attempts Git rollback independently when %s fails", async (_label, mutate, persistence) => {
    const testFixture = await fixture();
    let rollbackCalls = 0;
    try {
      const evidence = await evidenceInput(testFixture);
      const result = await runTransaction(evidence, {
        runTurn: () => mutate(testFixture.source),
        ...(persistence === undefined ? {} : { persistAfterCarry: () => persistence }),
        gitMetadataFactory: async (sourceCwd) => nonGitTransaction(sourceCwd, async () => {
          rollbackCalls += 1;
          return { kind: "non-git", restored: true, changed: [], failures: [], residues: [] };
        }),
      });
      expect(result.kind).toBe("carry-failed");
      expect(rollbackCalls).toBe(1);
      await expect(readFile(join(testFixture.source, "kernel.py"), "utf8")).resolves.toBe("baseline\n");
    } finally {
      await cleanup(testFixture.root);
    }
  });

  it("reruns the source delta gate after successful persistence and rolls back persistence mutations", async () => {
    const testFixture = await fixture();
    let commitCalls = 0;
    let rollbackCalls = 0;
    try {
      const evidence = await evidenceInput(testFixture);
      const result = await runTransaction(evidence, {
        runTurn: async () => {
          await writeFile(join(testFixture.source, "kernel.py"), "winner\n");
          await rm(join(testFixture.source, "untouched.txt"), { force: true });
        },
        persistAfterCarry: () => Effect.promise(() => writeFile(
          join(testFixture.source, "kernel.py"),
          "persistence mutation\n",
        )),
        gitMetadataFactory: async (sourceCwd) => ({
          ...nonGitTransaction(sourceCwd),
          commit: async () => {
            commitCalls += 1;
          },
          rollback: async () => {
            rollbackCalls += 1;
            return { kind: "non-git", restored: true, changed: [], failures: [], residues: [] };
          },
        }),
      });
      expect(result).toMatchObject({ kind: "carry-failed", sourceState: "known" });
      expect(result.reason).toMatch(/post-persistence source delta gate rejected changes.*kernel\.py/u);
      expect(commitCalls).toBe(0);
      expect(rollbackCalls).toBe(1);
      await expect(readFile(join(testFixture.source, "kernel.py"), "utf8")).resolves.toBe("baseline\n");
      await expect(readFile(join(testFixture.source, "untouched.txt"), "utf8")).resolves.toBe("preserve\n");
    } finally {
      await cleanup(testFixture.root);
    }
  });

  it("keeps external evidence and reports unknown source when Git rollback fails", async () => {
    const testFixture = await fixture();
    try {
      const evidence = await evidenceInput(testFixture);
      const result = await runTransaction(evidence, {
        runTurn: async () => writeFile(join(testFixture.source, "kernel.py"), "wrong\n"),
        gitMetadataFactory: async (sourceCwd) => nonGitTransaction(sourceCwd, async () => {
          throw new Error("forced Git rollback failure");
        }),
      });
      expect(result).toMatchObject({ kind: "carry-failed", sourceState: "unknown", externalEvidenceRoot: evidence.externalRoot });
      await expect(lstat(evidence.externalRoot)).resolves.toBeDefined();
      await expect(readFile(join(testFixture.source, "kernel.py"), "utf8")).resolves.toBe("baseline\n");
    } finally {
      await cleanup(testFixture.root);
    }
  });

  it("routes the legacy consolidateAndGate adapter through the same external core", async () => {
    const testFixture = await fixture();
    try {
      const session = await Effect.runPromise(
        createSession({
          root: testFixture.root,
          cwd: testFixture.source,
          runsRoot: join(testFixture.root, "runs"),
        }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const result = await Effect.runPromise(
        consolidateAndGate({
          request: {
            runDir: session.runDir,
            cwd: testFixture.source,
            prompt: "apply the winner",
            agentRunner: (agentRequest) => Effect.promise(async () => {
              await writeFile(join(agentRequest.cwd, "kernel.py"), "winner\n");
              await rm(join(agentRequest.cwd, "untouched.txt"), { force: true });
              return {
                sessionId: "legacy-consolidation",
                transcriptPath: join(session.runDir, "legacy.jsonl"),
                text: "done",
              };
            }),
          },
          winnerKey: "legacy-slot",
          winnerContentDir: testFixture.winner,
          winnerWorker: "basic",
          winnerHarness: "pi",
          sourceCwd: testFixture.source,
          excludeUnder: [],
        }).pipe(
          Effect.provideService(Logging, loggingService(session.log, session.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      expect(result).toMatchObject({ kind: "worker-consolidated", sourceState: "known" });
      await expect(readFile(join(testFixture.source, "kernel.py"), "utf8")).resolves.toBe("winner\n");
      await expect(lstat(join(testFixture.source, "untouched.txt"))).rejects.toMatchObject({ code: "ENOENT" });
      const runEntries = await readdir(session.runDir);
      expect(runEntries.some((entry) => entry === "legacy-consolidations")).toBe(false);
      expect(runEntries.some((entry) => entry === "prompts")).toBe(false);
    } finally {
      await cleanup(testFixture.root);
    }
  });
});
