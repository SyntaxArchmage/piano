import { Data, Effect } from "effect";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  resolveHarnessConfig,
  resolveSupportedModels,
  type HarnessName,
  type ResolvedHarnessConfig,
} from "./harness-config.js";
import type { AgentHarnessOptions } from "./pi.js";

/** One generated directory per native config *format*, not per harness: `pi` and
 * `pi-cli` are the same agent reading the same files, so they share one. Codex
 * is intentionally absent: an empty generated `CODEX_HOME` would hide the
 * user's authenticated CLI config, so Codex keeps its native home unless the
 * caller explicitly configures one. */
type HomeFormat = "pi" | "claude" | "dsh";

export class HarnessHomeError extends Data.TaggedError("HarnessHomeError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface HarnessHomeOptions {
  readonly configs?: Partial<Record<HarnessName, ResolvedHarnessConfig>>;
  /** Model ids to make reachable. Defaults to Piano's configured list. */
  readonly models?: readonly string[];
  /** Test/runtime seam. Production uses ~/.piano/harness. */
  readonly rootDir?: string;
}

export interface HarnessHomes {
  /** Child-process variables only; the parent process environment is untouched. */
  readonly env: NodeJS.ProcessEnv;
  /** Options for the in-process Pi adapter, forwarded verbatim by callers. */
  readonly agentOptions: AgentHarnessOptions;
  /** The generated directories, for diagnostics and tests. */
  readonly paths: Readonly<Record<HomeFormat, string>>;
}

function defaultRoot(): string {
  return process.env.PIANO_HARNESS_HOME_ROOT ?? join(homedir(), ".piano", "harness");
}

/** Replace a generated file atomically. The directory is fixed and shared, so
 * concurrent missions regenerate the same file at once — including several in one
 * process, which is the normal case for parallel workers. They write identical
 * bytes, because the content is a pure function of Piano's config, and each writes
 * through its own staging name so no writer can rename another's file out from
 * under it. The rename makes the switch atomic, so no harness reads a partial
 * file. */
async function writeGenerated(directory: string, name: string, contents: string): Promise<void> {
  const target = join(directory, name);
  const staging = `${target}.tmp-${randomUUID()}`;
  await writeFile(staging, contents, { encoding: "utf8", mode: 0o600 });
  await rename(staging, target);
}

/** The dsh plugin Piano ships, read from beside this module.
 *
 * It is Node ESM rather than TypeScript because the dsh launcher imports it
 * inside its own process, where nothing compiles `.ts`. Copying these bytes
 * instead of generating them keeps the plugin ordinary, lintable JavaScript
 * with syntax highlighting and a real module graph, which a string template in
 * this file would not be. */
async function readDshResumeRunner(): Promise<string> {
  return readFile(fileURLToPath(new URL("./dsh-resume-runner.mjs", import.meta.url)), "utf8");
}

/** Build Pi's model registry from Piano's config alone, so every id Piano claims
 * to support is resolvable by the SDK adapter and the `pi-cli` subprocess.
 *
 * Entries are bare `{ id }`: that is all the file format requires. The SDK's
 * `registerProvider` path would instead demand `name`, `reasoning`, `input`,
 * `cost`, `contextWindow`, and `maxTokens` for every model, none of which Piano
 * knows, so the file is the deliberate choice over invented metadata.
 *
 * An unconfigured provider or endpoint yields an empty registry rather than no
 * file. The directory is durable, so "write nothing" would leave a previous
 * run's registry in place and let stale configuration keep working invisibly. */
function piRegistry(config: ResolvedHarnessConfig, models: readonly string[]): string {
  const { provider, baseUrl } = config;
  const providers = provider === undefined || baseUrl === undefined || models.length === 0
    ? {}
    : {
      [provider]: {
        baseUrl,
        api: "openai-completions",
        // Piano declares no optional capability it has not verified. Claiming
        // less than the gateway supports only makes Pi skip a feature; claiming
        // more makes it send a request the gateway rejects.
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
        models: models.map((id) => ({ id })),
      },
    };
  return `${JSON.stringify({ providers }, null, 2)}\n`;
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

/** Path of the generated overlay that selects one model for a dsh run.
 *
 * dsh's headless entry point has no model flag — it reads the process-wide
 * `agent-default-model` — so a per-request model can only arrive as a launcher
 * `--patch` layer. One file per model keeps that content a pure function of
 * Piano's config, so concurrent missions on different models never contend for
 * the same file. `encodeURIComponent` is injective and leaves an ordinary model
 * id unchanged, so the filename stays readable while a `/` in a namespaced id
 * cannot escape the directory. */
export function dshModelPatchPath(dshHome: string, model: string): string {
  return join(dshHome, "patches", `${encodeURIComponent(model)}.patch.yml`);
}

/** Path of the generated dsh overlay that removes web_search for stages which
 * do not declare the capability. dsh mounts the provider by default, so this
 * patch makes the workflow tool list an actual A/B control. */
export function dshWebSearchOffPatchPath(dshHome: string): string {
  return join(dshHome, "patches", "web-search-off.yml");
}

/** Path of the generated overlay that replaces dsh's one-shot runner with
 * Piano's resuming one. */
export function dshResumeOverlayPath(dshHome: string): string {
  return join(dshHome, "patches", "piano-resume.patch.yml");
}

/** The environment reference carrying the session a continued dsh actor must
 * reopen.
 *
 * The runner is standalone Node ESM — the dsh launcher imports it inside its own
 * process, where nothing compiles `.ts` — so it cannot import this constant. The
 * runner test asserts the shipped plugin reads this exact name, which is what
 * keeps the two sides from drifting apart silently. */
export const DSH_RESUME_SESSION_ENV = "PIANO_DSH_RESUME_SESSION";

/** Where the runner's own module lives.
 *
 * Keep it under the `headless` profile so its bare `@deepseek-ai/*` imports
 * resolve through the profile's node_modules tree. The overlay names it
 * relative to the patch directory — dsh resolves a patch row's `name`
 * against the directory the patch file sits in — hence the `../profiles/`
 * climb back to the runner. */
export function dshResumeRunnerPath(dshHome: string): string {
  return join(dshHome, "profiles", "headless", "resume-runner.mjs");
}

/** The overlay: stop the shipped runner from driving the turn, and hand the
 * session to Piano's runner instead.
 *
 * The shipped `headless-startup` row stays mounted. It owns the app's argument
 * parsing and publishes the task, so keeping it means the task reaches the
 * runner through the same config path as before and Piano never parses dsh's
 * argv itself. Only the runner — the row that hardcodes a fresh session id — is
 * replaced. */
function dshResumeOverlay(): string {
  return [
    "# Generated by Piano: resumes the actor's dsh session instead of opening a new one.",
    "# Do not edit.",
    "- id: headless-runner",
    "  disabled: true",
    "",
    "- insert:",
    "    - id: piano-resume-runner",
    // Resolved against this patch file's directory (`patches/`), so the name
    // climbs back to the runner under the headless profile.
    "      name: ../profiles/headless/resume-runner.mjs",
    "      inject:",
    "        - headlessStartup",
    "      config:",
    "        task: !!js ctx.headlessStartup.task",
    "",
  ].join("\n");
}

function dshModelPatch(provider: string, model: string): string {
  return [
    "# Generated by Piano: selects the model for one run. Do not edit.",
    "- id: agent-default-model",
    "  config:",
    `    provider: ${yamlScalar(provider)}`,
    `    model: ${yamlScalar(model)}`,
    "",
  ].join("\n");
}

function dshWebSearchOffPatch(): string {
  return [
    "# Generated by Piano: removes web_search from dsh's tool registration. Do not edit.",
    "- id: tool-web",
    "  config:",
    "    search: false",
    "",
  ].join("\n");
}

/** Build only the native dsh settings a Piano mission needs. Credentials stay
 * environment references, so no secret is written to settings.yaml.
 *
 * `agent-default-model` is deliberately absent: the settings document layers
 * *over* the composition, so a section here would shadow the per-request
 * `--patch` overlay and pin every run to one model. */
function dshSettings(config: ResolvedHarnessConfig, models: readonly string[]): string {
  if (config.provider === undefined && config.model === undefined) return "{}\n";
  const provider = config.provider ?? "deepseek-official";
  const apiKeyEnv = config.apiKeyEnv ?? "PIANO_DSH_API_KEY";
  if (provider === "deepseek-official") {
    // The official route's catalog is dsh's own; only the credential and
    // endpoint are deployment settings.
    return `${[
      "llm-deepseek:",
      `  apiKeyEnv: ${yamlScalar(apiKeyEnv)}`,
      ...(config.baseUrl === undefined ? [] : [`  baseURL: ${yamlScalar(config.baseUrl)}`]),
    ].join("\n")}\n`;
  }
  // A generic pi-ai route declares its own catalog, and one credential serves
  // every model on it, so Piano's whole model list belongs here rather than the
  // single default a run happens to start with.
  return `${[
    "llm-pi-ai:",
    "  providers:",
    `    ${yamlScalar(provider)}:`,
    `      apiKeyEnv: ${yamlScalar(apiKeyEnv)}`,
    "      api: openai-completions",
    ...(config.baseUrl === undefined ? [] : [`      baseURL: ${yamlScalar(config.baseUrl)}`]),
    "      models:",
    ...dshCatalog(config, models).map((id) => `        - id: ${yamlScalar(id)}`),
    // dsh's shipped search provider does not inherit the chat route on a
    // generic gateway deployment. Give it the same endpoint and credential
    // reference while keeping secrets out of the generated settings file.
    "web-search-deepseek:",
    `  apiKeyEnv: ${yamlScalar(apiKeyEnv)}`,
    ...(config.baseUrl === undefined ? [] : [`  baseURL: ${yamlScalar(config.baseUrl)}`]),
  ].join("\n")}\n`;
}

/** Every model a dsh run may select: Piano's list plus the configured default,
 * which must stay reachable even when the list is empty or predates it. */
function dshCatalog(config: ResolvedHarnessConfig, models: readonly string[]): readonly string[] {
  return [...new Set([...models, ...(config.model === undefined ? [] : [config.model])])];
}

async function prepare(options: HarnessHomeOptions): Promise<HarnessHomes> {
  const root = options.rootDir ?? defaultRoot();
  const paths = {
    pi: join(root, "pi"),
    claude: join(root, "claude"),
    dsh: join(root, "dsh"),
  } as const;
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (const directory of Object.values(paths)) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  const models = options.models ?? resolveSupportedModels();
  const piConfig = options.configs?.pi ?? resolveHarnessConfig("pi");
  // Pi resolves an auth path out of its config directory. Piano applies its own
  // credential — in-process for the SDK adapter, on argv for `pi-cli` — so the
  // file exists only to keep that lookup from hitting a missing path.
  await writeGenerated(paths.pi, "auth.json", "{}\n");
  await writeGenerated(paths.pi, "models.json", piRegistry(piConfig, models));
  const dshConfig = options.configs?.dsh ?? resolveHarnessConfig("dsh");
  const codexConfig = options.configs?.codex ?? resolveHarnessConfig("codex");
  await writeGenerated(paths.dsh, "settings.yaml", dshSettings(dshConfig, models));
  const patchDirectory = join(paths.dsh, "patches");
  await mkdir(patchDirectory, { recursive: true, mode: 0o700 });
  await writeGenerated(
    patchDirectory,
    basename(dshWebSearchOffPatchPath(paths.dsh)),
    dshWebSearchOffPatch(),
  );
  // DSH resolves the overlay's relative module name from the patch directory;
  // the reference points back into the profile tree where dependencies live.
  await writeGenerated(
    patchDirectory,
    basename(dshResumeOverlayPath(paths.dsh)),
    dshResumeOverlay(),
  );
  const resumeRunner = dshResumeRunnerPath(paths.dsh);
  await mkdir(dirname(resumeRunner), { recursive: true, mode: 0o700 });
  await writeGenerated(
    dirname(resumeRunner),
    basename(resumeRunner),
    await readDshResumeRunner(),
  );
  // One selection overlay per reachable model. Stale files from a shrunken model
  // list are left alone rather than swept: the catalog in settings.yaml is what
  // makes a model resolvable, so a leftover overlay selects a model dsh then
  // rejects, while deleting the directory could pull a file out from under a
  // concurrently starting mission.
  if (dshConfig.provider !== undefined) {
    for (const model of dshCatalog(dshConfig, models)) {
      await writeGenerated(
        patchDirectory,
        // Derived from the shared helper, because the launcher argument the
        // subprocess adapter builds must name exactly this file.
        basename(dshModelPatchPath(paths.dsh, model)),
        dshModelPatch(dshConfig.provider, model),
      );
    }
  }
  // `claude` needs no generated file yet, but it still gets a directory: the
  // point is to keep the harness away from the user's install, not to configure
  // it. Everything Piano sets for Claude already travels as environment.
  return {
    env: {
      PI_CODING_AGENT_DIR: paths.pi,
      CLAUDE_CONFIG_DIR: paths.claude,
      DSH_HOME: paths.dsh,
      ...(dshConfig.toolsMode === undefined ? {} : { DSH_TOOLS_MODE: dshConfig.toolsMode }),
      // Codex stores authentication and model-provider configuration in
      // CODEX_HOME. Preserve the native home by default; an explicit override
      // is still forwarded without copying or rewriting that directory.
      ...(codexConfig.homePath === undefined ? {} : { CODEX_HOME: codexConfig.homePath }),
    },
    agentOptions: { agentDir: paths.pi },
    paths,
  };
}

/** Generate the harness configuration Piano owns, and hand back the pointers that
 * aim every harness at it.
 *
 * Piano never reads or writes the user's native configuration. Each harness
 * accepts a non-default config directory — `agentDir` for the Pi SDK,
 * `PI_CODING_AGENT_DIR` for `pi-cli`, `CLAUDE_CONFIG_DIR`, `DSH_HOME` — so a
 * mission can be configured entirely from `~/.piano/agent.config.json` without
 * touching `~/.pi/agent`, `~/.claude`, or `~/.dsh`. That is why there is no
 * backup, no restore, and no per-mission copy to reclaim: nothing the user owns
 * is ever modified.
 *
 * The directory is deliberately fixed rather than per-mission. Its contents are
 * a pure function of Piano's config, so every mission wants the same bytes, and
 * regenerating on each call keeps it from drifting behind a config edit.
 *
 * A harness-native login (a Claude subscription, a Pi OAuth session) does not
 * carry into this directory. Credentials come from Piano's config; when one is
 * missing, `doctor` reports it rather than silently inheriting. */
export function prepareHarnessHomes(
  options: HarnessHomeOptions = {},
): Effect.Effect<HarnessHomes, HarnessHomeError> {
  return Effect.tryPromise({
    try: () => prepare(options),
    catch: (cause) => new HarnessHomeError({
      message: "unable to generate the Piano-owned harness configuration home",
      cause,
    }),
  });
}
