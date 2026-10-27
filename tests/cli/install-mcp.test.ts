import { chmod, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMcpCommand } from "../../packages/cli/src/mcp-install.js";

const HOST_SCRIPT = `#!/bin/sh
printf '%s %s\\n' "$(basename "$0")" "$*" >> "$HOST_LOG"
if [ "$1" = "mcp" ] && [ "$2" = "get" ]; then
  exit "\${GET_CODE:-1}"
fi
exit 0
`;

describe("piano install-mcp", () => {
  let root: string;
  let log: string;
  let original: { HOME?: string; PATH?: string; CLAUDE_CONFIG_DIR?: string; CODEX_HOME?: string; DSH_HOME?: string; GET_CODE?: string };
  let output: string[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "piano-install-mcp-"));
    log = join(root, "host.log");
    const bin = join(root, "bin");
    await mkdir(bin, { recursive: true });
    for (const name of ["claude", "codex"]) {
      const path = join(bin, name);
      await writeFile(path, HOST_SCRIPT, "utf8");
      await chmod(path, 0o755);
    }
    original = {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
      CODEX_HOME: process.env.CODEX_HOME,
      DSH_HOME: process.env.DSH_HOME,
      GET_CODE: process.env.GET_CODE,
    };
    process.env.HOME = root;
    process.env.PATH = `${bin}:${original.PATH ?? ""}`;
    process.env.CLAUDE_CONFIG_DIR = join(root, "claude");
    process.env.CODEX_HOME = join(root, "codex");
    process.env.DSH_HOME = join(root, "dsh");
    process.env.HOST_LOG = log;
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

  const run = (args: readonly string[] = []) =>
    Effect.runPromise(installMcpCommand(args).pipe(Effect.provide(NodeFileSystem.layer)));

  it("registers Claude and Codex and writes the dsh patch", async () => {
    for (const name of ["claude", "codex", "dsh"]) await mkdir(join(root, name), { recursive: true });
    await run();
    const calls = (await readFile(log, "utf8")).trim().split("\n");
    expect(calls.some((line) => line.startsWith("claude mcp add --scope user piano"))).toBe(true);
    expect(calls.some((line) => line.startsWith("codex mcp add piano"))).toBe(true);
    const patch = await readFile(join(root, ".piano", "dsh", "piano-mcp.yml"), "utf8");
    expect(patch).toContain("serverName: piano");
    expect(patch).toContain("piano-mcp.mjs");
    expect(output.join("\n")).toContain("claude: registered");
    expect(output.join("\n")).toContain("codex: registered");
    expect(output.join("\n")).toContain("dsh: wrote");
  });

  it("skips homes that do not exist", async () => {
    await mkdir(join(root, "claude"), { recursive: true });
    await run();
    expect(await readFile(log, "utf8")).not.toContain("codex mcp add");
    expect(output.join("\n")).toContain("codex: skipped (home not found");
    expect(output.join("\n")).toContain("dsh: skipped (home not found");
  });

  it("skips a host whose CLI is missing and still finishes the other targets", async () => {
    for (const name of ["claude", "codex", "dsh"]) await mkdir(join(root, name), { recursive: true });
    await rm(join(root, "bin", "codex"), { force: true });
    // Only the stub directory is on PATH, so the real codex cannot be found.
    process.env.PATH = join(root, "bin");
    await run(["--target", "codex", "--target", "dsh"]);
    expect(output.join("\n")).toContain("codex: skipped (codex CLI not found)");
    const patch = await readFile(join(root, ".piano", "dsh", "piano-mcp.yml"), "utf8");
    expect(patch).toContain("serverName: piano");
  });

  it("does not add a server that is already configured", async () => {
    for (const name of ["claude", "codex", "dsh"]) await mkdir(join(root, name), { recursive: true });
    process.env.GET_CODE = "0";
    await run();
    const calls = await readFile(log, "utf8");
    expect(calls).not.toContain("mcp add");
    expect(output.join("\n")).toContain("already configured");
  });

  it("does not write or add during --dry-run", async () => {
    for (const name of ["claude", "codex", "dsh"]) await mkdir(join(root, name), { recursive: true });
    await run(["--dry-run"]);
    const calls = await readFile(log, "utf8");
    expect(calls).not.toContain("mcp add");
    await expect(readFile(join(root, ".piano", "dsh", "piano-mcp.yml"), "utf8")).rejects.toThrow();
    expect(output.join("\n")).toContain("would run claude mcp add");
    expect(output.join("\n")).toContain("would write");
  });

  it("reports a dangling dsh patch symlink as a conflict, not a race", async () => {
    await mkdir(join(root, "dsh"), { recursive: true });
    const target = join(root, ".piano", "dsh", "piano-mcp.yml");
    await mkdir(join(root, ".piano", "dsh"), { recursive: true });
    await symlink(join(root, "gone.yml"), target);
    await run(["--target", "dsh"]);
    expect(output.join("\n")).toContain("symlink to a missing file");
    expect(output.join("\n")).not.toContain("appeared concurrently");
  });

  it("leaves an existing dsh patch untouched", async () => {
    await mkdir(join(root, "dsh"), { recursive: true });
    const path = join(root, ".piano", "dsh", "piano-mcp.yml");
    await mkdir(join(root, ".piano", "dsh"), { recursive: true });
    await writeFile(path, "custom\n");
    await run(["--target", "dsh"]);
    expect(await readFile(path, "utf8")).toBe("custom\n");
    expect(output.join("\n")).toContain("conflict");
  });

  it("updates through a symlinked dsh patch instead of replacing the link", async () => {
    await mkdir(join(root, "dsh"), { recursive: true });
    const target = join(root, ".piano", "dsh", "piano-mcp.yml");
    await mkdir(join(root, ".piano", "dsh"), { recursive: true });
    const real = join(root, "dotfiles-piano-mcp.yml");
    await writeFile(real, "# Generated by Piano: mounts the Piano MCP server for /piano.\n- stale: true\n");
    await symlink(real, target);
    await run(["--target", "dsh"]);
    expect((await lstat(target)).isSymbolicLink()).toBe(true);
    expect(await readFile(real, "utf8")).toContain("serverName: piano");
  });

  it("updates its own dsh patch when the generated content goes stale", async () => {
    await mkdir(join(root, "dsh"), { recursive: true });
    const path = join(root, ".piano", "dsh", "piano-mcp.yml");
    await mkdir(join(root, ".piano", "dsh"), { recursive: true });
    await writeFile(path, "# Generated by Piano: mounts the Piano MCP server for /piano.\n- insert:\n  old: true\n");
    await run(["--target", "dsh"]);
    const updated = await readFile(path, "utf8");
    expect(updated).toContain("serverName: piano");
    expect(updated).not.toContain("old: true");
    expect(output.join("\n")).toContain("dsh: updated");
  });
});
