import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn as spawnProcess } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const runReal = process.env.PIANO_HARNESS_REAL_E2E === "1";
const entrypoint = fileURLToPath(new URL("../../packages/cli/bin/piano.mjs", import.meta.url));
const roots: string[] = [];

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function headlessFailureEvidence(home: string): Promise<string> {
  try {
    const runsRoot = join(home, ".piano", "runs");
    const ids = await readdir(runsRoot);
    const evidence = await Promise.all(ids.map(async (id) => {
      const runDir = join(runsRoot, id);
      try {
        const trajectory = await readJson(join(runDir, "trajectory.json"));
        const errors = Array.isArray(trajectory.events)
          ? trajectory.events.filter((event) => typeof event === "object" && event !== null && (event as { type?: unknown }).type === "error").slice(-3)
          : [];
        return `${id}: ${JSON.stringify({ status: trajectory.status, error: trajectory.error, errors })}`;
      } catch {
        return `${id}: trajectory unavailable`;
      }
    }));
    return evidence.join("\n");
  } catch (error) {
    return `run evidence unavailable: ${String(error)}`;
  }
}

interface RunEvidence {
  readonly text: string;
  readonly totalTokens: number;
  readonly transcriptPath: string;
  readonly trajectoryPath: string;
  readonly trajectoryEventCount: number;
  readonly trajectoryEventTypes: readonly string[];
  readonly toolNames: readonly string[];
  readonly toolCallCount: number;
  readonly logPath: string;
  readonly logCount: number;
  readonly tracePath: string;
  readonly traceCount: number;
}

interface TaskCase {
  readonly id: string;
  readonly prompt: string;
  /** Terms required in both final transcripts; exact artifact assertions make
   * this robust to harmless natural-language phrasing differences. */
  readonly answerTerms: readonly string[];
  /** Each group is alternatives for one required operation in the trajectory. */
  readonly requiredToolGroups: readonly (readonly string[])[];
  prepare(workspace: string): Promise<void>;
  verify(workspace: string): Promise<string>;
}

const PARITY_TASK_COUNT = 5;
const PARITY_TRIALS_PER_TASK = 1;
const PARITY_PAIR_COUNT = PARITY_TASK_COUNT * PARITY_TRIALS_PER_TASK;
/** Different model turns can add an inspection command, but a frontend must
 * not turn one task's operational trajectory into a radically longer one. */
const MAX_TOOL_CALL_RATIO = 3;

const cases: readonly TaskCase[] = [
  {
    id: "write-read-file",
    prompt: "Use the write tool to create greeting.txt containing exactly `hello piano` followed by one newline. Use the read tool to read it back. Do not use the network. When done, state that greeting is hello piano.",
    answerTerms: ["greeting", "hello", "piano"],
    requiredToolGroups: [["write"], ["read"]],
    prepare: async () => undefined,
    verify: async (workspace) => {
      await expect(readFile(join(workspace, "greeting.txt"), "utf8")).resolves.toBe("hello piano\n");
      return "greeting is hello piano";
    },
  },
  {
    id: "edit-json",
    prompt: "Use read to inspect data.json. Use the edit tool to change mode from draft to ready, add enabled: true, and remove the 'b' tag. Read the result back, confirm it is valid JSON, and report mode ready. Do not use the network.",
    answerTerms: ["mode", "ready"],
    requiredToolGroups: [["read"], ["edit"]],
    prepare: async (workspace) => writeFile(join(workspace, "data.json"), JSON.stringify({ mode: "draft", tags: ["a", "b"] }, null, 2)),
    verify: async (workspace) => {
      const data = JSON.parse(await readFile(join(workspace, "data.json"), "utf8")) as Record<string, unknown>;
      expect(data).toMatchObject({ mode: "ready", enabled: true, tags: ["a"] });
      return "mode ready";
    },
  },
  {
    id: "bash-sort",
    prompt: "Use bash only with local files to sort and deduplicate words.txt into unique.txt, one word per line. Then use read to verify unique.txt and report the first word. Do not use the network.",
    answerTerms: ["first", "word", "apple"],
    requiredToolGroups: [["bash"], ["read"]],
    prepare: async (workspace) => writeFile(join(workspace, "words.txt"), "pear\napple\npear\nbanana\n"),
    verify: async (workspace) => {
      await expect(readFile(join(workspace, "unique.txt"), "utf8")).resolves.toBe("apple\nbanana\npear\n");
      return "first word apple";
    },
  },
  {
    id: "bash-filesystem",
    prompt: "Use bash commands to create archive/, move notes/a.txt into archive/a.txt, write manifest.txt containing exactly a.txt followed by one newline, then use read to verify archive/a.txt and report first. Do not use the network.",
    answerTerms: ["archive", "first"],
    requiredToolGroups: [["bash"], ["read"]],
    prepare: async (workspace) => {
      await mkdir(join(workspace, "notes"));
      await writeFile(join(workspace, "notes", "a.txt"), "first\n");
    },
    verify: async (workspace) => {
      await expect(readFile(join(workspace, "archive", "a.txt"), "utf8")).resolves.toBe("first\n");
      await expect(readFile(join(workspace, "manifest.txt"), "utf8")).resolves.toBe("a.txt\n");
      return "archive contains first";
    },
  },
  {
    id: "read-extract",
    prompt: "Use read to inspect palette.txt. Use write to create answer.txt containing exactly `blueberry=blue` followed by one newline. Read answer.txt back and report blueberry is blue. Do not use the network.",
    answerTerms: ["blueberry", "blue"],
    requiredToolGroups: [["read"], ["write"]],
    prepare: async (workspace) => writeFile(join(workspace, "palette.txt"), "mango=orange\nblueberry=blue\n"),
    verify: async (workspace) => {
      await expect(readFile(join(workspace, "answer.txt"), "utf8")).resolves.toBe("blueberry=blue\n");
      return "blueberry is blue";
    },
  },
];

function environment(home: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home, TERM: "xterm-256color", COLORTERM: "truecolor" };
  // The suite redirects Piano's generated harness home to a shared scratch
  // directory so unit tests cannot touch the developer's own. A real mission
  // must not inherit that: overriding HOME already isolates it, and sharing the
  // directory with concurrently running tests would let one rewrite the
  // registry this mission is reading.
  delete environment.PIANO_HARNESS_HOME_ROOT;
  return environment;
}

async function runHeadless(workspace: string, home: string, prompt: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess(process.execPath, [entrypoint, "-p", prompt], { cwd: workspace, env: environment(home) });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve()
      : void headlessFailureEvidence(home).then((evidence) => reject(new Error(
        `headless exited ${code}; stdout=${stdout.slice(-4000)}; stderr=${stderr.slice(-4000)}; ${evidence}`,
      ))));
  });
}

async function runTui(workspace: string, home: string, prompt: string, before: ReadonlySet<string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess("script", ["-qefc", `${process.execPath} ${entrypoint}`, "/dev/null"], {
      cwd: workspace,
      env: environment(home),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let submitted = false;
    let finished = false;
    let checkingCompletion = false;
    const runs = join(home, ".piano", "runs");
    const finishWhenCompleted = (): void => {
      if (!submitted || finished || checkingCompletion) return;
      checkingCompletion = true;
      void (async () => {
        try {
          const ids = (await readdir(runs)).filter((id) => !before.has(id));
          if (ids.length === 1) {
            const trajectory = JSON.parse(await readFile(join(runs, ids[0] ?? "", "trajectory.json"), "utf8")) as { status?: string };
            if (trajectory.status === "completed") {
              finished = true;
              child.stdin.write("/exit\r");
            }
          }
        } catch {
          // The run directory is created before trajectory.json; retry on the next tick.
        } finally {
          checkingCompletion = false;
        }
      })();
    };
    const completionTimer = setInterval(finishWhenCompleted, 100);
    // Real-model turns on the direct gateway take 20-40s each (the earlier
    // 90s ceiling was calibrated when a compressing proxy shortened every
    // request). A multi-turn task needs minutes, so the bound is wall-clock
    // headroom, not an assertion of speed.
    const timeout = setTimeout(() => {
      clearInterval(completionTimer);
      child.kill();
      reject(new Error(`TUI timed out: ${output.slice(-500)}`));
    }, 300_000);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      // Face-page headline, used as the "shell is up" marker before typing.
      // It must track the slogan in tui-face.ts: a stale marker never matches,
      // so the prompt is never submitted and the run dies on the test timeout.
      if (!submitted && output.includes("Piano: A Programmable Agent Workflow System.")) {
        submitted = true;
        child.stdin.write(`${prompt}\r`);
      }
      finishWhenCompleted();
    });
    child.on("error", reject);
    child.on("exit", (exitCode) => {
      clearTimeout(timeout);
      clearInterval(completionTimer);
      if (finished) resolve();
      else if (exitCode === 0) resolve();
      else reject(new Error(`TUI exited ${exitCode}: ${output.slice(-500)}`));
    });
  });
}

function normalizedText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function assertTaskEvidence(task: TaskCase, evidence: RunEvidence): void {
  const answerTerms = new Set(normalizedText(evidence.text).split(" "));
  for (const term of task.answerTerms) expect(answerTerms).toContain(term);
  for (const alternatives of task.requiredToolGroups) {
    expect(evidence.toolNames.some((name) => alternatives.includes(name))).toBe(true);
  }
}

async function evidence(home: string, before: ReadonlySet<string>): Promise<RunEvidence> {
  const runs = join(home, ".piano", "runs");
  const ids = (await readdir(runs)).filter((id) => !before.has(id));
  expect(ids).toHaveLength(1);
  const runDir = join(runs, ids[0] ?? "");
  const trajectoryPath = join(runDir, "trajectory.json");
  const trajectory = JSON.parse(await readFile(trajectoryPath, "utf8")) as {
    status?: string;
    transcriptPath?: string;
    events?: Array<{ type?: string; toolName?: string; usage?: { totalTokens?: number } }>;
  };
  expect(trajectory.status).toBe("completed");
  const events = trajectory.events ?? [];
  expect(events.length).toBeGreaterThan(0);
  const trajectoryEventTypes = [...new Set(events.map((event) => event.type).filter((type): type is string => type !== undefined))].sort();
  expect(trajectoryEventTypes).toContain("usage");
  const toolStarts = events.filter((event) => event.type === "tool_execution_start");
  const toolNames = [...new Set(toolStarts
    .map((event) => event.toolName)
    .filter((name): name is string => name !== undefined))].sort();
  const totalTokens = Math.max(...events.filter((event) => event.type === "usage").map((event) => event.usage?.totalTokens ?? 0));
  expect(totalTokens).toBeGreaterThan(0);
  expect(trajectory.transcriptPath).toBeDefined();
  const transcriptPath = trajectory.transcriptPath ?? "";
  const lines = (await readFile(transcriptPath, "utf8")).trim().split("\n");
  const last = JSON.parse(lines.at(-1) ?? "{}") as { message?: { content?: Array<{ type?: string; text?: string }> } };
  const text = last.message?.content?.find((part) => part.type === "text")?.text ?? "";
  expect(text).not.toBe("");
  const logPath = join(runDir, "log.jsonl");
  const log = (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { event?: string });
  expect(log.some((entry) => entry.event === "agentic.task.completed")).toBe(true);
  const tracePath = join(runDir, "trace.jsonl");
  const trace = (await readFile(tracePath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { event?: string; status?: string });
  expect(trace.some((entry) => entry.event === "exit" && entry.status === "ok")).toBe(true);
  return {
    text,
    totalTokens,
    transcriptPath,
    trajectoryPath,
    trajectoryEventCount: events.length,
    trajectoryEventTypes,
    toolNames,
    toolCallCount: toolStarts.length,
    logPath,
    logCount: log.length,
    tracePath,
    traceCount: trace.length,
  };
}

async function runOne(mode: "headless" | "tui", workspace: string, home: string, prompt: string): Promise<RunEvidence> {
  const runs = join(home, ".piano", "runs");
  const before = new Set(await readdir(runs));
  if (mode === "headless") await runHeadless(workspace, home, prompt);
  else await runTui(workspace, home, prompt, before);
  return evidence(home, before);
}

describe.skipIf(!runReal)("basic workflow TUI/headless real parity", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("runs five local tasks once each across TUI and headless modes", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-basic-workflow-parity-"));
    roots.push(root);
    const home = join(root, "home");
    await mkdir(join(home, ".piano"), { recursive: true });
    // A mission's model registry is generated from Piano's own config alone; the
    // harness's native install is never read. The parity home therefore carries
    // a verbatim copy of the developer's `agent.config.json`, so headless and
    // TUI runs reach the same LLM service as their own missions. The shipped
    // template is not backfilled: its values are placeholders, and a missing key
    // must surface as unconfigured rather than as a placeholder endpoint.
    await writeFile(
      join(home, ".piano", "agent.config.json"),
      `${JSON.stringify(await readJson(process.env.PIANO_USER_AGENT_CONFIG ?? join(homedir(), ".piano", "agent.config.json")), null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await mkdir(join(home, ".piano", "runs"), { recursive: true });

    const pairs: Array<{ headless: RunEvidence; tui: RunEvidence }> = [];
    expect(cases).toHaveLength(PARITY_TASK_COUNT);
    for (const task of cases) {
      for (let trial = 1; trial <= PARITY_TRIALS_PER_TASK; trial += 1) {
        const headlessWorkspace = join(root, task.id, `headless-${trial}`);
        const tuiWorkspace = join(root, task.id, `tui-${trial}`);
        await mkdir(headlessWorkspace, { recursive: true });
        await mkdir(tuiWorkspace, { recursive: true });
        await task.prepare(headlessWorkspace);
        await task.prepare(tuiWorkspace);
        const headless = await runOne("headless", headlessWorkspace, home, task.prompt);
        const tui = await runOne("tui", tuiWorkspace, home, task.prompt);
        const headlessResult = await task.verify(headlessWorkspace);
        const tuiResult = await task.verify(tuiWorkspace);
        expect(headlessResult).toBe(tuiResult);
        assertTaskEvidence(task, headless);
        assertTaskEvidence(task, tui);
        const tokenRatio = Math.max(headless.totalTokens, tui.totalTokens) / Math.min(headless.totalTokens, tui.totalTokens);
        expect(tokenRatio).toBeLessThanOrEqual(2);
        const toolCallRatio = Math.max(headless.toolCallCount, tui.toolCallCount) / Math.min(headless.toolCallCount, tui.toolCallCount);
        expect(toolCallRatio).toBeLessThanOrEqual(MAX_TOOL_CALL_RATIO);
        console.info(JSON.stringify({
          task: task.id,
          trial,
          result: headlessResult,
          headless: {
            totalTokens: headless.totalTokens,
            text: headless.text,
            transcriptPath: headless.transcriptPath,
            trajectoryPath: headless.trajectoryPath,
            trajectoryEventCount: headless.trajectoryEventCount,
            trajectoryEventTypes: headless.trajectoryEventTypes,
            toolNames: headless.toolNames,
            toolCallCount: headless.toolCallCount,
            logPath: headless.logPath,
            logCount: headless.logCount,
            tracePath: headless.tracePath,
            traceCount: headless.traceCount,
          },
          tui: {
            totalTokens: tui.totalTokens,
            text: tui.text,
            transcriptPath: tui.transcriptPath,
            trajectoryPath: tui.trajectoryPath,
            trajectoryEventCount: tui.trajectoryEventCount,
            trajectoryEventTypes: tui.trajectoryEventTypes,
            toolNames: tui.toolNames,
            toolCallCount: tui.toolCallCount,
            logPath: tui.logPath,
            logCount: tui.logCount,
            tracePath: tui.tracePath,
            traceCount: tui.traceCount,
          },
          tokenRatio,
          toolCallRatio,
        }));
        pairs.push({ headless, tui });
      }
    }
    expect(pairs).toHaveLength(PARITY_PAIR_COUNT);
    const headlessAverage = pairs.reduce((sum, pair) => sum + pair.headless.totalTokens, 0) / pairs.length;
    const tuiAverage = pairs.reduce((sum, pair) => sum + pair.tui.totalTokens, 0) / pairs.length;
    expect(Math.max(headlessAverage, tuiAverage) / Math.min(headlessAverage, tuiAverage)).toBeLessThanOrEqual(2);
    // The default run no longer copies a workflow.yml into ~/.piano — the
    // builtin template is read directly and only an explicit user selection
    // is recorded in config.json.
    await expect(stat(join(home, ".piano", "workflow.yml"))).rejects.toThrow();
  }, 90 * 60_000);
});
