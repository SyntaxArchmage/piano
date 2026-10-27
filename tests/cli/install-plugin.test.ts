import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPluginCommand } from "../../packages/cli/src/plugin-install.js";

const HOST_SCRIPT = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOST_LOG"
case "$1" in
  --version) echo "\${FAKE_VERSION:-2.1.311 (Claude Code)}"; exit 0 ;;
  plugin)
    case "$2" in
      list) echo "\${FAKE_LIST:-[]}"; exit 0 ;;
      install) echo '{"outcome":"ok"}'; exit 0 ;;
      configure) cat > /dev/null; echo "Configuration saved."; exit 0 ;;
    esac ;;
esac
exit 0
`;

describe("piano install-plugin", () => {
  let root: string;
  let log: string;
  let output: string[];
  let original: { CLAUDE_CONFIG_DIR?: string; PATH?: string; FAKE_VERSION?: string; FAKE_LIST?: string };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "piano-install-plugin-"));
    log = join(root, "host.log");
    const bin = join(root, "bin");
    await mkdir(bin, { recursive: true });
    const claude = join(bin, "claude");
    await writeFile(claude, HOST_SCRIPT, "utf8");
    await chmod(claude, 0o755);
    original = {
      CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
      PATH: process.env.PATH,
      FAKE_VERSION: process.env.FAKE_VERSION,
      FAKE_LIST: process.env.FAKE_LIST,
    };
    process.env.CLAUDE_CONFIG_DIR = join(root, "claude");
    process.env.PATH = `${bin}:${original.PATH ?? ""}`;
    process.env.HOST_LOG = log;
    delete process.env.FAKE_VERSION;
    delete process.env.FAKE_LIST;
    output = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      output.push(String(line));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete process.env.HOST_LOG;
    await rm(root, { recursive: true, force: true });
  });

  const run = (args: readonly string[] = []) => Effect.runPromise(installPluginCommand(args));

  it("skips a missing Claude home", async () => {
    await run();
    expect(output.join("\n")).toContain("home not found");
  });

  it("skips a Claude below the mod API floor", async () => {
    await mkdir(process.env.CLAUDE_CONFIG_DIR!, { recursive: true });
    process.env.FAKE_VERSION = "2.1.310 (Claude Code)";
    await run(["--native"]);
    expect(output.join("\n")).toContain("below the mod API floor");
    expect(await readFile(log, "utf8")).not.toContain("plugin install");
  });

  it("installs the plugin and enables the native tool", async () => {
    await mkdir(process.env.CLAUDE_CONFIG_DIR!, { recursive: true });
    await run(["--native"]);
    const calls = await readFile(log, "utf8");
    expect(calls).toContain("plugin install piano");
    expect(calls).toContain("--config PIANO_CLAUDE_NATIVE=1");
    expect(output.join("\n")).toContain("installed the piano plugin");
    expect(output.join("\n")).toContain("enabled the native piano_run tool");
  });

  it("leaves the plugin inert without --native", async () => {
    await mkdir(process.env.CLAUDE_CONFIG_DIR!, { recursive: true });
    await run();
    const calls = await readFile(log, "utf8");
    expect(calls).toContain("plugin install piano");
    expect(calls).not.toContain("--config");
  });

  it("says the plugin is inert when it was already installed without --native", async () => {
    await mkdir(process.env.CLAUDE_CONFIG_DIR!, { recursive: true });
    process.env.FAKE_LIST = '[{"id":"piano@piano-local","enabled":true}]';
    await run();
    expect(output.join("\n")).toContain("already installed");
    expect(output.join("\n")).toContain("--native not requested");
  });

  it("enables the tool on an installed plugin through the same install call", async () => {
    await mkdir(process.env.CLAUDE_CONFIG_DIR!, { recursive: true });
    process.env.FAKE_LIST = '[{"id":"piano@piano-local","enabled":true}]';
    await run(["--native"]);
    const calls = await readFile(log, "utf8");
    expect(calls).toContain("plugin install piano");
    expect(calls).toContain("--config PIANO_CLAUDE_NATIVE=1");
    expect(output.join("\n")).toContain("already installed");
    expect(output.join("\n")).toContain("enabled the native piano_run tool");
  });

  it("does not install or configure during --dry-run, installed or not", async () => {
    await mkdir(process.env.CLAUDE_CONFIG_DIR!, { recursive: true });
    await run(["--dry-run", "--native"]);
    process.env.FAKE_LIST = '[{"id":"piano@piano-local","enabled":true}]';
    await run(["--dry-run", "--native"]);
    const calls = await readFile(log, "utf8");
    expect(calls).not.toContain("plugin install piano --marketplace");
    expect(output.join("\n")).toContain("would run claude plugin install");
  });
});