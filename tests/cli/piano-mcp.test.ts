import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { writeTrajectoryRun } from "../common/trajectory-fixture.js";

const SERVER = fileURLToPath(new URL("../../packages/cli/src/piano-mcp.mjs", import.meta.url));

const FAKE_PIANO = `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const runId = process.env.FAKE_RUN_ID ?? "test-run";
const text = process.env.FAKE_TEXT ?? "OK";
const runDir = join(process.env.HOME, ".piano", "runs", runId);
mkdirSync(join(runDir, "system-log"), { recursive: true });
const status = (value) => JSON.stringify({
  status: value,
  plannedStages: 1,
  completedStages: value === "completed" ? 1 : 0,
  stageCounts: { respond: { planned: 1, completed: value === "completed" ? 1 : 0 } },
});
writeFileSync(join(runDir, "status.json"), status("running"));
console.log(JSON.stringify({ event: "run.started", run_id: runId, cwd: process.cwd() }));
if (process.env.FAKE_MODE === "no-start") process.exit(1);
if (process.env.FAKE_MODE === "fail-after-start") {
  setImmediate(() => {
    console.log(JSON.stringify({ event: "run.failed", run_id: runId, code: "boom", error: "fake piano failed" }));
    process.exit(1);
  });
} else {
  const wait = Number(process.env.FAKE_WAIT_MS ?? "0");
  setTimeout(() => {
    writeFileSync(join(runDir, "status.json"), status("completed"));
    writeFileSync(
      join(runDir, "system-log", "trajectory.jsonl"),
      JSON.stringify({ events: [{
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text }] },
      }] }) + "\\n",
    );
    console.log(JSON.stringify({
      event: "run.completed",
      run_id: runId,
      status: "completed",
      text,
      status_path: join(runDir, "status.json"),
    }));
  }, wait);
}
`;

interface Server {
  readonly request: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  readonly close: () => Promise<void>;
}

async function fakePiano(root: string): Promise<string> {
  const path = join(root, "fake-piano.mjs");
  await writeFile(path, FAKE_PIANO, "utf8");
  await chmod(path, 0o755);
  return path;
}

async function startServer(root: string, env: Record<string, string>): Promise<Server> {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, HOME: root, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map<number, (message: Record<string, unknown>) => void>();
  let nextId = 0;
  const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity });
  lines.on("line", (line) => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const id = message.id;
    if (typeof id === "number") pending.get(id)?.(message);
  });
  return {
    request: (method, params) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (message) => {
        pending.delete(id);
        if (message.error !== undefined) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result as Record<string, unknown>);
      });
      child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    }),
    close: async () => {
      lines.close();
      child.kill();
      await new Promise((resolve) => child.once("close", resolve));
    },
  };
}

function textOf(result: Record<string, unknown>): string {
  const content = result.content;
  if (!Array.isArray(content) || content.length === 0) return "";
  return String((content[0] as { text?: unknown }).text ?? "");
}

describe("piano MCP server", () => {
  it("lists the three Piano tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-mcp-list-"));
    const server = await startServer(root, { PIANO_MCP_PIANO_BIN: await fakePiano(root) });
    try {
      const init = await server.request("initialize", {});
      expect(init.protocolVersion).toBe("2025-06-18");
      const list = await server.request("tools/list", {});
      const tools = list.tools as Array<{ name: string }>;
      expect(tools.map((tool) => tool.name)).toEqual(["piano_run", "piano_status", "piano_result"]);
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("returns a completed run's summary and output", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-mcp-run-"));
    const server = await startServer(root, {
      PIANO_MCP_PIANO_BIN: await fakePiano(root),
      FAKE_RUN_ID: "short-run",
      FAKE_TEXT: "hello from piano",
    });
    try {
      const result = await server.request("tools/call", {
        name: "piano_run",
        arguments: { prompt: "do work", cwd: root, waitSeconds: 5 },
      });
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toContain("Piano short-run: completed");
      expect(textOf(result)).toContain("hello from piano");
      expect(result.structuredContent).toMatchObject({ runId: "short-run", status: "completed" });
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("returns a running handle and later resolves status/result", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-mcp-running-"));
    const server = await startServer(root, {
      PIANO_MCP_PIANO_BIN: await fakePiano(root),
      FAKE_RUN_ID: "long-run",
      FAKE_TEXT: "finished later",
      FAKE_WAIT_MS: "800",
    });
    try {
      const started = await server.request("tools/call", {
        name: "piano_run",
        arguments: { prompt: "do work", cwd: root, waitSeconds: 0 },
      });
      expect(started.structuredContent).toMatchObject({ runId: "long-run", status: "running" });
      expect(textOf(started)).toContain("Piano long-run: running");

      const status = await server.request("tools/call", {
        name: "piano_status",
        arguments: { runId: "long-run" },
      });
      expect(textOf(status)).toContain("Piano long-run: running");

      // Poll rather than sleep a fixed time: the fake completes after 800ms.
      let result: Record<string, unknown> | undefined;
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        result = await server.request("tools/call", {
          name: "piano_result",
          arguments: { runId: "long-run" },
        });
        if (result.structuredContent !== undefined &&
          (result.structuredContent as Record<string, unknown>).status === "completed") break;
      }
      expect(result?.isError).toBeUndefined();
      expect(textOf(result!)).toContain("finished later");
      expect(result?.structuredContent).toMatchObject({ runId: "long-run", status: "completed" });
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("reports a failed run as a tool error", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-mcp-fail-"));
    const server = await startServer(root, {
      PIANO_MCP_PIANO_BIN: await fakePiano(root),
      FAKE_RUN_ID: "fail-run",
      FAKE_MODE: "fail-after-start",
    });
    try {
      const result = await server.request("tools/call", {
        name: "piano_run",
        arguments: { prompt: "do work", cwd: root, waitSeconds: 2 },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("fake piano failed");
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("reads a persisted run after the live state is gone", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-mcp-persisted-"));
    const runDir = join(root, ".piano", "runs", "persisted-run");
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "status.json"), JSON.stringify({
      status: "completed",
      plannedStages: 2,
      completedStages: 2,
      stageCounts: { a: { planned: 1, completed: 1 }, b: { planned: 1, completed: 1 } },
    }));
    await writeTrajectoryRun(runDir, {
      runId: "persisted-run",
      events: [{ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "persisted output" }] } }],
    });
    const server = await startServer(root, {});
    try {
      const status = await server.request("tools/call", {
        name: "piano_status",
        arguments: { runId: "persisted-run" },
      });
      expect(textOf(status)).toContain("Piano persisted-run: completed");
      expect(status.structuredContent).toMatchObject({ completedStages: 2, plannedStages: 2 });

      const result = await server.request("tools/call", {
        name: "piano_result",
        arguments: { runId: "persisted-run" },
      });
      expect(textOf(result)).toContain("persisted output");
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("rejects a run id that could leave the runs root", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-mcp-traversal-"));
    const server = await startServer(root, { PIANO_MCP_PIANO_BIN: await fakePiano(root) });
    try {
      const result = await server.request("tools/call", {
        name: "piano_status",
        arguments: { runId: "../../etc" },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("runId must be a Piano run id");
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("rejects an unknown run id", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-mcp-unknown-"));
    const server = await startServer(root, { PIANO_MCP_PIANO_BIN: await fakePiano(root) });
    try {
      const result = await server.request("tools/call", {
        name: "piano_status",
        arguments: { runId: "missing" },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("unknown Piano run");
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
