// Isolation for PTY tests that drive the real `piano` binary against a real
// model provider.
//
// Two things such a test needs, and it is easy to get only one of them:
//
//  1. a throwaway HOME carrying the developer's own model credentials, so the
//     mission bootstrap never regenerates the developer's real harness home
//     while a live run is using it. The config is copied verbatim: the run must
//     reach the same LLM service the developer's own missions use, and the
//     shipped template only holds placeholders.
//  2. a per-test `PIANO_HARNESS_HOME_ROOT`. `vitest.config.ts` points the WHOLE
//     suite at one scratch harness home, so an isolated HOME alone still races
//     every other real-harness test for the same generated home. This half is
//     silent when missing — the test passes until two real tests overlap.
//
// They are returned together, as one value, because handing back a home
// without its env is exactly the bug this module exists to prevent.

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface IsolatedRealHome {
  /** Pass this to `startTui` as its first argument. */
  readonly home: string;
  /** Pass this to `startTui` as its third argument, alongside `home`. */
  readonly env: NodeJS.ProcessEnv;
}

/** A throwaway HOME holding a verbatim copy of the developer's real
 * `agent.config.json`, plus the env that keeps its harness home its own. Only
 * valid with working model credentials, so callers gate on
 * `PIANO_HARNESS_REAL_E2E=1`. */
export async function isolatedRealHome(prefix = "piano-real-pty-home-"): Promise<IsolatedRealHome> {
  const home = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(home, ".piano"), { recursive: true });
  const configuredPath = process.env.PIANO_USER_AGENT_CONFIG
    ?? join(process.env.HOME ?? "", ".piano", "agent.config.json");
  const configured = JSON.parse(await readFile(configuredPath, "utf8")) as Record<string, unknown>;
  await writeFile(join(home, ".piano", "agent.config.json"), `${JSON.stringify(configured, null, 2)}\n`, { mode: 0o600 });
  return {
    home,
    env: { HOME: home, PIANO_HARNESS_HOME_ROOT: join(home, ".piano", "harness") },
  };
}
