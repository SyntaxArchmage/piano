import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { THINKING_LEVELS, type ThinkingLevel } from "./events.js";
import { asRecord } from "./json-narrowing.js";

/** The available adapter names are closed so an unavailable provider cannot silently
 * turn into a different provider. `pi` is the in-process SDK adapter; the other
 * positions are subprocess adapters. */
export const HARNESS_NAMES = ["pi", "pi-cli", "claude", "dsh", "codex"] as const;
export type HarnessName = (typeof HARNESS_NAMES)[number];

export function isHarnessName(value: string): value is HarnessName {
  return (HARNESS_NAMES as readonly string[]).includes(value);
}

export interface ResolvedHarnessConfig {
  readonly provider?: string;
  readonly model?: string;
  readonly apiKey?: string;
  /** Environment variable name used by a native harness to resolve apiKey. */
  readonly apiKeyEnv?: string;
  readonly baseUrl?: string;
  readonly authToken?: string;
  readonly binPath?: string;
  /** Native configuration home, for example DSH_HOME or CLAUDE_CONFIG_DIR. */
  readonly homePath?: string;
  /** Native profile name for harnesses that expose profiles. */
  readonly profile?: string;
  /** Native tool-presentation mode for harnesses that expose one. dsh reads
   * `native` (its standard mode), `code` (Code Mode/PTC), or `both`; the value
   * is passed through verbatim so an unsupported one fails at the harness with
   * its own message instead of being silently coerced here. */
  readonly toolsMode?: string;
  /** Reasoning effort, resolved with the same precedence as model/provider so a
   * level configured once applies to every adapter that can honor it. */
  readonly thinkingLevel?: ThinkingLevel;
}

export interface HarnessDescriptor {
  readonly name: HarnessName;
  readonly kind: "sdk" | "subprocess";
  readonly executable?: string;
  readonly configured: boolean;
  readonly reason?: string;
}

interface ConfigRecord {
  readonly harness?: unknown;
  readonly models?: unknown;
  readonly pi?: unknown;
  readonly piCli?: unknown;
  readonly [key: string]: unknown;
}

/** A config value with content. Beyond the shared empty check this drops the
 * template's `CHANGE_ME` placeholder, and trims, because a hand-edited JSON
 * file collects whitespace that no harness wants to receive. The placeholder
 * is compared against the raw value, so a configured `" CHANGE_ME "` trims to
 * a literal the harness is then free to reject. */
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" && value !== "CHANGE_ME"
    ? value.trim()
    : undefined;
}

/** The default user-config path. `agentConfigPath` lets an env override swap
 * it per process, so every reader that needs a path goes through the function
 * and nothing hardcodes the literal twice. */
export const defaultAgentConfigPath = join(homedir(), ".piano", "agent.config.json");

export function agentConfigPath(): string {
  return process.env.PIANO_USER_AGENT_CONFIG ?? defaultAgentConfigPath;
}

function configuredFile(): ConfigRecord {
  const path = agentConfigPath();
  if (!existsSync(path)) return {};
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return asRecord(value) as ConfigRecord ?? {};
  } catch {
    // The selected adapter will report missing configuration or executable
    // details. A malformed optional config file must not crash discovery.
    return {};
  }
}

function nestedConfig(config: ConfigRecord, harness: HarnessName): Record<string, unknown> {
  const key = harness === "pi-cli" ? "piCli" : harness;
  // `deepseek` was the pre-native name for the official dsh adapter. Keep its
  // config readable during the rename, but never turn a missing dsh executable
  // into a Pi executable.
  if (harness === "dsh") {
    return asRecord(config.dsh) ?? asRecord(config.deepseek) ?? {};
  }
  // The in-process `pi` adapter also accepts the root-level provider/model
  // fields: they predate per-harness nesting and are shared with doctor.
  return asRecord(config[key])
    ?? (harness === "pi" ? config : undefined)
    ?? {};
}

function envPrefixes(harness: HarnessName): readonly string[] {
  // The subprocess adapters read their own namespace so a CLI-specific setting
  // never leaks into the in-process SDK adapter.
  if (harness === "pi-cli") return ["PI_CLI"];
  if (harness === "dsh") return ["DSH", "DEEPSEEK"];
  if (harness === "codex") return ["CODEX"];
  return [harness.toUpperCase()];
}

function envValue(harness: HarnessName, suffix: string): string | undefined {
  for (const prefix of envPrefixes(harness)) {
    const value = stringValue(process.env[`PIANO_${prefix}_${suffix}`]);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** A deployment that fronts every harness with one gateway typically configures
 * the endpoint on the per-harness sections. Pi reads the root, so a config
 * that only lists the gateway in `dsh`/`deepseek`/`claude` would otherwise
 * yield an empty model registry and fail later as a cryptic
 * `model-not-found`. Reuse that gateway for Pi; an explicit root, `pi`
 * section, or `PIANO_PI_BASE_URL` value always wins. */
function gatewayBaseUrl(config: ConfigRecord): string | undefined {
  for (const key of ["dsh", "deepseek", "claude"] as const) {
    const baseUrl = stringValue(asRecord(config[key])?.baseUrl);
    if (baseUrl !== undefined) return baseUrl;
  }
  return undefined;
}

/** OpenAI-compatible clients concatenate request paths verbatim onto the base
 * URL (`{baseUrl}/chat/completions`) and never append `/v1` themselves, so a
 * bare gateway origin — the most common paste — silently hits the gateway's
 * web front page and fails as a stream error that looks like a provider
 * fault. An empty (or root-only) path therefore gets `/v1` added; any
 * explicitly configured path is kept untouched. `claude` is excluded: the
 * Anthropic SDK expects a root-style base and appends `/v1/messages` itself. */
function normalizeBaseUrl(harness: HarnessName, baseUrl: string): string {
  if (harness === "claude") return baseUrl;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return baseUrl;
  }
  if (url.pathname === "" || url.pathname === "/") {
    url.pathname = "/v1";
    return url.toString();
  }
  return baseUrl;
}

/** Resolve the default workflow adapter at the configuration boundary. An
 * unknown configured value is returned intentionally so workflow parsing can
 * produce a precise validation error instead of silently selecting Pi. */
export function configuredWorkflowHarness(): string {
  return stringValue(process.env.PIANO_HARNESS)
    ?? stringValue(configuredFile().harness)
    ?? "pi";
}

/** Resolve the models this install has proven against its provider, in the
 * order the config lists them. This is the sweep range for model diagnostics,
 * not a whitelist: a model outside the list stays selectable, so a stale list
 * can never block a newly published model. A missing file or key yields an
 * empty list, which the caller reports as "nothing configured" rather than as
 * a passing check. */
export function resolveSupportedModels(): readonly string[] {
  const configured = configuredFile().models;
  if (!Array.isArray(configured)) return [];
  const ids = configured.flatMap((entry): readonly string[] => {
    const id = stringValue(entry);
    return id === undefined ? [] : [id];
  });
  return [...new Set(ids)];
}

/** Resolve provider settings without sharing credentials between adapters.
 * Explicit request/options values are handled by the caller and passed here
 * as overrides. */
export function resolveHarnessConfig(
  harness: HarnessName,
  overrides: ResolvedHarnessConfig = {},
): ResolvedHarnessConfig {
  const config = configuredFile();
  const nested = nestedConfig(config, harness);
  const provider = stringValue(overrides.provider)
    ?? envValue(harness, "PROVIDER")
    ?? stringValue(nested.provider)
    ?? (harness === "dsh" ? "deepseek" : undefined);
  const model = stringValue(overrides.model)
    ?? envValue(harness, "MODEL")
    ?? stringValue(nested.model);
  const apiKey = stringValue(overrides.apiKey)
    ?? envValue(harness, "API_KEY")
    ?? stringValue(nested.apiKey);
  const apiKeyEnv = stringValue(overrides.apiKeyEnv)
    ?? envValue(harness, "API_KEY_ENV")
    ?? stringValue(nested.apiKeyEnv);
  const baseUrl = stringValue(overrides.baseUrl)
    ?? envValue(harness, "BASE_URL")
    ?? stringValue(nested.baseUrl)
    ?? (harness === "pi" ? gatewayBaseUrl(config) : undefined);
  const resolvedBaseUrl = baseUrl === undefined ? undefined : normalizeBaseUrl(harness, baseUrl);
  const authToken = stringValue(overrides.authToken)
    ?? envValue(harness, "AUTH_TOKEN")
    ?? stringValue(nested.authToken);
  // dsh is intentionally a provider-scoped subprocess position: by
  // default it uses the pi-compatible CLI, and deployments may replace it
  // with a dedicated DeepSeek agent via PIANO_DSH_BIN/config.
  const configuredBin = stringValue(overrides.binPath)
    ?? envValue(harness, "BIN")
    ?? stringValue(nested.bin)
    ?? (harness === "claude" ? "claude" : harness === "dsh" ? "dsh" : harness === "codex" ? "codex" : "pi");
  // Older `deepseek` configs used `pi` as the subprocess implementation. That
  // value is a migration artifact, never a valid dsh default.
  const binPath = harness === "dsh" && configuredBin === "pi" ? "dsh" : configuredBin;
  const homePath = stringValue(overrides.homePath)
    ?? envValue(harness, "HOME")
    ?? stringValue(nested.home)
    ?? stringValue(nested.homePath);
  const profile = stringValue(overrides.profile)
    ?? envValue(harness, "PROFILE")
    ?? stringValue(nested.profile);
  // dsh's headless bundle reads its tool presentation from the process
  // environment, so an unset value would inherit whatever the developer's shell
  // holds. Defaulting to dsh's standard mode makes a mission's tool surface a
  // Piano decision rather than an ambient one.
  const toolsMode = stringValue(overrides.toolsMode)
    ?? envValue(harness, "TOOLS_MODE")
    ?? stringValue(nested.toolsMode)
    ?? (harness === "dsh" ? "native" : undefined);
  const thinkingLevel = thinkingLevelValue(overrides.thinkingLevel)
    ?? thinkingLevelValue(envValue(harness, "THINKING_LEVEL"))
    ?? thinkingLevelValue(nested.thinkingLevel);
  return {
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    ...(resolvedBaseUrl === undefined ? {} : { baseUrl: resolvedBaseUrl }),
    ...(authToken === undefined ? {} : { authToken }),
    ...(binPath === undefined ? {} : { binPath }),
    ...(homePath === undefined ? {} : { homePath }),
    ...(profile === undefined ? {} : { profile }),
    ...(toolsMode === undefined ? {} : { toolsMode }),
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
  };
}

/** Keep only a level the portable vocabulary actually defines; anything else
 * (typo, unsupported native value) resolves as unset rather than reaching a
 * harness as an opaque argument. */
function thinkingLevelValue(value: unknown): ThinkingLevel | undefined {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value)
    ? value as ThinkingLevel
    : undefined;
}

/** A cheap capability view for status/doctor callers. Actual PATH lookup is
 * intentionally deferred to spawn, where the child error can retain its
 * concrete executable and working-directory context. */
export function describeHarness(
  harness: HarnessName,
  overrides: ResolvedHarnessConfig = {},
): HarnessDescriptor {
  if (harness === "pi") {
    return {
      name: harness,
      kind: "sdk",
      configured: true,
      reason: "Pi SDK availability is checked when the SDK is loaded",
    };
  }
  const config = resolveHarnessConfig(harness, overrides);
  return {
    name: harness,
    kind: "subprocess",
    executable: config.binPath,
    configured: config.binPath !== undefined,
    ...(config.binPath === undefined ? { reason: "no executable configured" } : {}),
  };
}
