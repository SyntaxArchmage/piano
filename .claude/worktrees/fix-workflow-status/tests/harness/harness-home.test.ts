import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  dshModelPatchPath,
  dshResumeOverlayPath,
  dshResumeRunnerPath,
  dshWebSearchOffPatchPath,
  prepareHarnessHomes,
} from "../../packages/harness/src/index.js";

describe("Piano-owned harness configuration home", () => {
  it("generates every harness config from Piano's own config and never touches the user's", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-harness-home-"));
    const userPi = join(root, "user-pi");
    const userClaude = join(root, "user-claude");
    const userDsh = join(root, "user-dsh");
    const homeRoot = join(root, "home");
    // A populated set of native installs, each holding something Piano must not
    // read into its own home: another provider, another model, a stored secret.
    const originalRegistry = `${JSON.stringify({
      providers: {
        enflame: {
          baseUrl: "https://user.example/v1",
          models: [{ id: "user-only-model" }],
        },
      },
    }, null, 2)}\n`;
    const originalAuth = '{"enflame":{"key":"user-stored-secret"}}\n';
    const originalClaude = '{"theme":"user"}\n';
    const originalDsh = "agent-default-model:\n  provider: user-provider\n  model: user-model\n";
    try {
      for (const directory of [userPi, userClaude, userDsh]) {
        await mkdir(directory, { recursive: true });
      }
      await writeFile(join(userPi, "models.json"), originalRegistry, "utf8");
      await writeFile(join(userPi, "auth.json"), originalAuth, "utf8");
      await writeFile(join(userClaude, "settings.json"), originalClaude, "utf8");
      await writeFile(join(userDsh, "settings.yaml"), originalDsh, "utf8");

      const observed = await Effect.runPromise(prepareHarnessHomes({
        rootDir: homeRoot,
        // `homePath` is the user's native install. It is passed deliberately: a
        // home that honoured it would reproduce the very coupling this
        // mechanism removes.
        configs: {
          pi: {
            homePath: userPi,
            provider: "enflame",
            model: "deepseek-v4-flash",
            apiKey: "pi-secret",
            baseUrl: "https://api.example/v1",
          },
          claude: { homePath: userClaude, model: "qwen3.8-27b", apiKey: "claude-secret" },
          dsh: {
            homePath: userDsh,
            provider: "enflame",
            model: "qwen3.8-27b",
            apiKey: "dsh-secret",
            baseUrl: "http://127.0.0.1:8787/v1",
          },
          codex: { homePath: join(root, "user-codex"), model: "gpt-5.6-luna" },
        },
        models: ["deepseek-v4-flash", "qwen3.8-max", "claude-opus-5"],
      }).pipe(Effect.flatMap((homes) => Effect.tryPromise({
        try: async () => ({
          env: homes.env,
          agentDir: homes.agentOptions.agentDir,
          paths: homes.paths,
          registry: await readFile(join(homes.paths.pi, "models.json"), "utf8"),
          auth: await readFile(join(homes.paths.pi, "auth.json"), "utf8"),
          dsh: await readFile(join(homes.paths.dsh, "settings.yaml"), "utf8"),
          claudeEntries: await readdir(homes.paths.claude),
          mode: (await stat(homes.paths.pi)).mode & 0o777,
        }),
        catch: (cause) => cause,
      }))));

      // Every harness is aimed at Piano's home through its own documented
      // pointer: an option for the in-process SDK, environment for the rest.
      expect(observed.agentDir).toBe(observed.paths.pi);
      expect(observed.env.PI_CODING_AGENT_DIR).toBe(observed.paths.pi);
      expect(observed.env.CLAUDE_CONFIG_DIR).toBe(observed.paths.claude);
      expect(observed.env.DSH_HOME).toBe(observed.paths.dsh);
      expect(observed.env.CODEX_HOME).toBe(join(root, "user-codex"));
      expect(observed.mode).toBe(0o700);

      // Pi's registry is Piano's list under Piano's endpoint, in config order.
      const registry = JSON.parse(observed.registry) as {
        providers: Record<string, { baseUrl: string; models: readonly { id: string }[] }>;
      };
      expect(Object.keys(registry.providers)).toEqual(["enflame"]);
      expect(registry.providers.enflame!.baseUrl).toBe("https://api.example/v1");
      expect(registry.providers.enflame!.models).toEqual([
        { id: "deepseek-v4-flash" },
        { id: "qwen3.8-max" },
        { id: "claude-opus-5" },
      ]);

      // dsh gets Piano's provider and model, with the credential left as an
      // environment reference.
      expect(observed.dsh).toContain('"enflame"');
      expect(observed.dsh).toContain('"qwen3.8-27b"');
      expect(observed.dsh).toContain("PIANO_DSH_API_KEY");
      expect(observed.dsh).toContain("web-search-deepseek:");

      // No secret is written to any generated file.
      for (const contents of [observed.registry, observed.auth, observed.dsh]) {
        expect(contents).not.toContain("pi-secret");
        expect(contents).not.toContain("dsh-secret");
        expect(contents).not.toContain("claude-secret");
      }

      // Nothing of the user's is inherited: not their model, not their endpoint,
      // not their stored credential, not their Claude settings.
      expect(observed.registry).not.toContain("user-only-model");
      expect(observed.registry).not.toContain("user.example");
      expect(observed.auth).not.toContain("user-stored-secret");
      expect(observed.dsh).not.toContain("user-provider");
      expect(observed.dsh).not.toContain("user-model");
      expect(observed.claudeEntries).toEqual([]);

      // ...and nothing of the user's is modified either.
      expect(await readFile(join(userPi, "models.json"), "utf8")).toBe(originalRegistry);
      expect(await readFile(join(userPi, "auth.json"), "utf8")).toBe(originalAuth);
      expect(await readFile(join(userClaude, "settings.json"), "utf8")).toBe(originalClaude);
      expect(await readFile(join(userDsh, "settings.yaml"), "utf8")).toBe(originalDsh);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("carries every dsh model in one catalog and selects one per run through a launcher patch", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-harness-home-dsh-"));
    const homeRoot = join(root, "home");
    try {
      const homes = await Effect.runPromise(prepareHarnessHomes({
        rootDir: homeRoot,
        configs: {
          dsh: {
            provider: "enflame",
            model: "qwen3.8-27b",
            apiKey: "dsh-secret",
            baseUrl: "http://127.0.0.1:8787/v1",
            toolsMode: "native",
          },
        },
        models: ["deepseek-v4-flash", "vendor/namespaced-model"],
      }));
      const settings = await readFile(join(homes.paths.dsh, "settings.yaml"), "utf8");

      // One credential serves every model on a pi-ai route, so the catalog is
      // Piano's whole list plus the configured default. A model missing here is
      // one a run could name but dsh could not resolve.
      expect([...settings.matchAll(/^\s+- id: "(.+)"$/gm)].map((match) => match[1])).toEqual([
        "deepseek-v4-flash",
        "vendor/namespaced-model",
        "qwen3.8-27b",
      ]);
      // The settings document layers over the composition, so an
      // `agent-default-model` section here would shadow the per-run overlay and
      // pin every mission to one model.
      expect(settings).not.toContain("agent-default-model");
      expect(settings).not.toContain("dsh-secret");

      // dsh's headless runner has no model flag, so selection is a launcher
      // overlay: one file per reachable model, each naming only its own.
      const patch = await readFile(dshModelPatchPath(homes.paths.dsh, "vendor/namespaced-model"), "utf8");
      expect(patch).toContain("- id: agent-default-model");
      expect(patch).toContain('provider: "enflame"');
      expect(patch).toContain('model: "vendor/namespaced-model"');
      // Every catalog entry is selectable, and an id carrying a separator stays
      // inside the generated directory instead of escaping it.
      expect((await readdir(join(homes.paths.dsh, "patches"))).sort()).toEqual([
        "deepseek-v4-flash.patch.yml",
        "qwen3.8-27b.patch.yml",
        "piano-resume.patch.yml",
        "vendor%2Fnamespaced-model.patch.yml",
        "web-search-off.yml",
      ]);
      expect(await readFile(dshWebSearchOffPatchPath(homes.paths.dsh), "utf8")).toContain("search: false");

      // The tool surface is Piano's decision, not whatever the shell that started
      // the mission happens to hold.
      expect(homes.env.DSH_TOOLS_MODE).toBe("native");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // dsh's shipped runner hardcodes a fresh session id, so a continued Piano actor
  // would arrive as a stranger no matter how many turns resume.json recorded.
  // Piano overlays a runner that reopens the actor's session instead.
  it("ships a dsh runner that resumes, with the overlay that installs it", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-harness-home-resume-"));
    const homeRoot = join(root, "home");
    try {
      const homes = await Effect.runPromise(prepareHarnessHomes({ rootDir: homeRoot, models: [] }));

      // Replaces exactly one row: the runner that mints the session id. The
      // startup row stays mounted, so the task still arrives through the app's
      // own argument parsing rather than a second parser Piano would maintain.
      const overlay = await readFile(dshResumeOverlayPath(homes.paths.dsh), "utf8");
      expect(overlay).toContain("- id: headless-runner\n  disabled: true");
      expect(overlay).toContain("name: ./resume-runner.mjs");
      expect(overlay).not.toContain("headless-startup");

      // The plugin lives inside the profile directory the overlay names it
      // relative to, and carries the resume call the shipped runner lacks.
      const runnerPath = dshResumeRunnerPath(homes.paths.dsh);
      expect(dirname(runnerPath)).toBe(join(homes.paths.dsh, "profiles", "headless"));
      const runner = await readFile(runnerPath, "utf8");
      expect(runner).toContain("agents.resume");
      expect(runner).toContain("resumeSessionId");
      expect(runner).toContain("PIANO_DSH_RESUME_SESSION");
      // A dsh that cannot resume must not fail the run: the plugin falls back to
      // a fresh session, and says so.
      expect(runner).toContain("agents.create");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("empties the registry rather than leaving a stale one when nothing is configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-harness-home-stale-"));
    const homeRoot = join(root, "home");
    const read = (options: Parameters<typeof prepareHarnessHomes>[0]) =>
      Effect.runPromise(prepareHarnessHomes(options).pipe(
        Effect.flatMap((homes) => Effect.tryPromise({
          try: () => readFile(join(homes.paths.pi, "models.json"), "utf8"),
          catch: (cause) => cause,
        })),
      ));
    try {
      const configured = await read({
        rootDir: homeRoot,
        configs: { pi: { provider: "enflame", baseUrl: "https://api.example/v1" } },
        models: ["qwen3.8-max"],
      });
      expect(configured).toContain("qwen3.8-max");

      // The directory is durable, so each of these must actively clear the
      // previous run's registry. Writing nothing would let a model keep
      // resolving after the configuration that justified it was removed.
      const withoutEndpoint = await read({
        rootDir: homeRoot,
        configs: { pi: { provider: "enflame" } },
        models: ["qwen3.8-max"],
      });
      expect(JSON.parse(withoutEndpoint)).toEqual({ providers: {} });

      const withoutProvider = await read({
        rootDir: homeRoot,
        configs: { pi: { baseUrl: "https://api.example/v1" } },
        models: ["qwen3.8-max"],
      });
      expect(JSON.parse(withoutProvider)).toEqual({ providers: {} });

      const withoutModels = await read({
        rootDir: homeRoot,
        configs: { pi: { provider: "enflame", baseUrl: "https://api.example/v1" } },
        models: [],
      });
      expect(JSON.parse(withoutModels)).toEqual({ providers: {} });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("regenerates in place so a fixed home can be shared by concurrent missions", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-harness-home-shared-"));
    const homeRoot = join(root, "home");
    const options = {
      rootDir: homeRoot,
      configs: { pi: { provider: "enflame", baseUrl: "https://api.example/v1" } },
      models: ["deepseek-v4-flash", "qwen3.8-max"],
    };
    try {
      const homes = await Promise.all(
        Array.from({ length: 4 }, () => Effect.runPromise(prepareHarnessHomes(options))),
      );
      // A fixed home means every mission resolves to the same directory, and
      // repeated preparation converges instead of accumulating.
      expect(new Set(homes.map((home) => home.paths.pi)).size).toBe(1);
      expect(await readdir(homes[0]!.paths.pi)).toEqual(["auth.json", "models.json"]);
      const registry = JSON.parse(await readFile(join(homes[0]!.paths.pi, "models.json"), "utf8")) as {
        providers: Record<string, { models: readonly { id: string }[] }>;
      };
      expect(registry.providers.enflame!.models).toEqual([
        { id: "deepseek-v4-flash" },
        { id: "qwen3.8-max" },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
