import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn as spawnProcess, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Real web-search acceptance, one arm per harness. The test is opt-in because
 * it spends real quota and hits the configured gateway; normal CI remains
 * deterministic while developers can prove the complete CLI path locally:
 * PIANO_HARNESS_REAL_E2E=1 npx vitest run tests/harness/real-web-search.e2e.test.ts
 */
const runReal = process.env.PIANO_HARNESS_REAL_E2E === "1";
const RUN_TIMEOUT_MS = 360_000;
const ARM_TIMEOUT_MS = 300_000;
const entrypoint = fileURLToPath(new URL("../../packages/cli/bin/piano.mjs", import.meta.url));
const recipesDir = fileURLToPath(new URL("../../recipes/workflows", import.meta.url));

const ARMS = [
  { harness: "pi", workflow: "web-search.yml", tool: "web_search" },
  { harness: "dsh", workflow: "web-search-dsh.yml", tool: "web_search" },
  { harness: "claude", workflow: "web-search-claude.yml", tool: "WebSearch" },
] as const;

const searchPrompt = "Use your web search tool exactly once to look up \"CUDA shared memory bank conflict\". Do not answer from memory and do not search again. Reply with one result URL and one sentence about what it is.";

interface ProcessResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textValue).join("\n");
  const object = record(value);
  if (object !== undefined) {
    if (typeof object.text === "string") return object.text;
    if (object.content !== undefined) return textValue(object.content);
  }
  return "";
}

/** Copy the developer's own provider configuration into a disposable HOME,
 * verbatim: the child must resolve the same LLM service a real mission would.
 * Nothing is backfilled from the shipped template — its values are
 * placeholders, and an unconfigured key has to surface as unconfigured rather
 * than as a request to a placeholder endpoint. */
async function createRealHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "piano-web-real-home-"));
  await mkdir(join(home, ".piano", "runs"), { recursive: true });
  const configuredPath = process.env.PIANO_USER_AGENT_CONFIG ?? join(homedir(), ".piano", "agent.config.json");
  const config = JSON.parse(await readFile(configuredPath, "utf8")) as JsonRecord;
  if (process.env.PIANO_REAL_MODEL !== undefined) config.model = process.env.PIANO_REAL_MODEL;
  await writeFile(join(home, ".piano", "agent.config.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return home;
}

function childEnvironment(home: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete environment.PIANO_HARNESS_HOME_ROOT;
  delete environment.PIANO_USER_AGENT_CONFIG;
  return environment;
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The group already exited.
  }
}

function runWorkflow(workspace: string, home: string, workflowPath: string): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawnProcess(process.execPath, [
      entrypoint,
      "-p",
      "--json",
      "--workflow",
      workflowPath,
      searchPrompt,
    ], { cwd: workspace, env: childEnvironment(home), detached: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signalGroup(child, "SIGTERM");
      setTimeout(() => signalGroup(child, "SIGKILL"), 5_000).unref();
      reject(new Error(`real CLI timed out after ${ARM_TIMEOUT_MS}ms; stdout=${stdout.slice(-2000)}; stderr=${stderr.slice(-2000)}`));
    }, ARM_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe.skipIf(!runReal)(" real web_search workflow acceptance", () => {
  let home: string;
  beforeAll(async () => {
    home = await createRealHome();
  });
  afterAll(async () => {
    await rm(home, { recursive: true, force: true });
  });

  for (const arm of ARMS) {
    it(`${arm.harness} really searches via ${arm.tool} through the shipped workflow`, async () => {
      const workspace = await mkdtemp(join(tmpdir(), `piano-web-${arm.harness}-workspace-`));
      try {
        const result = await runWorkflow(workspace, home, join(recipesDir, arm.workflow));
        expect(result.code, `stderr: ${result.stderr.slice(-2000)}`).toBe(0);
        const events = result.stdout
          .split(/\r?\n/)
          .filter((line) => line.trim() !== "")
          .flatMap((line) => {
            try {
              return [record(JSON.parse(line))];
            } catch {
              return [];
            }
          })
          .filter((event): event is JsonRecord => event !== undefined)
          .map((event) => (event.event === "agent_event" ? record(event.data) ?? event : event));
        const started = events.filter((event) => event.type === "tool_execution_start" && event.toolName === arm.tool);
        expect(started.length, `no ${arm.tool} tool_execution_start in stream`).toBeGreaterThan(0);
        const ended = events.filter((event) => event.type === "tool_execution_end" && event.toolName === arm.tool);
        expect(ended.length).toBeGreaterThan(0);
        expect(ended.some((event) => event.isError === true)).toBe(false);
        const finalText = events
          .filter((event) => event.type === "agent_end" || event.type === "message_end")
          .map((event) => textValue(event.type === "agent_end" ? event.messages : event.message))
          .join("\n");
        expect(finalText).toMatch(/https?:\/\//);
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    }, RUN_TIMEOUT_MS + 60_000);
  }
});
