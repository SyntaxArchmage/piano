/**
 * The local Laya provider process.
 *
 * Piano's Node process never imports Python. It starts `laya-serve` once,
 * waits for `/health`, and then speaks the neutral `/v1/systemone` contract
 * over loopback. The process is detached so it can serve later runs; a missing
 * binary or a failed start is reported as `SystemOneError`, which the engine
 * treats as "run the stage", never as a workflow failure.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { io } from "@piano/base";
import { Duration, Effect } from "effect";
import {
  HttpSystemOneProvider,
  SystemOneError,
  type SystemOneProvider,
  type SystemOneRequest,
  type SystemOneResponse,
} from "./system-one.js";

const DEFAULT_ENDPOINT = "http://127.0.0.1:8000";
const START_TIMEOUT_MS = 120_000;
const HEALTH_TIMEOUT_MS = 500;

function configuredEndpoint(): string {
  return process.env.PIANO_LAYA_URL ?? DEFAULT_ENDPOINT;
}

function failure(message: string, cause?: unknown): SystemOneError {
  return new SystemOneError({
    model: "laya",
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

function endpointUrl(endpoint: string): Effect.Effect<URL, SystemOneError> {
  return Effect.try({
    try: () => new URL(endpoint),
    catch: (cause) => failure(`invalid Laya endpoint "${endpoint}"`, cause),
  });
}

function healthy(endpoint: string): Effect.Effect<boolean, never> {
  return io.fetchJson(`${endpoint.replace(/\/+$/u, "")}/health`).pipe(
    Effect.timeoutFail({
      duration: Duration.millis(HEALTH_TIMEOUT_MS),
      onTimeout: () => failure("Laya health check timed out"),
    }),
    Effect.map((response) => response.ok),
    Effect.catchAll(() => Effect.succeed(false)),
  );
}

function launcher(): string {
  return process.env.PIANO_LAYA_BIN ?? join(homedir(), ".piano", "laya-venv", "bin", "laya-serve");
}

function launcherEnv(endpoint: URL): NodeJS.ProcessEnv {
  const port = endpoint.port === "" ? (endpoint.protocol === "https:" ? "443" : "80") : endpoint.port;
  return {
    ...process.env,
    LAYA_DEVICE: "cpu",
    LAYA_MODELS: process.env.LAYA_MODELS ?? "english",
    LAYA_PRELOAD: "1",
    LAYA_HOST: endpoint.hostname,
    LAYA_PORT: port,
  };
}

/** Start the local service when it is missing, or reuse a healthy one. The
 * endpoint is cached only after a successful start; a failed attempt can be
 * retried by a later skippable stage. */
const startSemaphore = Effect.unsafeMakeSemaphore(1);
let readyEndpoint: string | undefined;

export function ensureLayaEndpoint(endpoint = configuredEndpoint()): Effect.Effect<string, SystemOneError> {
  return startSemaphore.withPermits(1)(Effect.gen(function* () {
    if (readyEndpoint !== undefined) return readyEndpoint;
    if (yield* healthy(endpoint)) {
      readyEndpoint = endpoint;
      return endpoint;
    }
    const url = yield* endpointUrl(endpoint);
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") {
      return yield* Effect.fail(failure(`Laya auto-start only supports loopback endpoints, got ${url.hostname}`));
    }
    const binary = launcher();
    if (!(yield* io.exists(binary))) {
      return yield* Effect.fail(failure(
        `Laya is not installed at ${binary}; run scripts/setup-laya.sh or set PIANO_LAYA_BIN`,
      ));
    }
    yield* io.spawnDetached(binary, [], { env: launcherEnv(url) }).pipe(
      Effect.mapError((cause) => failure(`could not start Laya at ${binary}: ${cause.message}`, cause)),
    );
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (yield* healthy(endpoint)) {
        readyEndpoint = endpoint;
        return endpoint;
      }
      yield* Effect.sleep(Duration.millis(250));
    }
    return yield* Effect.fail(failure(`Laya did not become healthy within ${START_TIMEOUT_MS / 1000}s`));
  }));
}

/** The default provider. Laya auto-starts; any other model id is assumed to
 * be served by an already-running compatible endpoint. */
export class LayaProvider implements SystemOneProvider {
  readonly model = "laya";

  constructor(private readonly endpoint = configuredEndpoint()) {}

  decide(request: SystemOneRequest): Effect.Effect<SystemOneResponse, SystemOneError> {
    return ensureLayaEndpoint(this.endpoint).pipe(
      Effect.flatMap((endpoint) => new HttpSystemOneProvider(this.model, endpoint).decide(request)),
    );
  }
}

export function defaultSystemOneProvider(model = "laya"): SystemOneProvider {
  return model === "laya"
    ? new LayaProvider()
    : new HttpSystemOneProvider(model, configuredEndpoint());
}
