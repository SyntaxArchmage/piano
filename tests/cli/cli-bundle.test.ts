// The prebuilt-CLI start path, exercised by running the real bin.
//
// The bin decides between three ways to start: a bundle built from exactly
// these sources, a rebuild followed by that bundle, and — when a rebuild cannot
// happen — the TypeScript sources through tsx. What matters for the developer's
// loop is the property these cases pin down: editing a source file and running
// `piano` again takes effect, with no reinstall and no stale bundle, and a
// source tree that cannot be bundled at all still runs.
//
// The fixture is a miniature repo: the shipped bin and build module, copied
// verbatim, over stub sources. A `node_modules` symlink keeps tsx and esbuild
// resolvable without copying dependencies.
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRepo(marker: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "piano-cli-bundle-"));
  roots.push(root);
  await mkdir(join(root, "packages", "cli", "src"), { recursive: true });
  await mkdir(join(root, "packages", "cli", "bin"), { recursive: true });
  await mkdir(join(root, "packages", "cli", "scripts"), { recursive: true });
  await mkdir(join(root, "packages", "harness", "src"), { recursive: true });
  await cp(join(repoRoot, "packages", "cli", "bin", "piano.mjs"), join(root, "packages", "cli", "bin", "piano.mjs"));
  await cp(join(repoRoot, "packages", "cli", "scripts", "cli-bundle.mjs"), join(root, "packages", "cli", "scripts", "cli-bundle.mjs"));
  await writeFile(join(root, "package-lock.json"), "{}\n", "utf8");
  await writeFile(join(root, "packages", "harness", "src", "pi-web-search.ts"), "export const stub = true;\n", "utf8");
  await writeFile(join(root, "packages", "harness", "src", "dsh-resume-runner.mjs"), "// stub\n", "utf8");
  await writeMarker(root, marker);
  await symlink(join(repoRoot, "node_modules"), join(root, "node_modules"), "dir");
  return root;
}

async function writeMarker(root: string, marker: string): Promise<void> {
  await writeFile(
    join(root, "packages", "cli", "src", "main.ts"),
    `export function runCli(args: string[]): void {\n  console.log(${JSON.stringify(marker)} + args.join(","));\n}\n`,
    "utf8",
  );
}

interface Started {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

async function runBin(root: string): Promise<Started> {
  const child = spawn(process.execPath, [join(root, "packages", "cli", "bin", "piano.mjs"), "hello"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  return { code, stdout, stderr };
}

async function mtime(path: string): Promise<number> {
  return (await stat(path)).mtimeMs;
}

describe("prebuilt CLI start path", () => {
  it("builds the bundle, its sidecars and its fingerprint on first run", async () => {
    const root = await fixtureRepo("stub-run:");
    const started = await runBin(root);

    expect(started.code).toBe(0);
    expect(started.stdout.trim()).toBe("stub-run:hello");
    expect(started.stderr).toBe("");
    for (const name of ["piano.js", "pi-web-search.js", "dsh-resume-runner.mjs", ".fingerprint"]) {
      await expect(stat(join(root, "packages", "cli", "dist", name))).resolves.toBeTruthy();
    }
  });

  it("reuses the bundle while the sources are unchanged", async () => {
    const root = await fixtureRepo("stub-run:");
    await runBin(root);
    const bundle = join(root, "packages", "cli", "dist", "piano.js");
    const built = await mtime(bundle);

    const started = await runBin(root);

    expect(started.stdout.trim()).toBe("stub-run:hello");
    expect(await mtime(bundle)).toBe(built);
  });

  it("picks up an edited source without a reinstall, rebuilding first", async () => {
    const root = await fixtureRepo("stub-run:");
    await runBin(root);
    const bundle = join(root, "packages", "cli", "dist", "piano.js");
    const built = await mtime(bundle);

    await writeMarker(root, "edited-run:");
    // Directory mtimes do not move within one filesystem tick, so the edit has
    // to be visible by content rather than by ordering alone.
    await utimes(join(root, "packages", "cli", "src", "main.ts"), new Date(), new Date());
    const started = await runBin(root);

    expect(started.stdout.trim()).toBe("edited-run:hello");
    expect(await mtime(bundle)).toBeGreaterThan(built);
  });

  it("runs from sources when the tree cannot be bundled, and never the stale bundle", async () => {
    const root = await fixtureRepo("stub-run:");
    await runBin(root);

    await writeMarker(root, "edited-run:");
    await writeFile(join(root, "packages", "harness", "src", "pi-web-search.ts"), "export const broken = ;\n", "utf8");
    const started = await runBin(root);

    expect(started.code).toBe(0);
    expect(started.stdout.trim()).toBe("edited-run:hello");
    expect(started.stderr).toContain("prebuilt CLI unavailable");
  });

  it("records a fingerprint that follows the sources it was built from", async () => {
    const root = await fixtureRepo("stub-run:");
    await runBin(root);
    const stamp = join(root, "packages", "cli", "dist", ".fingerprint");
    const recorded = await readFile(stamp, "utf8");

    await writeMarker(root, "edited-run:");
    await utimes(join(root, "packages", "cli", "src", "main.ts"), new Date(), new Date());
    await runBin(root);

    expect(await readFile(stamp, "utf8")).not.toBe(recorded);
  });
});
