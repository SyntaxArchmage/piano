/** Process-global Langfuse export runtime.
 *
 * The OTel tracer provider is process-global, so there is at most one active
 * runtime. Unconfigured processes never import the OTel SDK: the Langfuse
 * packages are loaded lazily inside `startLangfuseRuntime`. */

import { resolveLangfuseConfig, type LangfuseConfig } from "./config.js";

export interface LangfuseRuntime {
  readonly config: LangfuseConfig;
  /** Push pending spans now. Bounded by the SDK's request timeout. */
  flush(): Promise<void>;
  /** Flush and tear the processor down. Call once, on process exit. */
  shutdown(): Promise<void>;
}

let active: LangfuseRuntime | undefined;

/** Start the export runtime for an already-resolved config.
 *
 * A second call returns the runtime already running — the OTel provider is
 * process-global and double-registering a span processor would duplicate every
 * span. */
export async function startLangfuseRuntime(config: LangfuseConfig): Promise<LangfuseRuntime> {
  if (active !== undefined) return active;
  const [{ LangfuseSpanProcessor }, { NodeSDK }] = await Promise.all([
    import("@langfuse/otel"),
    import("@opentelemetry/sdk-node"),
  ]);
  const processor = new LangfuseSpanProcessor({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    baseUrl: config.baseUrl,
    ...(config.environment === undefined ? {} : { environment: config.environment }),
    ...(config.release === undefined ? {} : { release: config.release }),
    // Transcripts stay on disk; export never uploads media from them.
    mediaUploadEnabled: false,
  });
  const sdk = new NodeSDK({ spanProcessors: [processor] });
  sdk.start();
  const runtime: LangfuseRuntime = {
    config,
    flush: () => processor.forceFlush(),
    shutdown: async () => {
      await processor.shutdown();
      await sdk.shutdown();
    },
  };
  active = runtime;
  return runtime;
}

/** Start from `process.env` (or a test's env map). Returns undefined — and
 * loads nothing — when export is not configured. */
export async function startLangfuseRuntimeFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<LangfuseRuntime | undefined> {
  const config = resolveLangfuseConfig(env);
  if (config === undefined) return undefined;
  return startLangfuseRuntime(config);
}

export async function flushLangfuse(): Promise<void> {
  await active?.flush();
}

export async function shutdownLangfuse(): Promise<void> {
  const runtime = active;
  active = undefined;
  await runtime?.shutdown();
}
