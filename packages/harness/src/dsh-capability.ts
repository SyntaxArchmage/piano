import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import {
  DSH_API_KEY_ENV,
  DSH_RESUME_SESSION_ENV,
  dshResumeOverlayPath,
  prepareHarnessHomes,
} from "./harness-home.js";
import type { ResolvedHarnessConfig } from "./harness-config.js";

export interface DshResumeProbe {
  readonly capability: "supported" | "unsupported" | "unknown";
  readonly reason?: string;
}

/** A syntactically valid dsh session id (`session-<uuid>`) that names no real
 * session. The resume runner shape-checks the id before calling
 * `agents.resume`, so the probe reaches the capability boundary without a
 * model request ever being made. */
const PROBE_SESSION_ID = "session-00000000-0000-0000-0000-000000000000";

/** Probe whether the installed dsh can resume a session.
 *
 * dsh ships no resume flag; Piano resumes through an overlaid runner script
 * that calls the plugin API's `agents.resume` at runtime. Whether that API
 * exists depends on the installed dsh build, so the only honest check is to
 * drive the runner into the resume path and read its failure wording:
 *
 * - "cannot resume" — the runner found no `agents.resume`; this dsh cannot
 *   resume any session, and every continued Piano turn would fail the same way.
 * - "could not resume" — the API exists and rejected the nonexistent probe
 *   session; resume works.
 *
 * Both messages are emitted before any model call, so the probe needs no
 * working credentials and costs one dsh startup. */
export async function probeDshResumeCapability(
  config: ResolvedHarnessConfig,
  timeoutMs = 30_000,
): Promise<DshResumeProbe> {
  const root = await mkdtemp(join(tmpdir(), "piano-dsh-resume-probe-"));
  try {
    const homes = await Effect.runPromise(
      prepareHarnessHomes({
        rootDir: join(root, "home"),
        configs: { dsh: config },
      }).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    const dshHome = homes.env.DSH_HOME;
    if (dshHome === undefined) return { capability: "unknown", reason: "no dsh home was generated" };
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...homes.env,
      [DSH_RESUME_SESSION_ENV]: PROBE_SESSION_ID,
    };
    if (config.apiKey !== undefined) {
      const secret = /^[A-Z][A-Z0-9_]*$/.test(config.apiKey)
        ? (env[config.apiKey] ?? config.apiKey)
        : config.apiKey;
      env[config.apiKeyEnv ?? DSH_API_KEY_ENV] = secret;
    }
    const args = [
      "--profile", config.profile ?? "headless",
      "--patch", dshResumeOverlayPath(dshHome),
      "piano resume capability probe",
    ];
    const output = await new Promise<string>((resolvePromise) => {
      execFile(
        config.binPath ?? "dsh",
        args,
        { env, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
        (_error, stdout, stderr) => resolvePromise(`${stdout}\n${stderr}`),
      );
    });
    if (output.includes("cannot resume")) {
      return {
        capability: "unsupported",
        reason: "the installed dsh has no session-resume API (agents.resume); upgrade dsh to resume runs",
      };
    }
    if (output.includes("could not resume")) return { capability: "supported" };
    const tail = output.trim().split("\n").slice(-2).join(" ").slice(-300);
    return {
      capability: "unknown",
      reason: tail === "" ? "the probe produced no output" : `probe output: ${tail}`,
    };
  } catch (error) {
    return {
      capability: "unknown",
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}
