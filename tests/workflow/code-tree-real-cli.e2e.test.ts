// Real-model guard for the regression where a workflow worker received the
// stage wrapper but lost the user's actual task. This intentionally drives the
// shipped CLI and the shipped coding workflow; only the provider call is gated
// behind PIANO_HARNESS_REAL_E2E because it consumes real quota.
import { describe, expect, it } from "vitest";
import { parseTrajectory } from "@piano/logging";
import { spawn as spawnProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const runReal = process.env.PIANO_HARNESS_REAL_E2E === "1";
const RUN_TIMEOUT_MS = 360_000;
const entrypoint = fileURLToPath(new URL("../../packages/cli/bin/piano.mjs", import.meta.url));
const workflowPath = fileURLToPath(new URL("../../recipes/workflows/coding-pi.yml", import.meta.url));
const sourceRoot = fileURLToPath(new URL("../..", import.meta.url));
const userPrompt = "print the code tree of this folder";

const expectedFiles = [
  "AGENTS.md",
  ".claude/settings.local.json",
  "Makefile",
  "a",
  "operators/README.md",
  "operators/matmul.cpp",
  "operators/matmul.cu",
  "operators/matmul_tuned.cu",
  "operators/softmax.cpp",
  "operators/softmax.cu",
  "state/current-best.cu",
  "state/tuning-state.json",
  "tuned_kernel",
  "workflow.yml",
] as const;
const expectedDirectories = [".claude", "operators", "state"] as const;
const expectedFileNames = [...new Set(expectedFiles.map((path) => basename(path)))];

type JsonRecord = Record<string, unknown>;

interface ProcessResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

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
    try {
      return JSON.stringify(object) ?? "";
    } catch {
      return "";
    }
  }
  return "";
}

async function readJson(path: string): Promise<JsonRecord> {
  return JSON.parse(await readFile(path, "utf8")) as JsonRecord;
}

/** Make the real run inspect a known tree, not the Piano source checkout. */
async function seedWorkspace(workspace: string): Promise<void> {
  await mkdir(join(workspace, ".claude"), { recursive: true });
  await mkdir(join(workspace, "operators"), { recursive: true });
  await mkdir(join(workspace, "state"), { recursive: true });
  const files: Readonly<Record<string, string>> = {
    "AGENTS.md": "# Test workspace\n\nNo extra task instructions.\n",
    ".claude/settings.local.json": "{}\n",
    Makefile: "all:\n\t@true\n",
    a: "",
    "operators/README.md": "# Operators\n",
    "operators/matmul.cpp": "int matmul_cpp();\n",
    "operators/matmul.cu": "__global__ void matmul_cuda() {}\n",
    "operators/matmul_tuned.cu": "__global__ void matmul_tuned_cuda() {}\n",
    "operators/softmax.cpp": "int softmax_cpp();\n",
    "operators/softmax.cu": "__global__ void softmax_cuda() {}\n",
    "state/current-best.cu": "baseline\n",
    "state/tuning-state.json": "{\"current_best\": \"state/current-best.cu\"}\n",
    tuned_kernel: "test executable placeholder\n",
    "workflow.yml": "# workspace-local file\n",
  };
  for (const [path, content] of Object.entries(files)) {
    await writeFile(join(workspace, path), content);
  }
}

/** Copy the user's provider configuration into a disposable HOME. The child
 * must resolve config from this copy so the test never mutates ~/.piano, and it
 * is copied verbatim so the run reaches the same LLM service a real mission
 * uses — the shipped template holds placeholders, never a fallback endpoint. */
async function createRealHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "piano-code-tree-real-home-"));
  await mkdir(join(home, ".piano", "runs"), { recursive: true });
  const configuredPath = process.env.PIANO_USER_AGENT_CONFIG ?? join(homedir(), ".piano", "agent.config.json");
  const config = await readJson(configuredPath);
  if (process.env.PIANO_REAL_MODEL !== undefined) config.model = process.env.PIANO_REAL_MODEL;
  await writeFile(join(home, ".piano", "agent.config.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return home;
}

function childEnvironment(home: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  };
  // The vitest process points this at a shared scratch directory. A real child
  // must use the isolated HOME/config above, otherwise concurrent tests can
  // rewrite the generated harness registry under one another.
  delete environment.PIANO_HARNESS_HOME_ROOT;
  delete environment.PIANO_USER_AGENT_CONFIG;
  return environment;
}

async function runHeadless(workspace: string, home: string): Promise<ProcessResult> {
  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawnProcess(process.execPath, [
      entrypoint,
      "-p",
      "--json",
      "--workflow",
      workflowPath,
      userPrompt,
    ], { cwd: workspace, env: childEnvironment(home) });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`real CLI timed out after ${RUN_TIMEOUT_MS}ms; stdout=${stdout.slice(-2000)}; stderr=${stderr.slice(-2000)}`));
    }, RUN_TIMEOUT_MS);
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

function parseNdjson(stdout: string): readonly JsonRecord[] {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
  expect(lines.length).toBeGreaterThan(0);
  return lines.map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`stdout line ${index + 1} is not NDJSON: ${String(error)}\n${line}`);
    }
    const parsed = record(value);
    expect(parsed, `stdout line ${index + 1}`).toBeDefined();
    return parsed ?? {};
  });
}

function eventData(lines: readonly JsonRecord[]): readonly JsonRecord[] {
  return lines
    .filter((line) => line.event === "agent_event")
    .map((line) => record(line.data))
    .filter((value): value is JsonRecord => value !== undefined);
}

async function assertRunEvidence(
  home: string,
  workspace: string,
  lines: readonly JsonRecord[],
): Promise<void> {
  const started = lines.filter((line) => line.event === "run.started");
  const completed = lines.filter((line) => line.event === "run.completed");
  expect(started).toHaveLength(1);
  expect(completed).toHaveLength(1);
  expect(lines.filter((line) => line.event === "run.failed")).toHaveLength(0);
  expect(lines[0]).toMatchObject({ event: "run.started" });
  expect(lines.at(-1)).toMatchObject({ event: "run.completed" });
  expect(started[0]).toMatchObject({ event: "run.started", cwd: workspace });

  const runId = typeof started[0]?.run_id === "string" ? started[0].run_id : "";
  expect(runId).not.toBe("");
  for (const line of lines) expect(line.run_id).toBe(runId);
  expect(completed[0]).toMatchObject({
    event: "run.completed",
    run_id: runId,
    status: "completed",
  });
  const finalText = typeof completed[0]?.text === "string" ? completed[0].text : "";
  expect(finalText).not.toBe("");
  for (const directory of expectedDirectories) expect(finalText).toContain(directory);
  for (const file of expectedFileNames) expect(finalText).toContain(file);
  expect(finalText).toMatch(/3 directories,\s*14 files/);
  expect(finalText).not.toContain(sourceRoot);

  const events = eventData(lines);
  expect(events.length).toBeGreaterThan(0);
  const contextEvents = events.filter((event) => event.type === "context");
  expect(contextEvents).toHaveLength(1);
  const context = record(contextEvents[0]?.context);
  expect(context?.userMessage).toBe(
    `## User task (whole workflow)\n${userPrompt}\n\n## Workflow stage context\n` +
    "The user task above is the complete task for the whole workflow. Use this stage only to advance that task.\n" +
    "Do not replace, broaden, or reinterpret it as a repository review, an autonomous development loop, or duration-based work session unless the user explicitly asks for that.\n" +
    "Repository instruction files constrain how you execute the task; they do not replace or broaden it.\n" +
    "You are executing workflow stage `agent` (agent@root).\n" +
    `Your current workspace is \`${workspace}\`.\n` +
    "Treat that directory as the only mutable task workspace. Do not edit the Piano source tree or run evidence outside it.\n" +
    "The orchestrator injected the following context files; read them before acting:\n" +
    "(none)\n" +
    "Injected context files are immutable upstream evidence; write new artifacts only in the current workspace or the requested result path.",
  );
  const contextWorkflow = record(contextEvents[0]?.workflow);
  expect(contextWorkflow).toMatchObject({
    stageId: "agent",
    invocationId: "agent@root",
    workspaceCwd: workspace,
  });
  expect(events.filter((event) => event.type === "spawn")).toContainEqual(expect.objectContaining({ harness: "pi" }));

  const bashStarts = events.filter((event) => event.type === "tool_execution_start" && event.toolName === "bash");
  expect(bashStarts.length).toBeGreaterThan(0);
  for (const event of bashStarts) {
    expect(record(event.workflow)).toMatchObject({ workspaceCwd: workspace });
  }
  const commands = bashStarts.flatMap((event) => {
    const args = record(event.args);
    return typeof args?.command === "string" ? [args.command] : [];
  });
  expect(commands.some((command) => /\b(tree|find|ls)\b/.test(command))).toBe(true);

  const bashResults = events.filter((event) => event.type === "tool_execution_end" && event.toolName === "bash");
  expect(bashResults.length).toBeGreaterThanOrEqual(bashStarts.length);
  expect(bashResults.every((event) => event.isError === false)).toBe(true);
  for (const start of bashStarts) {
    expect(bashResults.some((end) => end.toolCallId === start.toolCallId)).toBe(true);
  }
  const toolOutput = bashResults.map((event) => textValue(event.result)).join("\n");
  for (const directory of expectedDirectories) expect(toolOutput).toContain(directory);
  for (const file of expectedFileNames) expect(toolOutput).toContain(file);

  const runDir = join(home, ".piano", "runs", runId);
  const trajectory = (parseTrajectory(await readFile(join(runDir, "system-log", "trajectory.jsonl"), "utf8")) ?? {}) as Record<string, unknown>;
  expect(trajectory).toMatchObject({
    status: "completed",
    workflowPath,
    workspaceCwd: workspace,
  });
  const turns = Array.isArray(trajectory.turns) ? trajectory.turns : [];
  expect(turns).toHaveLength(1);
  expect(record(turns[0])?.prompt).toBe(userPrompt);
  const trajectoryEvents = Array.isArray(trajectory.events) ? trajectory.events.map(record).filter((value): value is JsonRecord => value !== undefined) : [];
  expect(trajectoryEvents.some((event) => event.type === "context" && record(event.context)?.userMessage === context?.userMessage)).toBe(true);
  expect(trajectoryEvents.some((event) => event.type === "tool_execution_start" && event.toolName === "bash")).toBe(true);

  const transcriptPath = typeof trajectory.transcriptPath === "string" ? trajectory.transcriptPath : "";
  expect(transcriptPath).not.toBe("");
  const transcript = await readFile(transcriptPath, "utf8");
  expect(transcript).toContain("## User task (whole workflow)");
  expect(transcript).toContain(userPrompt);
  expect(transcript).toContain(workspace);
}

describe.skipIf(!runReal)("code-tree user task through the real CLI", () => {
  it("passes the whole-workflow prompt to the real worker and prints this workspace's tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-code-tree-real-"));
    let home: string | undefined;
    try {
      home = await createRealHome();
      const workspace = join(root, "workspace");
      await mkdir(workspace, { recursive: true });
      await seedWorkspace(workspace);
      const result = await runHeadless(workspace, home);
      expect(result.code, `stderr: ${result.stderr}`).toBe(0);
      const lines = parseNdjson(result.stdout);
      await assertRunEvidence(home, workspace, lines);
    } finally {
      await rm(root, { recursive: true, force: true });
      if (home !== undefined) await rm(home, { recursive: true, force: true });
    }
  }, RUN_TIMEOUT_MS + 60_000);
});
