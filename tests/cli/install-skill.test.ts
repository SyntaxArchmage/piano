import { mkdtemp, mkdir, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installSkillCommand } from "../../packages/cli/src/skill-install.js";
import { listFiles } from "../common/fs.js";

const TEMPLATE = new URL("../../skills/piano/SKILL.md", import.meta.url);

describe("piano install-skill", () => {
  let root: string;
  let claude: string;
  let dsh: string;
  let output: string[];
  const originalClaude = process.env.CLAUDE_CONFIG_DIR;
  const originalDsh = process.env.DSH_HOME;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "piano-install-skill-"));
    claude = join(root, "claude");
    dsh = join(root, "dsh");
    process.env.CLAUDE_CONFIG_DIR = claude;
    process.env.DSH_HOME = dsh;
    output = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      output.push(String(line));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = originalClaude;
    if (originalDsh === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = originalDsh;
    await rm(root, { recursive: true, force: true });
  });

  const run = (args: readonly string[] = []) => Effect.runPromise(installSkillCommand(args));

  it("installs only into existing agent homes", async () => {
    await mkdir(claude, { recursive: true });
    await run();
    expect(await readFile(join(claude, "skills", "piano", "SKILL.md"), "utf8"))
      .toBe(await readFile(TEMPLATE, "utf8"));
    await expect(stat(dsh)).rejects.toThrow();
    expect(output.join("\n")).toContain("dsh: skipped (home not found");
  });

  it("creates skills/piano under an existing home", async () => {
    await mkdir(dsh, { recursive: true });
    await run(["--target", "dsh"]);
    expect(await readFile(join(dsh, "skills", "piano", "SKILL.md"), "utf8"))
      .toBe(await readFile(TEMPLATE, "utf8"));
  });

  it("does not touch unrelated skills and is idempotent", async () => {
    await mkdir(join(claude, "skills", "existing"), { recursive: true });
    await writeFile(join(claude, "skills", "existing", "SKILL.md"), "keep\n");
    await run(["--target", "claude"]);
    const before = await stat(join(claude, "skills", "piano", "SKILL.md"));
    const again = await run(["--target", "claude"]);
    const after = await stat(join(claude, "skills", "piano", "SKILL.md"));
    expect(await readFile(join(claude, "skills", "existing", "SKILL.md"), "utf8")).toBe("keep\n");
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(output.join("\n")).toContain("up-to-date");
    expect(again).toBeUndefined();
  });

  it("skips an existing piano skill without changing it", async () => {
    const destination = join(claude, "skills", "piano", "SKILL.md");
    await mkdir(join(claude, "skills", "piano"), { recursive: true });
    await writeFile(destination, "my own skill\n");
    await run(["--target", "claude"]);
    expect(await readFile(destination, "utf8")).toBe("my own skill\n");
    expect(output.join("\n")).toContain("conflict");
  });

  it("skips a flat piano.md and a piano directory without SKILL.md", async () => {
    await mkdir(join(claude, "skills"), { recursive: true });
    await writeFile(join(claude, "skills", "piano.md"), "flat\n");
    await run(["--target", "claude"]);
    expect(await readFile(join(claude, "skills", "piano.md"), "utf8")).toBe("flat\n");
    expect(await readFile(join(claude, "skills", "piano.md"), "utf8")).toBe("flat\n");

    await rm(join(claude, "skills", "piano.md"));
    await mkdir(join(claude, "skills", "piano"), { recursive: true });
    await writeFile(join(claude, "skills", "piano", "notes.txt"), "keep\n");
    await run(["--target", "claude"]);
    expect(await readFile(join(claude, "skills", "piano", "notes.txt"), "utf8")).toBe("keep\n");
    expect(output.join("\n")).toContain("exists without SKILL.md");
  });

  it("does not follow a symlinked piano directory", async () => {
    const sentinel = join(root, "sentinel");
    await mkdir(join(claude, "skills"), { recursive: true });
    await mkdir(sentinel);
    await symlink(sentinel, join(claude, "skills", "piano"));
    await run(["--target", "claude"]);
    expect(await readlink(join(claude, "skills", "piano"))).toBe(sentinel);
    expect(await listFiles(sentinel)).toEqual([]);
    expect(output.join("\n")).toContain("conflict");
  });

  it("honors --dry-run and --target", async () => {
    await mkdir(claude, { recursive: true });
    await mkdir(dsh, { recursive: true });
    await run(["--target", "claude", "--dry-run"]);
    await expect(stat(join(claude, "skills"))).rejects.toThrow();
    await expect(stat(join(dsh, "skills"))).rejects.toThrow();
    expect(output.join("\n")).toContain("would install");
  });

  it("writes nothing outside skills/piano", async () => {
    await mkdir(join(claude, "skills", "existing"), { recursive: true });
    await writeFile(join(claude, "skills", "existing", "SKILL.md"), "keep\n");
    await run(["--target", "claude"]);
    expect((await listFiles(claude)).sort()).toEqual([
      join(claude, "skills", "existing", "SKILL.md"),
      join(claude, "skills", "piano", "SKILL.md"),
    ]);
  });
});
