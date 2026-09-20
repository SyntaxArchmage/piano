import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  HARNESS_NAMES,
  describeHarness,
  isHarnessName,
  resolveHarnessConfig,
  resolveSupportedModels,
} from "../../packages/harness/src/index.js";

describe(" harness configuration boundary", () => {
  it("exposes the SDK and subprocess harness positions without aliasing providers", () => {
    expect(HARNESS_NAMES).toEqual(["pi", "pi-cli", "claude", "dsh", "codex"]);
    expect(isHarnessName("claude")).toBe(true);
    expect(isHarnessName("future-harness")).toBe(false);
    expect(describeHarness("pi")).toMatchObject({ kind: "sdk", configured: true });
    expect(describeHarness("claude")).toMatchObject({
      kind: "subprocess",
      executable: "claude",
      configured: true,
    });
    expect(describeHarness("codex")).toMatchObject({
      kind: "subprocess",
      executable: "codex",
      configured: true,
    });
  });

  it("resolves Codex's isolated namespace without changing the native default", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-codex-config-"));
    const path = join(root, "agent.config.json");
    try {
      await writeFile(path, JSON.stringify({
        codex: { model: "gpt-5.6-luna", home: "/tmp/codex-home", bin: "codex-test" },
      }), "utf8");
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", path);
      expect(resolveHarnessConfig("codex")).toMatchObject({
        model: "gpt-5.6-luna",
        homePath: "/tmp/codex-home",
        binPath: "codex-test",
      });
      vi.stubEnv("PIANO_CODEX_MODEL", "gpt-5.6-terra");
      expect(resolveHarnessConfig("codex").model).toBe("gpt-5.6-terra");
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps explicit subprocess settings scoped to the selected harness", () => {
    expect(resolveHarnessConfig("dsh", {
      provider: "deepseek",
      model: "deepseek-coder",
      apiKey: "test-key",
      baseUrl: "https://gateway.example",
      authToken: "test-token",
      binPath: "deepseek-agent",
    })).toEqual({
      provider: "deepseek",
      model: "deepseek-coder",
      apiKey: "test-key",
      // dsh reaches the gateway through the OpenAI-compatible client, so the
      // bare origin is completed with the version path at this boundary.
      baseUrl: "https://gateway.example/v1",
      authToken: "test-token",
      binPath: "deepseek-agent",
      // dsh's own default, added because the harness would otherwise read the
      // mode from the shell that started the mission.
      toolsMode: "native",
    });
    expect(resolveHarnessConfig("claude", { provider: "anthropic", binPath: "fake-claude" })).toMatchObject({
      provider: "anthropic",
      binPath: "fake-claude",
    });
  });

  it("reads the pi-cli subprocess namespace separately from the pi SDK", () => {
    try {
      vi.stubEnv("PIANO_PI_PROVIDER", "sdk-provider");
      vi.stubEnv("PIANO_PI_CLI_PROVIDER", "subprocess-provider");
      expect(resolveHarnessConfig("pi-cli").provider).toBe("subprocess-provider");
      expect(resolveHarnessConfig("pi").provider).toBe("sdk-provider");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("resolves root Pi SDK settings for model diagnostics", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-harness-config-"));
    const path = join(root, "agent.config.json");
    try {
      await writeFile(path, JSON.stringify({
        provider: "enflame",
        model: "deepseek-v4-flash",
        apiKey: "secret-key",
        baseUrl: "https://api.enflame.cn/v1",
      }), "utf8");
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", path);
      expect(resolveHarnessConfig("pi")).toMatchObject({
        provider: "enflame",
        model: "deepseek-v4-flash",
        apiKey: "secret-key",
        baseUrl: "https://api.enflame.cn/v1",
      });
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads the pre-native deepseek config namespace without aliasing dsh to Pi", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-dsh-config-"));
    const path = join(root, "agent.config.json");
    try {
      await writeFile(path, JSON.stringify({
        deepseek: {
          provider: "enflame",
          model: "qwen3.8-27b",
          apiKey: "secret-key",
          bin: "pi",
        },
      }), "utf8");
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", path);
      expect(resolveHarnessConfig("dsh")).toMatchObject({
        provider: "enflame",
        model: "qwen3.8-27b",
        apiKey: "secret-key",
        binPath: "dsh",
      });
      expect(resolveHarnessConfig("dsh").binPath).not.toBe("pi");
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("pins dsh to its standard tools mode instead of inheriting the shell's", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-dsh-tools-mode-"));
    const path = join(root, "agent.config.json");
    try {
      await writeFile(path, JSON.stringify({ dsh: { provider: "enflame" } }), "utf8");
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", path);
      // dsh reads its tool presentation from the process environment, so an
      // unset value would make a mission's tool surface ambient. `native` is
      // dsh's standard mode.
      expect(resolveHarnessConfig("dsh").toolsMode).toBe("native");
      // No other harness exposes the setting, so none gets a value invented for
      // it.
      for (const harness of ["pi", "pi-cli", "claude"] as const) {
        expect(resolveHarnessConfig(harness).toolsMode).toBeUndefined();
      }

      await writeFile(path, JSON.stringify({ dsh: { provider: "enflame", toolsMode: "code" } }), "utf8");
      expect(resolveHarnessConfig("dsh").toolsMode).toBe("code");
      vi.stubEnv("PIANO_DSH_TOOLS_MODE", "both");
      expect(resolveHarnessConfig("dsh").toolsMode).toBe("both");
      expect(resolveHarnessConfig("dsh", { toolsMode: "native" }).toolsMode).toBe("native");
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads the proven model list in order, ignoring unusable entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-models-config-"));
    const path = join(root, "agent.config.json");
    try {
      await writeFile(path, JSON.stringify({
        model: "deepseek-v4-flash",
        models: [
          "deepseek-v4-flash",
          "  qwen3.8-max  ",
          "",
          "   ",
          42,
          null,
          { id: "gpt-5.6-luna" },
          "deepseek-v4-flash",
        ],
      }), "utf8");
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", path);
      expect(resolveSupportedModels()).toEqual(["deepseek-v4-flash", "qwen3.8-max"]);
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats a missing key, a non-array value, and a missing file as no proven models", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-models-empty-"));
    const path = join(root, "agent.config.json");
    try {
      await writeFile(path, JSON.stringify({ model: "deepseek-v4-flash" }), "utf8");
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", path);
      expect(resolveSupportedModels()).toEqual([]);

      await writeFile(path, JSON.stringify({ models: "deepseek-v4-flash" }), "utf8");
      expect(resolveSupportedModels()).toEqual([]);

      vi.stubEnv("PIANO_USER_AGENT_CONFIG", join(root, "absent.json"));
      expect(resolveSupportedModels()).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to the gateway baseUrl configured on another harness section", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-gateway-"));
    const path = join(root, "agent.config.json");
    try {
      // A gateway-fronted deployment that lists the endpoint only on the
      // dsh/deepseek/claude sections must still give Pi an endpoint: an
      // unset Pi baseUrl yields an empty registry that fails much later as
      // a cryptic `model-not-found`.
      await writeFile(path, JSON.stringify({
        harness: "pi",
        provider: "enflame",
        model: "deepseek-v4-flash",
        apiKey: "secret-key",
        deepseek: { baseUrl: "http://127.0.0.1:8787" },
        claude: { baseUrl: "http://127.0.0.1:8787" },
      }), "utf8");
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", path);
      expect(resolveHarnessConfig("pi").baseUrl).toBe("http://127.0.0.1:8787/v1");
      // The gateway is a fallback, never a shadow: an explicit root or
      // environment baseUrl wins.
      await writeFile(path, JSON.stringify({
        provider: "enflame",
        baseUrl: "https://api.enflame.cn/v1",
        deepseek: { baseUrl: "http://127.0.0.1:8787" },
      }), "utf8");
      expect(resolveHarnessConfig("pi").baseUrl).toBe("https://api.enflame.cn/v1");
      vi.stubEnv("PIANO_PI_BASE_URL", "https://env.example/v1");
      expect(resolveHarnessConfig("pi").baseUrl).toBe("https://env.example/v1");
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("adds the OpenAI version path to a bare gateway origin, never to Anthropic", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-baseurl-normalize-"));
    const path = join(root, "agent.config.json");
    try {
      // The OpenAI-compatible clients concatenate `/chat/completions` onto
      // the base URL verbatim. A bare origin hits the gateway's web front
      // page (HTTP 200 text/html) and fails as a misleading stream error, so
      // an empty path is completed to `/v1`. An explicit path is config the
      // deployment chose on purpose and is kept byte-for-byte.
      const cases: Array<[string, string, string]> = [
        ["pi", "https://gw.example", "https://gw.example/v1"],
        ["pi", "https://gw.example/", "https://gw.example/v1"],
        ["pi-cli", "http://127.0.0.1:8787", "http://127.0.0.1:8787/v1"],
        ["dsh", "https://gw.example/v1", "https://gw.example/v1"],
        ["pi", "https://gw.example/custom/path", "https://gw.example/custom/path"],
        // The Anthropic SDK appends `/v1/messages` itself; a completed base
        // would produce `/v1/v1/messages`.
        ["claude", "https://gw.example", "https://gw.example"],
      ];
      for (const [harness, configured, expected] of cases) {
        const section = harness === "pi-cli" ? "piCli" : harness;
        await writeFile(path, JSON.stringify({
          harness, provider: "enflame", apiKey: "secret-key", [section]: { baseUrl: configured },
        }), "utf8");
        vi.stubEnv("PIANO_USER_AGENT_CONFIG", path);
        expect(resolveHarnessConfig(harness as "pi" | "pi-cli" | "dsh" | "claude").baseUrl).toBe(expected);
      }
      // Overrides (request-level endpoints) go through the same boundary.
      expect(resolveHarnessConfig("pi", { baseUrl: "https://override.example" }).baseUrl).toBe("https://override.example/v1");
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ships an installable template whose proven model list is usable", async () => {
    const template: unknown = JSON.parse(
      await readFile(join(import.meta.dirname, "..", "..", "scripts", "agent.config.template.json"), "utf8"),
    );
    expect(template).toMatchObject({
      harness: "pi",
      provider: "enflame",
      model: "deepseek-v4-flash",
      // The placeholder is the sentinel the resolver ignores, so a fresh
      // install reports "unconfigured" instead of sending a bogus credential.
      apiKey: "CHANGE_ME",
      // The root-level baseUrl is Pi's registry contract: without it the
      // generated model registry is empty and every run fails as
      // `model-not-found`. A fresh install must not ship that shape.
      baseUrl: expect.any(String),
    });
    const models = (template as { readonly models: readonly string[] }).models;
    expect(models).toContain("deepseek-v4-flash");
    expect(new Set(models).size).toBe(models.length);
  });
});
