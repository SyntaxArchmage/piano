import { execFile as spawnFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stdout } from "node:process";
import { Cause, Effect, Exit, Option } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import {
  HARNESS_NAMES,
  AgentError,
  agentConfigPath,
  describeHarness,
  executeAgent,
  executeSubprocessAgent,
  isHarnessName,
  piLoadable,
  prepareHarnessHomes,
  probeDshResumeCapability,
  type DshResumeProbe,
  resolveHarnessConfig,
  resolveSupportedModels,
  type HarnessName,
  type PiModule,
  type ResolvedHarnessConfig,
} from "@piano/harness";
import {
  isRecord,
  LogWriter,
  loggingService,
  logStreamPath,
  Logging,
  TraceWriter,
  traceStreamPath,
} from "@piano/logging";
import { CliArgumentError } from "./errors.js";

export const doctorUsage =
  "usage: piano doctor --harness <pi|pi-cli|claude|dsh|codex|all> | piano doctor --model [<model>|all] [--harness <pi|pi-cli|claude|dsh|codex>]";

interface HarnessDoctorReport {
  readonly harness: HarnessName;
  readonly status: "ready" | "unavailable" | "unconfigured";
  readonly executable?: string;
  readonly version?: string;
  readonly reason?: string;
  /** True only when the selected harness completed a real health request. */
  readonly realRequest?: boolean;
  /** dsh only: whether the installed build can resume sessions. Absent when
   * the probe did not run (non-dsh harnesses, or a health probe that already
   * failed). */
  readonly resume?: DshResumeProbe["capability"];
}

interface HarnessProbeResult {
  readonly status: "ready" | "unavailable" | "unconfigured";
  readonly reason?: string;
}

interface ModelDoctorReport {
  readonly status: "supported" | "unsupported" | "unavailable" | "unconfigured";
  readonly endpoint: string;
  readonly models: readonly string[];
  readonly model?: string;
  readonly reason?: string;
}

interface DoctorCommandDeps {
  readonly write?: (line: string) => void;
  readonly fetch?: typeof globalThis.fetch;
  readonly modelEndpoint?: string;
  readonly modelConfig?: ResolvedHarnessConfig;
  readonly probePi?: (model: string, config: ResolvedHarnessConfig) => Promise<ModelDoctorReport>;
  readonly pi?: PiModule;
  readonly runExecutable?: (file: string, args: readonly string[]) => Promise<string>;
  /** Test seam; production always uses the native subprocess probe below. */
  readonly probeSubprocess?: (harness: Exclude<HarnessName, "pi">, config: ResolvedHarnessConfig) => Promise<HarnessProbeResult>;
  /** Test seam; production probes the installed dsh's resume capability. */
  readonly probeDshResume?: (config: ResolvedHarnessConfig) => Promise<DshResumeProbe>;
  readonly sdkAvailable?: () => boolean | Promise<boolean>;
  readonly harnessConfig?: (harness: HarnessName) => ResolvedHarnessConfig;
  readonly supportedModels?: () => readonly string[];
}

function runExecutable(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    spawnFile(file, [...args], { timeout: 10_000 }, (error, out, err) => {
      if (error !== null) return reject(error);
      resolve(`${out}${err}`.trim());
    });
  });
}

/** A probe is its own throwaway session, so its trace id is minted like a
 * session's — never the run id wearing a trace id's clothes. */
function probeLogging(runId: string, root: string) {
  const traceId = randomBytes(16).toString("hex");
  return loggingService(
    new LogWriter(runId, logStreamPath(root), traceId),
    new TraceWriter(runId, traceStreamPath(root), traceId),
  );
}

/** Run the smallest useful request through the selected native harness. A
 * version command is intentionally not enough: it cannot prove that the
 * harness can authenticate, resolve a model, or complete a request. */
async function runSubprocessProbe(
  harness: Exclude<HarnessName, "pi">,
  config: ResolvedHarnessConfig,
  models?: readonly string[],
): Promise<HarnessProbeResult> {
  const root = await mkdtemp(join(tmpdir(), `piano-doctor-${harness}-`));
  const runId = `doctor-${harness}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const logging = probeLogging(runId, root);
  try {
    const exit = await Effect.runPromise(
      prepareHarnessHomes({
        rootDir: join(root, "home"),
        configs: { [harness]: config },
        ...(models === undefined ? {} : { models }),
      }).pipe(Effect.flatMap((homes) => executeSubprocessAgent(harness, {
          cwd: process.cwd(),
          prompt: "Reply with exactly OK. This is a health check; do not use tools.",
          ...(config.model === undefined ? {} : { model: config.model }),
          tools: [],
          signal: AbortSignal.timeout(30_000),
          sessionDir: join(root, "session"),
        }, {
          ...(config.provider === undefined ? {} : { provider: config.provider }),
          ...(config.model === undefined ? {} : { model: config.model }),
          ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
          ...(config.apiKeyEnv === undefined ? {} : { apiKeyEnv: config.apiKeyEnv }),
          ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
          ...(config.authToken === undefined ? {} : { authToken: config.authToken }),
          ...(config.binPath === undefined ? {} : { binPath: config.binPath }),
          ...(config.profile === undefined ? {} : { profile: config.profile }),
          ...(config.homePath === undefined ? {} : { homePath: config.homePath }),
          env: homes.env,
          retryDelaysMs: [],
        }))).pipe(
        Effect.provideService(Logging, logging),
        Effect.provide(NodeFileSystem.layer),
        Effect.exit,
      ),
    );
    if (Exit.isSuccess(exit)) {
      return exit.value.text.trim() === ""
        ? { status: "unavailable", reason: "real health request returned no assistant response" }
        : { status: "ready", reason: "real health request succeeded" };
    }
    const failure = Cause.failureOption(exit.cause);
    const error = Option.isSome(failure) && failure.value instanceof AgentError ? failure.value : undefined;
    if (error?.kind === "configuration" || error?.kind === "authentication") {
      return { status: "unconfigured", reason: "native harness configuration or authentication is incomplete" };
    }
    if (error?.kind === "cancelled") return { status: "unavailable", reason: "real health request timed out" };
    return { status: "unavailable", reason: "real health request failed" };
  } catch {
    return { status: "unavailable", reason: "real health request failed" };
  } finally {
    try {
      await rm(root, { recursive: true, force: true });
    } catch {
      // Diagnostic cleanup must not turn an already classified probe into a
      // false positive or expose a filesystem detail in doctor output.
    }
  }
}

async function probeHarness(harness: HarnessName, deps: DoctorCommandDeps): Promise<HarnessDoctorReport> {
  const config = deps.harnessConfig?.(harness) ?? resolveHarnessConfig(harness);
  const descriptor = describeHarness(harness, config);
  if (harness === "pi") {
    if (!await (deps.sdkAvailable ?? piLoadable)()) {
      return { harness, status: "unavailable", reason: "pi SDK is not installed or is below the supported version" };
    }
    if (config.provider === undefined || config.model === undefined) {
      return { harness, status: "unconfigured", reason: "provider or model is missing" };
    }
    return { harness, status: "ready", reason: "Pi SDK and model configuration are available" };
  }
  const executable = descriptor.executable;
  if (executable === undefined) return { harness, status: "unconfigured", reason: "no executable configured" };
  try {
    const version = (await (deps.runExecutable ?? runExecutable)(executable, ["--version"])).split("\n", 1)[0];
    const probe = await (deps.probeSubprocess?.(harness, config) ?? runSubprocessProbe(harness, config));
    // dsh resumes sessions through a Piano-overlaid runner script that needs a
    // plugin API older builds lack. A passing health request says nothing
    // about that API, so a ready dsh is probed once more for resume — the
    // alternative is the user discovering the gap on their first resumed turn.
    const resume = harness === "dsh" && probe.status === "ready"
      ? (await (deps.probeDshResume?.(config) ?? probeDshResumeCapability(config))).capability
      : undefined;
    return {
      harness,
      status: probe.status,
      executable,
      version,
      reason: probe.reason,
      ...(probe.status === "ready" ? { realRequest: true } : {}),
      ...(resume === undefined ? {} : { resume }),
    };
  } catch {
    return { harness, status: "unavailable", executable, reason: "executable is not runnable" };
  }
}

export function formatHarnessDoctorReport(reports: readonly HarnessDoctorReport[]): string {
  return reports.map((report) => {
    const suffix = report.version === undefined ? "" : ` (${report.version})`;
    const detail = report.reason === undefined ? "" : ` — ${report.reason}`;
    const resume = report.resume === undefined || report.resume === "supported"
      ? ""
      : report.resume === "unsupported"
        ? "; the installed dsh cannot resume sessions — upgrade dsh or resumed runs will fail"
        : "; resume capability unknown";
    return `${report.status === "ready" && resume === "" ? "[PASS]" : "[WARN]"} ${report.harness}: ${report.status}${suffix}${detail}${resume}`;
  }).join("\n");
}

export function formatModelDoctorReport(report: ModelDoctorReport): string {
  if (report.model !== undefined) {
    if (report.status === "supported") return `[PASS] model: ${report.model} responded successfully`;
    const detail = report.reason === undefined ? "" : ` — ${report.reason}`;
    return `[WARN] model: ${report.model}: ${report.status}${detail}`;
  }

  if (report.status === "unavailable" || report.status === "unconfigured") {
    const detail = report.reason === undefined ? "" : ` — ${report.reason}`;
    return `[WARN] models: ${report.status}${detail}`;
  }

  if (report.models.length === 0) return `[WARN] models: no models advertised by ${report.endpoint}`;
  return [
    `[PASS] models: ${report.models.length} available (${report.endpoint})`,
    ...report.models.map((model) => `  ${model}`),
  ].join("\n");
}

/** Report every swept model on its own line, then an `n/m` summary. An empty
 * sweep is a warning naming the config key rather than a summary: "0/0
 * responded" would read as a pass when nothing was actually checked. */
export function formatModelSweepReport(reports: readonly ModelDoctorReport[]): string {
  if (reports.length === 0) {
    return `[WARN] models: none configured — add a "models" array to ${agentConfigPath()}`;
  }
  const passed = reports.filter((report) => report.status === "supported").length;
  return [
    ...reports.map((report) => formatModelDoctorReport(report)),
    `${passed === reports.length ? "[PASS]" : "[WARN]"} models: ${passed}/${reports.length} responded successfully`,
  ].join("\n");
}

export function parseModelIds(value: unknown): readonly string[] | undefined {
  let entries: readonly unknown[];
  if (Array.isArray(value)) {
    entries = value;
  } else if (isRecord(value) && Array.isArray(value.data)) {
    entries = value.data;
  } else if (isRecord(value) && Array.isArray(value.models)) {
    entries = value.models;
  } else {
    return undefined;
  }

  const ids = entries.flatMap((entry): readonly string[] => {
    if (typeof entry === "string" && entry.trim() !== "") return [entry.trim()];
    if (isRecord(entry) && typeof entry.id === "string" && entry.id.trim() !== "") return [entry.id.trim()];
    return [];
  });
  return [...new Set(ids)];
}

function endpointFor(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    let path = url.pathname.replace(/\/+$/, "");
    if (path.endsWith("/models")) path = path.slice(0, -"/models".length);
    url.pathname = `${path}${path.endsWith("/v1") ? "" : "/v1"}/models`;
    return url.toString();
  } catch {
    return baseUrl;
  }
}

/** The configured OpenAI-compatible base URL, from the same resolution every
 * harness uses. There is deliberately no built-in default: an install that
 * configures nothing gets an `unconfigured` report, never a silent request to
 * a hardcoded third-party site. */
function apiBaseUrl(deps: DoctorCommandDeps): string | undefined {
  return deps.modelEndpoint ?? deps.modelConfig?.baseUrl;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error && (cause.name === "AbortError" || cause.name === "TimeoutError")) {
    return "model endpoint request timed out";
  }
  return "model endpoint request failed";
}

function configuredApiKey(config: ResolvedHarnessConfig): string | undefined {
  if (config.apiKey === undefined) return undefined;
  if (/^[A-Z][A-Z0-9_]*$/.test(config.apiKey)) return process.env[config.apiKey] ?? config.apiKey;
  return config.apiKey;
}

function modelRequestHeaders(config: ResolvedHarnessConfig): Record<string, string> {
  const apiKey = configuredApiKey(config);
  return {
    Accept: "application/json",
    ...(apiKey === undefined ? {} : { Authorization: `Bearer ${apiKey}` }),
  };
}

function piFailureReport(model: string, cause: unknown): ModelDoctorReport {
  const failure = cause instanceof AgentError ? cause : undefined;
  if (failure?.kind === "model-not-found") {
    return {
      status: "unsupported",
      endpoint: "pi",
      models: [],
      model,
      reason: "Pi SDK could not resolve this model from its provider configuration",
    };
  }
  if (failure?.kind === "configuration" || failure?.kind === "authentication") {
    return {
      status: "unconfigured",
      endpoint: "pi",
      models: [],
      model,
      reason: "Pi SDK provider or authentication is not configured",
    };
  }
  if (failure?.kind === "sdk-discovery" || failure?.kind === "sdk-unavailable" || failure?.kind === "sdk-load") {
    return {
      status: "unavailable",
      endpoint: "pi",
      models: [],
      model,
      reason: "Pi SDK could not be loaded",
    };
  }
  if (failure?.kind === "rate-limit") {
    return {
      status: "unavailable",
      endpoint: "pi",
      models: [],
      model,
      reason: "Pi SDK provider rate-limited the model request",
    };
  }
  if (failure?.kind === "timeout") {
    return {
      status: "unavailable",
      endpoint: "pi",
      models: [],
      model,
      reason: "Pi SDK model request timed out",
    };
  }
  if (failure?.kind === "request-rejected") {
    return {
      status: "unavailable",
      endpoint: "pi",
      models: [],
      model,
      reason: "Pi SDK provider rejected the model request",
    };
  }
  return {
    status: "unavailable",
    endpoint: "pi",
    models: [],
    model,
    reason: "Pi SDK model request failed",
  };
}

async function runPiModelProbe(
  model: string,
  config: ResolvedHarnessConfig,
  sdk: PiModule | undefined,
): Promise<ModelDoctorReport> {
  const probeApiKey = configuredApiKey(config);
  const root = await mkdtemp(join(tmpdir(), "piano-doctor-pi-"));
  const runId = `doctor-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const logging = probeLogging(runId, root);
  try {
    const exit = await Effect.runPromise(
      prepareHarnessHomes({
        // The probe answers "can a mission reach this model?", so it must run
        // against the same generated registry a mission gets — not the user's
        // own Pi install. The requested id is registered alongside the
        // configured list so `--model <unlisted>` stays answerable.
        rootDir: join(root, "home"),
        configs: { pi: config },
        models: [...new Set([...resolveSupportedModels(), model])],
      }).pipe(Effect.flatMap((homes) => executeAgent({
        cwd: process.cwd(),
        prompt: "Reply with exactly OK. This is a health check; do not use tools.",
        model,
        tools: [],
        // A health check that cannot end is worse than a failed one: without a
        // bound, one unresponsive model stalls the whole `--model all` sweep and
        // the report never prints. The allowance is well above a two-token reply
        // even for a reasoning model, so a trip here means genuinely unusable.
        signal: AbortSignal.timeout(90_000),
        sessionDir: join(root, "session"),
      }, {
        // The configured model is deliberately not forwarded — asking about one
        // model must never be answered about another; the requested model above
        // always wins. Provider and credential are forwarded, because Pi
        // discovers a provider from its own registry *before* the credential is
        // applied: on an install whose Pi auth store is empty that registry
        // advertises nothing, so a working model reports "unconfigured", and
        // when Pi does guess a provider it may not be the one this credential
        // belongs to, which sends the key to the wrong endpoint.
        usePianoConfig: false,
        ...(config.provider === undefined ? {} : { provider: config.provider }),
        ...(probeApiKey === undefined ? {} : { apiKey: probeApiKey }),
        ...(sdk === undefined ? {} : { sdk }),
        ...homes.agentOptions,
      }))).pipe(
        Effect.provideService(Logging, logging),
        Effect.provide(NodeFileSystem.layer),
        Effect.exit,
      ),
    );
    if (Exit.isSuccess(exit)) {
      return { status: "supported", endpoint: "pi", models: [], model };
    }
    const failure = Cause.failureOption(exit.cause);
    return piFailureReport(model, Option.isSome(failure) ? failure.value : undefined);
  } catch {
    return piFailureReport(model, undefined);
  } finally {
    try {
      await rm(root, { recursive: true, force: true });
    } catch {
      // Doctor output is about model health; a temporary diagnostic artifact
      // cleanup failure must not hide the probe result.
    }
  }
}

/** Prove one model through a native subprocess harness, so a model claim covers
 * the harnesses a mission may actually select and not just the SDK adapter.
 *
 * A subprocess reports a failed run rather than a typed reason, so an id its
 * harness cannot resolve lands on `unavailable` instead of `unsupported`: that
 * distinction does not survive the process boundary, and asserting it would be
 * a guess. */
async function runSubprocessModelProbe(
  harness: Exclude<HarnessName, "pi">,
  model: string,
  config: ResolvedHarnessConfig,
  deps: DoctorCommandDeps,
): Promise<ModelDoctorReport> {
  const requested: ResolvedHarnessConfig = { ...config, model };
  const probe = await (deps.probeSubprocess?.(harness, requested) ?? runSubprocessProbe(
    harness,
    requested,
    // The requested id joins the configured list, because the generated catalog
    // is what makes a model resolvable — otherwise `--model <unlisted>` could
    // only ever report the configured default's health.
    [...new Set([...(deps.supportedModels ?? resolveSupportedModels)(), model])],
  ));
  return {
    status: probe.status === "ready" ? "supported" : probe.status,
    endpoint: harness,
    models: [],
    model,
    ...(probe.reason === undefined ? {} : { reason: probe.reason }),
  };
}

/** Route one model probe to the selected harness. */
function probeModel(
  harness: HarnessName,
  model: string,
  config: ResolvedHarnessConfig,
  deps: DoctorCommandDeps,
): Promise<ModelDoctorReport> {
  return harness === "pi"
    ? deps.probePi?.(model, config) ?? runPiModelProbe(model, config, deps.pi)
    : runSubprocessModelProbe(harness, model, config, deps);
}

async function probeModels(
  requestedModel: string | undefined,
  deps: DoctorCommandDeps,
  harness: HarnessName = "pi",
): Promise<ModelDoctorReport> {
  const config = deps.modelConfig ?? (deps.harnessConfig ?? resolveHarnessConfig)(harness);
  const fetchModelList = deps.fetch ?? globalThis.fetch;
  if (requestedModel !== undefined) {
    return probeModel(harness, requestedModel, config, deps);
  }
  const baseUrl = apiBaseUrl({ ...deps, modelConfig: config });
  if (baseUrl === undefined) {
    return {
      status: "unconfigured",
      endpoint: "",
      models: [],
      reason: `model endpoint is not configured — set "baseUrl" in ${agentConfigPath()}`,
    };
  }
  const endpoint = endpointFor(baseUrl);
  try {
    const response = await fetchModelList(endpoint, {
      headers: modelRequestHeaders(config),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return {
        status: response.status === 401 || response.status === 403 ? "unconfigured" : "unavailable",
        endpoint,
        models: [],
        reason: response.status === 401 || response.status === 403
          ? "API key was rejected or is missing"
          : `endpoint returned HTTP ${response.status}`,
      };
    }
    const models = parseModelIds(await response.json());
    if (models === undefined) {
      return { status: "unavailable", endpoint, models: [], reason: "endpoint returned an invalid model list" };
    }
    return { status: "supported", endpoint, models };
  } catch (cause) {
    return { status: "unavailable", endpoint, models: [], reason: errorMessage(cause) };
  }
}

/** Prove every model the config records, one real harness request each. The
 * sweep is sequential on purpose: a legible per-model verdict matters more than
 * wall-clock here, and firing every request at once would both scramble the
 * output order and risk a rate-limit that reads as a model failure. */
async function sweepModels(deps: DoctorCommandDeps, harness: HarnessName = "pi"): Promise<readonly ModelDoctorReport[]> {
  const config = deps.modelConfig ?? (deps.harnessConfig ?? resolveHarnessConfig)(harness);
  const models = (deps.supportedModels ?? resolveSupportedModels)();
  const reports: ModelDoctorReport[] = [];
  for (const model of models) {
    reports.push(await probeModel(harness, model, config, deps));
  }
  return reports;
}

export function doctorCommand(
  args: readonly string[],
  deps: DoctorCommandDeps = {},
): Effect.Effect<void, CliArgumentError> {
  const write = deps.write ?? ((line: string) => stdout.write(`${line}\n`));
  if (args[0] === "--model") {
    // `--model <id|all> [--harness <name>]`. The harness selector is optional and
    // defaults to the SDK adapter, so the two-argument form keeps its meaning.
    const [, requestedModel, harnessFlag, selectedHarness] = args;
    const targetHarness = harnessFlag === undefined ? "pi" : selectedHarness;
    if (
      args.length > 4
      || requestedModel === "" || requestedModel?.startsWith("-") === true
      || (harnessFlag !== undefined && harnessFlag !== "--harness")
      || targetHarness === undefined || !isHarnessName(targetHarness)
    ) {
      return Effect.fail(new CliArgumentError({ message: doctorUsage }));
    }
    return Effect.tryPromise({
      try: async () => {
        // `all` sweeps the configured list, mirroring `--harness all`. A model
        // literally named `all` is unreachable this way; it is still swept when
        // the config lists it.
        if (requestedModel === "all") {
          write(formatModelSweepReport(await sweepModels(deps, targetHarness)));
          return;
        }
        const report = await probeModels(requestedModel, deps, targetHarness);
        write(formatModelDoctorReport(report));
      },
      catch: () => new CliArgumentError({ message: doctorUsage }),
    });
  }

  if (args[0] !== "--harness" || args[1] === undefined || args.length !== 2) {
    return Effect.fail(new CliArgumentError({ message: doctorUsage }));
  }
  const selected = args[1];
  if (selected !== "all" && !isHarnessName(selected)) {
    return Effect.fail(new CliArgumentError({ message: doctorUsage }));
  }
  const harnesses = selected === "all" ? HARNESS_NAMES : [selected];
  return Effect.tryPromise({
    try: async () => {
      const reports = await Promise.all(harnesses.map((harness) => probeHarness(harness, deps)));
      write(formatHarnessDoctorReport(reports));
    },
    catch: () => new CliArgumentError({ message: doctorUsage }),
  });
}
