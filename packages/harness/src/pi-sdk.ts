import { Effect } from "effect";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentHarnessOptions } from "./agent-contract.js";
import { AgentError } from "./errors.js";

/**
 * Finding the installed pi SDK and loading it — nothing about using it.
 *
 * The SDK arrives as a global npm package rather than a dependency, so "is it
 * there, is it new enough, can we import it" is a discovery problem of its own,
 * with its own failure vocabulary (`sdk-discovery` / `sdk-unavailable` /
 * `sdk-load`) that `doctor` reports before any session exists. It is also the
 * only place in the harness that shells out (`npm root -g`) and the only
 * module-level cache, both easier to reason about kept together.
 *
 * What the loaded module looks like is part of the same subject: these
 * interfaces describe pi's surface as far as Piano relies on it, and they are
 * what the adapter above is typed against.
 */

export interface PiModelRuntime {
  getModel(provider: string, model: string): unknown;
  /** Resolve a model id from Pi's own provider/model registry. */
  getModels?(): readonly unknown[];
  setRuntimeApiKey(provider: string, apiKey: string): Promise<void>;
}

export interface PiResourceLoader {
  reload(): Promise<void>;
  getAgentsFiles?(): {
    agentsFiles: readonly { readonly path: string; readonly content: string }[];
  };
  getSkills?(): {
    skills: readonly { readonly name: string; readonly filePath?: string }[];
  };
  getSystemPrompt?(): string | undefined;
  getSystemPromptSource?(): { readonly path: string } | undefined;
}

export interface PiSession {
  readonly sessionId: string;
  readonly sessionFile?: string;
  /** Pi clamps the requested level to the selected model's capabilities. */
  readonly thinkingLevel?: string;
  subscribe(listener: (event: unknown) => void): () => void;
  prompt(text: string): Promise<void>;
  /** Genuine mid-turn delivery: injects a user message that the agent loop
   * ingests before its next LLM call. Optional because it is probed, not
   * assumed — older/fake SDKs omit it. */
  steer?(text: string): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
}

export interface PiModule {
  readonly ModelRuntime: {
    create(options: Record<string, unknown>): Promise<PiModelRuntime>;
  };
  readonly SessionManager: {
    create(cwd: string, sessionDir?: string): unknown;
    open?(path: string, sessionDir?: string, cwdOverride?: string): unknown;
  };
  readonly SettingsManager: {
    inMemory(settings: Record<string, unknown>): unknown;
  };
  readonly DefaultResourceLoader: new (options: Record<string, unknown>) => PiResourceLoader;
  readonly createAgentSession: (options: Record<string, unknown>) => Promise<{ session: PiSession }>;
}

export interface PiHarnessOptions extends AgentHarnessOptions {
  /** Keep provider/model/auth discovery inside Pi when false. */
  readonly usePianoConfig?: boolean;
  readonly sdk?: PiModule;
  readonly sdkLoader?: () => Promise<PiModule>;
}

const MIN_PI_VERSION = "0.84.0";
const MAX_SDK_LOAD_RETRIES = 2;
const TRANSIENT_SDK_ERROR_CODES = new Set([
  "EAGAIN", "EBUSY", "EINTR", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "EPIPE",
]);
let sdkRootCache: string | undefined;
function compareVersions(left: string, right: string): number {
  const a = left.split(".").map((value) => Number.parseInt(value, 10) || 0);
  const b = right.split(".").map((value) => Number.parseInt(value, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0) ? 1 : -1;
  }
  return 0;
}

/** The installed pi SDK package directory. `PIANO_PI_SDK_ROOT` is the explicit
 * deployment override — it names `.../@earendil-works/pi-coding-agent` itself —
 * so an install without npm never needs the `npm root -g` shell-out. The
 * npm-derived path is cached for the process; an explicit root is not, so a
 * long-lived process can retarget it (and tests can vary it). */
function sdkRoot(): string {
  const override = process.env.PIANO_PI_SDK_ROOT;
  if (override !== undefined && override.trim() !== "") return resolve(override.trim());
  if (sdkRootCache === undefined) {
    sdkRootCache = join(execSync("npm root -g", { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
  }
  return sdkRootCache;
}

type SdkLoader = () => Promise<PiModule>;
const defaultSdkLoader: SdkLoader = () => import(join(sdkRoot(), "dist/index.js")) as Promise<PiModule>;
const sdkModuleCache = new WeakMap<SdkLoader, Promise<PiModule>>();

function sdkAvailable(): boolean {
  const root = sdkRoot();
  const packagePath = join(root, "package.json");
  if (!existsSync(join(root, "dist/index.js")) || !existsSync(packagePath)) return false;
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
  return typeof packageJson.version === "string" && compareVersions(packageJson.version, MIN_PI_VERSION) >= 0;
}

/** Check the installed SDK boundary without importing or starting a session. */
export function piAvailable(): boolean {
  try {
    return sdkAvailable();
  } catch {
    return false;
  }
}


function transientSdkLoad(error: AgentError): boolean {
  const cause = error.cause;
  let code: unknown;
  try {
    code = typeof cause === "object" && cause !== null && "code" in cause
      ? (cause as { code?: unknown }).code
      : undefined;
  } catch {
    code = undefined;
  }
  return (typeof code === "string" && TRANSIENT_SDK_ERROR_CODES.has(code)) || /temporar|timeout|timed out|try again/i.test(error.message);
}

function loadCachedSdk(loader: SdkLoader): Promise<PiModule> {
  const cached = sdkModuleCache.get(loader);
  if (cached !== undefined) return cached;
  const pending = Promise.resolve().then(loader);
  const tracked = pending.catch((cause) => {
    if (sdkModuleCache.get(loader) === tracked) sdkModuleCache.delete(loader);
    throw cause;
  });
  sdkModuleCache.set(loader, tracked);
  return tracked;
}

/** Load the SDK module without creating a session. This is the real discovery
 * boundary used by doctor before it reports the Pi SDK as ready. */
export async function piLoadable(): Promise<boolean> {
  if (!piAvailable()) return false;
  try {
    await loadCachedSdk(defaultSdkLoader);
    return true;
  } catch {
    return false;
  }
}

export function loadSdk(options: PiHarnessOptions): Effect.Effect<PiModule, AgentError> {
  return Effect.suspend(() => {
    if (options.sdk !== undefined) return Effect.succeed(options.sdk);
    const available = options.sdkLoader === undefined
      ? Effect.try({
        try: sdkAvailable,
        catch: (cause) => new AgentError({
          kind: "sdk-discovery",
          message: `unable to inspect the pi SDK installation: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        }),
      })
      : Effect.succeed(true);
    return available.pipe(
      Effect.flatMap((isAvailable) => {
        if (!isAvailable) {
          return Effect.fail(new AgentError({
            kind: "sdk-unavailable",
            message: "pi SDK is not installed or is below the supported version",
          }));
        }
        const loader = options.sdkLoader ?? defaultSdkLoader;
        let attempt = 0;
        const loadAttempt = Effect.suspend(() => {
          attempt += 1;
          return Effect.tryPromise({
            try: () => loadCachedSdk(loader),
            catch: (cause) => new AgentError({
              kind: "sdk-load",
              message: `pi SDK module load failed on attempt ${attempt}: ${cause instanceof Error ? cause.message : String(cause)}`,
              cause,
            }),
          });
        });
        return Effect.retry(loadAttempt, {
          times: MAX_SDK_LOAD_RETRIES,
          while: transientSdkLoad,
        });
      }),
    );
  });
}

