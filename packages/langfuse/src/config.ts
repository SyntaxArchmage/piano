/** Langfuse export configuration.
 *
 * Export is opt-in: no config, no sink. A run without these keys writes exactly
 * the local evidence it always has and never loads the OTel SDK. */

export interface LangfuseConfig {
  /** No trailing slash: spans and scores both join paths onto this. */
  readonly baseUrl: string;
  readonly publicKey: string;
  readonly secretKey: string;
  readonly environment?: string;
  readonly release?: string;
  /** Redact secret-shaped values from exported payloads. Default true. */
  readonly mask: boolean;
}

/** A config value with content. Drops the `CHANGE_ME` template placeholder and
 * trims, matching the credential filter in harness-config. */
function stringValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed !== "" && trimmed !== "CHANGE_ME" ? trimmed : undefined;
}

/** `PIANO_LANGFUSE_*` wins over the SDK-native `LANGFUSE_*` so a machine-level
 * Langfuse default can be overridden per process without unsetting it. */
function value(
  env: Readonly<Record<string, string | undefined>>,
  suffix: string,
): string | undefined {
  return stringValue(env[`PIANO_LANGFUSE_${suffix}`]) ?? stringValue(env[`LANGFUSE_${suffix}`]);
}

function flag(
  env: Readonly<Record<string, string | undefined>>,
  suffix: string,
): boolean | undefined {
  const raw = stringValue(env[`PIANO_LANGFUSE_${suffix}`]) ?? stringValue(env[`LANGFUSE_${suffix}`]);
  if (raw === undefined) return undefined;
  return raw !== "0" && raw.toLowerCase() !== "false";
}

/** Resolve the export target from a process environment.
 *
 * Returns undefined unless enabled and all three required keys are present —
 * the shape `startLangfuseRuntimeFromEnv` treats as "do not load OTel". */
export function resolveLangfuseConfig(
  env: Readonly<Record<string, string | undefined>>,
): LangfuseConfig | undefined {
  if (flag(env, "ENABLED") === false) return undefined;
  const baseUrl = value(env, "BASE_URL");
  const publicKey = value(env, "PUBLIC_KEY");
  const secretKey = value(env, "SECRET_KEY");
  if (baseUrl === undefined || publicKey === undefined || secretKey === undefined) return undefined;
  const environment = value(env, "ENVIRONMENT");
  const release = value(env, "RELEASE");
  return {
    // Spans and scores join paths onto this differently, so a trailing slash
    // would send them to two URLs. One spelling here, both behave.
    baseUrl: baseUrl.replace(/\/+$/, ""),
    publicKey,
    secretKey,
    ...(environment === undefined ? {} : { environment }),
    ...(release === undefined ? {} : { release }),
    mask: flag(env, "MASK") ?? true,
  };
}
