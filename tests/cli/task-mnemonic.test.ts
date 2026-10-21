import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { describe, expect, it } from "vitest";
import { loggingService, Logging, createSession } from "../../packages/logging/src/index.js";
import { mnemonicNamespace } from "../../packages/orchestrator/src/index.js";
import {
  normalizeMnemonic,
  summarizeTaskMnemonic,
  TASK_MNEMONIC_DIR,
} from "../../packages/cli/src/task-mnemonic.js";
import type { AgentRequest, AgentResult } from "../../packages/harness/src/index.js";
import { AgentError } from "../../packages/harness/src/index.js";

function result(text: string): AgentResult {
  return { sessionId: "s", transcriptPath: "/tmp/s.jsonl", text };
}

describe("task mnemonic", () => {
  it("normalizes a summary line into a workflow identifier", () => {
    expect(normalizeMnemonic("GEMM tuning!\n")).toBe("gemm-tuning");
    expect(normalizeMnemonic("  relu fusion  \nsecond line")).toBe("relu-fusion");
    expect(normalizeMnemonic("```\ntile-kernel\n```")).toBeUndefined();
    expect(normalizeMnemonic("!!!")).toBeUndefined();
    expect(normalizeMnemonic("")).toBeUndefined();
    expect(normalizeMnemonic("123-start")).toBeUndefined();
    expect(normalizeMnemonic(`${"a".repeat(80)}`)).toBe("a".repeat(32));
  });

  it("namespaces the slug with the run id", () => {
    expect(mnemonicNamespace("gemm", "20261021T101010-ab12cd")).toBe("gemm-20261021T101010-ab12cd");
  });

  it("asks the agent once and returns its slug without workflow evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-mnemonic-"));
    try {
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const requests: AgentRequest[] = [];
      const slug = await Effect.runPromise(summarizeTaskMnemonic({
        prompt: "Tune the GEMM kernel for the 4096 case.",
        cwd: root,
        runDir: session.runDir,
        runAgent: (request) => {
          requests.push(request);
          return Effect.succeed(result("gemm-kernel\n"));
        },
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(slug).toBe("gemm-kernel");
      expect(requests).toHaveLength(1);
      expect(requests[0]?.prompt).toContain("GEMM kernel");
      expect(requests[0]?.tools).toEqual([]);
      expect(requests[0]?.sessionDir).toBe(join(session.runDir, "sessions", TASK_MNEMONIC_DIR));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns undefined when the agent fails or answers with no usable word", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-mnemonic-failure-"));
    try {
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const failed = await Effect.runPromise(summarizeTaskMnemonic({
        prompt: "task",
        cwd: root,
        runDir: session.runDir,
        runAgent: () => Effect.fail(new AgentError({ kind: "harness-unavailable", message: "harness missing" })),
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(failed).toBeUndefined();
      const garbage = await Effect.runPromise(summarizeTaskMnemonic({
        prompt: "task",
        cwd: root,
        runDir: session.runDir,
        runAgent: () => Effect.succeed(result("!!!")),
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(garbage).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
