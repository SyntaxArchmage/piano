import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { spawn as spawnProcess } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Agent-behavior proof for the setup-env OPHAL config-resolution guard
 * (2026-08-28). Complements the static text assertion in
 * setup-env-skill-guard.test.ts — that file only proves the guard text exists;
 * this e2e proves the agent actually follows it.
 *
 * The setup-env stage's shared workspace cwd is wherever piano was launched
 * (here: an isolated temp dir), NOT the injected topsop workspace. Without the
 * guard, the FIRST `ophal device --status` call would walk up from the wrong
 * cwd and fall back to the kit-builtin xiaomeng.zhao config (test_host
 * root@10.12.115.72, permission errors on that config's home paths). The guard
 * must make the first ophal call already correct: either
 * `cd <workspace> && ophal ...` or
 * `OPHAL_CONFIG=<workspace>/ophal_config.json ophal ...`.
 *
 * Real requirements: a live model API, a reachable topsop workspace checkout
 * at `$HOME/topsop` (with its ophal_config.json), and the GCU test host
 * reachable via SSH. So
 * this case is env-gated and skipped by default:
 *
 *   PIANO_SETUP_ENV_E2E=1 npx vitest run tests/workflow/setup-env-config-guard.e2e.test.ts
 *
 * Only imports vitest + node builtins (no @piano/* packages) so it never trips
 * the pre-existing vitest workspace-alias resolution gap.
 */

const entrypoint = fileURLToPath(new URL("../../packages/cli/bin/piano.mjs", import.meta.url));
const pianoRepo = resolve(dirname(entrypoint), "../../..");
const soloWorkflow = join(pianoRepo, "tests", "workflow", "workflows", "topsop-setup-env-solo.yml");
const mission = "获取 topssglAddAddRmsNorm 算子在 shape [16384, 2048] 的基线性能，然后进行优化。\n目标：读写LLC带宽总和达到2.5TB/s 或者 1D计算率达到80%";

/** An ophal device invocation from the agent trajectory: the bash command text
 * plus the ophal tool result output (so we can assert on the actual device
 * query, not on skill text that also mentions the stale host). */
interface OphalInvocation {
  readonly command: string;
  readonly output: string;
}

function extractOphalInvocations(transcriptText: string): { calls: OphalInvocation[]; results: OphalInvocation[] } {
  const calls: OphalInvocation[] = [];
  const results: OphalInvocation[] = [];
  for (const raw of transcriptText.trim().split("\n")) {
    let entry: { message?: { role?: string; content?: Array<{ type?: string; text?: string; arguments?: { command?: string }; input?: { command?: string } }> } };
    try {
      entry = JSON.parse(raw) as typeof entry;
    } catch {
      continue;
    }
    const content = entry.message?.content ?? [];
    for (const part of content) {
      if (part.type === "toolCall") {
        const command = part.arguments?.command ?? part.input?.command ?? "";
        if (/\bophal\b.*\bdevice\b/.test(command)) {
          calls.push({ command, output: "" });
        }
      }
    }
    if (entry.message?.role === "toolResult") {
      for (const part of content) {
        const text = part.type === "text" ? (part.text ?? "") : "";
        if (text.includes("[OPHAL device]")) {
          results.push({ command: "", output: text });
        }
      }
    }
  }
  return { calls, results };
}

describe.skipIf(process.env.PIANO_SETUP_ENV_E2E !== "1")("setup-env OPHAL config-resolution guard (e2e)", () => {
  const roots: string[] = [];

  it("makes the first ophal device call run from the injected workspace and resolve the right test host", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-setup-env-guard-"));
    roots.push(root);
    const home = join(root, "home");
    await mkdir(join(home, ".piano", "runs"), { recursive: true });
    const agentConfig = join(homedir(), ".piano", "agent.config.json");
    const models = join(homedir(), ".pi", "agent", "models.json");
    if (!existsSync(agentConfig) || !existsSync(models)) {
      throw new Error(`e2e needs ${agentConfig} and ${models}; ensure the model config exists on this host`);
    }
    await mkdir(join(home, ".pi", "agent"), { recursive: true });
    await copyFile(agentConfig, join(home, ".piano", "agent.config.json"));
    await copyFile(models, join(home, ".pi", "agent", "models.json"));

    const workspace = pianoRepo; // process.cwd() == workspace cwd == piano root (the "wrong" dir the guard must overcome)
    if (!existsSync(workspace)) {
      throw new Error(`e2e needs a real piano checkout at ${workspace} to resolve @piano/* via tsconfig`);
    }

    // Launch the real setup-env stage in a throwaway cwd/HOME, exactly as the
    // piano CLI would. The workspace cwd is NOT the topsop repo — that is the
    // trap condition the guard must overcome.
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, TERM: "xterm-256color", COLORTERM: "truecolor" };
    const child = spawnProcess(process.execPath, [entrypoint, "--workflow", soloWorkflow, "--json", "-p", mission], {
      cwd: workspace,
      env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const exitCode = await new Promise<number>((resolveExit, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error(`setup-env e2e timed out; stdout=${stdout.slice(-800)}`)); }, 240_000);
      child.on("error", reject);
      child.on("exit", (code) => { clearTimeout(timer); resolveExit(code ?? -1); });
    });
    expect(exitCode, `headless exited ${exitCode}; stderr=${stderr.slice(-600)}`).toBe(0);

    // Locate the single run dir and its transcript.
    const runs = join(home, ".piano", "runs");
    const ids = (await readdir(runs)).filter((id) => id !== "." && id !== "..");
    expect(ids).toHaveLength(1);
    const trajectory = JSON.parse(await readFile(join(runs, ids[0] ?? "", "trajectory.json"), "utf8")) as { status?: string; transcriptPath?: string };
    expect(trajectory.status).toBe("completed");
    const transcriptText = await readFile(trajectory.transcriptPath ?? "", "utf8");
    const { calls, results } = extractOphalInvocations(transcriptText);

    // Guard proof 1: the FIRST ophal device command carries the cd/OPHAL_CONFIG.
    expect(calls.length, "expected at least one ophal device bash call in the trajectory").toBeGreaterThan(0);
    const firstDeviceCall = calls[0] as OphalInvocation;
    // Precondition (see header): the topsop workspace checkout lives at
    // $HOME/topsop on the host running this gated test.
    expect(firstDeviceCall.command).toContain(`cd ${join(homedir(), "topsop")}`);
    expect(firstDeviceCall.command).toMatch(/ophal device --status --arch 400/);

    // Guard proof 2: the actual device query output resolves the right test
    // host and never the stale kit-builtin one.
    const deviceOutput = results.map((r) => r.output).join("\n");
    expect(deviceOutput, "expected an [OPHAL device] tool result").toMatch(/Test host:\s*wsj@10\.12\.115\.153/);
    expect(deviceOutput).not.toMatch(/root@10\.12\.115\.72/);
    expect(deviceOutput).not.toMatch(/xiaomeng/);
  }, 300_000);

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });
});
