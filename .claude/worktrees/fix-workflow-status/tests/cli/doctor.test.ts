import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import {
  doctorCommand,
  doctorUsage,
  formatHarnessDoctorReport,
  formatModelDoctorReport,
  formatModelSweepReport,
  parseModelIds,
} from "../../packages/cli/src/doctor.js";
import type { PiModule } from "../../packages/harness/src/index.js";

describe(" doctor harness report", () => {
  it("formats each harness as a concise machine status", () => {
    expect(formatHarnessDoctorReport([
      { harness: "pi", status: "ready", executable: "pi", version: "0.84.2" },
      { harness: "claude", status: "unavailable", executable: "claude", reason: "executable is not runnable" },
    ])).toContain("[PASS] pi: ready (0.84.2)");
  });

  it("rejects missing or unknown harness selection", async () => {
    const exit = await Effect.runPromiseExit(doctorCommand([]));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain(doctorUsage);
  });

  it("parses OpenAI-compatible model lists and removes duplicate ids", () => {
    expect(parseModelIds({
      object: "list",
      data: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-flash" }, { id: "" }],
    })).toEqual(["deepseek-v4-flash"]);
    expect(parseModelIds({ models: ["model-a", { id: "model-b" }] })).toEqual(["model-a", "model-b"]);
    expect(parseModelIds({ object: "error" })).toBeUndefined();
  });

  it("lists models from the configured OpenAI-compatible endpoint", async () => {
    const output: string[] = [];
    let requestedUrl = "";
    let authorization = "";
    await Effect.runPromise(doctorCommand(["--model"], {
      modelEndpoint: "https://models.example/v1",
      modelConfig: { apiKey: "secret-key" },
      fetch: async (input, init) => {
        requestedUrl = String(input);
        authorization = String(new Headers(init?.headers).get("authorization"));
        return new Response(JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b" }] }), { status: 200 });
      },
      write: (line) => output.push(line),
    }));
    expect(requestedUrl).toBe("https://models.example/v1/models");
    expect(authorization).toBe("Bearer secret-key");
    expect(output[0]).toContain("[PASS] models: 2 available");
    expect(output[0]).toContain("model-a");
    expect(output[0]).not.toContain("secret-key");
  });

  it("routes a selected model through the Pi SDK probe", async () => {
    const output: string[] = [];
    let selectedModel = "";
    let selectedProvider = "";
    await Effect.runPromise(doctorCommand(["--model", "selected-model"], {
      modelConfig: { provider: "enflame", apiKey: "secret-key" },
      probePi: async (model, config) => {
        selectedModel = model;
        selectedProvider = config.provider ?? "";
        return { status: "supported", endpoint: "pi", models: [], model };
      },
      write: (line) => output.push(line),
    }));
    expect(selectedModel).toBe("selected-model");
    expect(selectedProvider).toBe("enflame");
    expect(output).toEqual(["[PASS] model: selected-model responded successfully"]);
  });

  it("uses Piano's executeAgent path for the default Pi SDK probe", async () => {
    const output: string[] = [];
    let prompted = "";
    let resolvedProvider = "";
    let resolvedModel = "";
    let runtimeApiKeyCalls = 0;
    const session = {
      sessionId: "doctor-session",
      sessionFile: "/tmp/doctor-session.jsonl",
      subscribe: (): (() => void) => () => undefined,
      prompt: async (prompt: string): Promise<void> => {
        prompted = prompt;
      },
      abort: async (): Promise<void> => undefined,
      dispose: (): void => undefined,
    };
    const sdk: PiModule = {
      ModelRuntime: {
        create: async () => ({
          getModels: () => [{ provider: "enflame", id: "selected-model" }],
          getModel: (provider: string, model: string) => {
            resolvedProvider = provider;
            resolvedModel = model;
            return { id: model };
          },
          setRuntimeApiKey: async () => { runtimeApiKeyCalls += 1; },
        }),
      },
      SessionManager: { create: () => ({}) },
      SettingsManager: { inMemory: () => ({}) },
      DefaultResourceLoader: class { reload = async (): Promise<void> => undefined; },
      createAgentSession: async () => ({ session }),
    };
    await Effect.runPromise(doctorCommand(["--model", "selected-model"], {
      modelConfig: { provider: "configured-provider", model: "configured-model", apiKey: "probe-api-key" },
      pi: sdk,
      write: (line) => output.push(line),
    }));
    // The configured provider and credential are forwarded: Pi resolves a
    // provider from its own registry before any credential is applied, so an
    // empty Pi auth store advertises no models and a working model would report
    // "unconfigured". The configured model is not forwarded — the model asked
    // about is the one named on the command line, never the config's default.
    expect(resolvedProvider).toBe("configured-provider");
    expect(resolvedModel).toBe("selected-model");
    expect(runtimeApiKeyCalls).toBe(1);
    expect(prompted).toBe("Reply with exactly OK. This is a health check; do not use tools.");
    expect(output).toEqual(["[PASS] model: selected-model responded successfully"]);
  });

  it("reports a selected model rejected by the Pi SDK", async () => {
    const output: string[] = [];
    await Effect.runPromise(doctorCommand(["--model", "missing-model"], {
      probePi: async (model) => ({
        status: "unsupported",
        endpoint: "pi",
        models: [],
        model,
        reason: "Pi SDK could not resolve this model from its provider configuration",
      }),
      write: (line) => output.push(line),
    }));
    expect(output).toEqual(["[WARN] model: missing-model: unsupported — Pi SDK could not resolve this model from its provider configuration"]);
    expect(formatModelDoctorReport({
      status: "unconfigured",
      endpoint: "pi",
      models: [],
      reason: "API key was rejected or is missing",
    })).toContain("[WARN] models: unconfigured");
  });

  it("checks the installed Pi SDK and configured subprocess harness", async () => {
    const sdkOutput: string[] = [];
    await Effect.runPromise(doctorCommand(["--harness", "pi"], {
      sdkAvailable: () => false,
      write: (line) => sdkOutput.push(line),
    }));
    expect(sdkOutput).toEqual(["[WARN] pi: unavailable — pi SDK is not installed or is below the supported version"]);

    const readySdkOutput: string[] = [];
    await Effect.runPromise(doctorCommand(["--harness", "pi"], {
      sdkAvailable: async () => true,
      harnessConfig: () => ({ provider: "enflame", model: "selected-model" }),
      write: (line) => readySdkOutput.push(line),
    }));
    expect(readySdkOutput).toEqual(["[PASS] pi: ready — Pi SDK and model configuration are available"]);

    const subprocessOutput: string[] = [];
    await Effect.runPromise(doctorCommand(["--harness", "pi-cli"], {
      harnessConfig: () => ({
        provider: "enflame",
        model: "selected-model",
        apiKey: "secret-key",
        binPath: "pi-test",
      }),
      runExecutable: async (file, args) => `${file} ${args.join(" ")} 1.0.0`,
      probeSubprocess: async (harness) => {
        expect(harness).toBe("pi-cli");
        return { status: "ready", reason: "real health request succeeded" };
      },
      write: (line) => subprocessOutput.push(line),
    }));
    expect(subprocessOutput).toEqual(["[PASS] pi-cli: ready (pi-test --version 1.0.0) — real health request succeeded"]);
  });

  it("sweeps every configured model through the Pi SDK probe in list order", async () => {
    const output: string[] = [];
    const probed: string[] = [];
    await Effect.runPromise(doctorCommand(["--model", "all"], {
      modelConfig: { provider: "enflame", apiKey: "secret-key" },
      supportedModels: () => ["deepseek-v4-flash", "qwen3.8-max", "gpt-5.6-luna"],
      probePi: async (model, config) => {
        probed.push(`${model}@${config.provider ?? ""}`);
        return model === "qwen3.8-max"
          ? {
            status: "unsupported",
            endpoint: "pi",
            models: [],
            model,
            reason: "Pi SDK could not resolve this model from its provider configuration",
          }
          : { status: "supported", endpoint: "pi", models: [], model };
      },
      write: (line) => output.push(line),
    }));
    expect(probed).toEqual([
      "deepseek-v4-flash@enflame",
      "qwen3.8-max@enflame",
      "gpt-5.6-luna@enflame",
    ]);
    expect(output[0]?.split("\n")).toEqual([
      "[PASS] model: deepseek-v4-flash responded successfully",
      "[WARN] model: qwen3.8-max: unsupported — Pi SDK could not resolve this model from its provider configuration",
      "[PASS] model: gpt-5.6-luna responded successfully",
      "[WARN] models: 2/3 responded successfully",
    ]);
    expect(output[0]).not.toContain("secret-key");
  });

  it("reports an empty configured list instead of a passing summary", async () => {
    const output: string[] = [];
    let probeCalls = 0;
    await Effect.runPromise(doctorCommand(["--model", "all"], {
      supportedModels: () => [],
      probePi: async (model) => {
        probeCalls += 1;
        return { status: "supported", endpoint: "pi", models: [], model };
      },
      write: (line) => output.push(line),
    }));
    expect(probeCalls).toBe(0);
    expect(output[0]).toContain("[WARN] models: none configured");
    expect(output[0]).toContain("\"models\" array");
    expect(output[0]).not.toContain("[PASS]");
  });

  it("reports every model unconfigured when no credential resolves", async () => {
    const output: string[] = [];
    await Effect.runPromise(doctorCommand(["--model", "all"], {
      supportedModels: () => ["model-a", "model-b"],
      probePi: async (model) => ({
        status: "unconfigured",
        endpoint: "pi",
        models: [],
        model,
        reason: "Pi SDK provider or authentication is not configured",
      }),
      write: (line) => output.push(line),
    }));
    expect(output[0]).toContain("[WARN] models: 0/2 responded successfully");
    expect(output[0]).not.toContain("[PASS]");
    expect(formatModelSweepReport([
      { status: "supported", endpoint: "pi", models: [], model: "model-a" },
      { status: "supported", endpoint: "pi", models: [], model: "model-b" },
    ])).toContain("[PASS] models: 2/2 responded successfully");
  });

  it("proves a model through the selected subprocess harness", async () => {
    const output: string[] = [];
    let probedHarness = "";
    let probedModel = "";
    await Effect.runPromise(doctorCommand(["--model", "qwen3.8-max", "--harness", "dsh"], {
      harnessConfig: () => ({ provider: "enflame", model: "configured-model", binPath: "dsh" }),
      probePi: async (model) => {
        throw new Error(`the SDK adapter must not answer for dsh: ${model}`);
      },
      probeSubprocess: async (harness, config) => {
        probedHarness = harness;
        probedModel = config.model ?? "";
        return { status: "ready", reason: "real health request succeeded" };
      },
      write: (line) => output.push(line),
    }));
    expect(probedHarness).toBe("dsh");
    // The model named on the command line replaces the configured default, so a
    // model claim covers the harness a mission may actually select.
    expect(probedModel).toBe("qwen3.8-max");
    expect(output).toEqual(["[PASS] model: qwen3.8-max responded successfully"]);

    const failing: string[] = [];
    await Effect.runPromise(doctorCommand(["--model", "qwen3.8-max", "--harness", "dsh"], {
      harnessConfig: () => ({ provider: "enflame", binPath: "dsh" }),
      probeSubprocess: async () => ({ status: "unavailable", reason: "real health request failed" }),
      write: (line) => failing.push(line),
    }));
    // A subprocess reports a failed run rather than a typed reason, so an id its
    // harness cannot resolve lands on `unavailable`: "unsupported" does not
    // survive the process boundary and asserting it would be a guess.
    expect(failing).toEqual(["[WARN] model: qwen3.8-max: unavailable — real health request failed"]);
  });

  it("defaults a model probe to the SDK adapter and rejects an unknown harness", async () => {
    const output: string[] = [];
    await Effect.runPromise(doctorCommand(["--model", "selected-model"], {
      probePi: async (model) => ({ status: "supported", endpoint: "pi", models: [], model }),
      probeSubprocess: async () => {
        throw new Error("a model probe without --harness must not spawn a subprocess");
      },
      write: (line) => output.push(line),
    }));
    expect(output).toEqual(["[PASS] model: selected-model responded successfully"]);

    for (const args of [["--model", "all", "--harness", "nope"], ["--model", "all", "--harness"]]) {
      const exit = await Effect.runPromiseExit(doctorCommand(args));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain(doctorUsage);
    }
    expect(doctorUsage).toContain("--harness <pi|pi-cli|claude|dsh|codex>");
  });

  it("still probes a model absent from the configured list", async () => {
    const output: string[] = [];
    let selected = "";
    await Effect.runPromise(doctorCommand(["--model", "unlisted-model"], {
      supportedModels: () => ["listed-model"],
      probePi: async (model) => {
        selected = model;
        return { status: "supported", endpoint: "pi", models: [], model };
      },
      write: (line) => output.push(line),
    }));
    expect(selected).toBe("unlisted-model");
    expect(output).toEqual(["[PASS] model: unlisted-model responded successfully"]);
    expect(doctorUsage).toContain("--model [<model>|all]");
  });
});
