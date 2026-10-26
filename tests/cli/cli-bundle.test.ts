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
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  // Retries because a killed child may still be finishing a write in dist.
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

async function fixtureRepo(marker: string, suffix = ""): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), "piano-cli-bundle-")), suffix);
  roots.push(root);
  await mkdir(join(root, "packages", "cli", "src"), { recursive: true });
  await mkdir(join(root, "packages", "cli", "bin"), { recursive: true });
  await mkdir(join(root, "packages", "cli", "scripts"), { recursive: true });
  await mkdir(join(root, "packages", "harness", "src"), { recursive: true });
  await cp(join(repoRoot, "packages", "cli", "bin", "piano.mjs"), join(root, "packages", "cli", "bin", "piano.mjs"));
  await cp(join(repoRoot, "packages", "cli", "scripts", "cli-bundle.mjs"), join(root, "packages", "cli", "scripts", "cli-bundle.mjs"));
  await cp(join(repoRoot, "packages", "dashboard", "server"), join(root, "packages", "dashboard", "server"), { recursive: true });
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

const distOf = (root: string) => join(root, "packages", "cli", "dist");
const bundleOf = (root: string) => join(distOf(root), "piano.js");

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
  const code = await new Promise<number | null>((resolve) => {
    // A build that hangs must not leave a writer behind that outlives the test
    // and breaks the cleanup below.
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(null); }, 30_000);
    child.on("close", (value) => { clearTimeout(timer); resolve(value); });
  });
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
    for (const name of [
      "piano.js",
      "pi-web-search.js",
      "dsh-resume-runner.mjs",
      "piano-dashboard.mjs",
      "public/index.html",
      "public/app.js",
      "public/style.css",
      ".fingerprint",
    ]) {
      await expect(stat(join(distOf(root), name))).resolves.toBeTruthy();
    }
  });

  it("reuses the bundle while the sources are unchanged", async () => {
    const root = await fixtureRepo("stub-run:");
    await runBin(root);
    const built = await mtime(bundleOf(root));

    const started = await runBin(root);

    expect(started.stdout.trim()).toBe("stub-run:hello");
    expect(await mtime(bundleOf(root))).toBe(built);
  });

  it("keeps the bundle when a file is touched but its contents are unchanged", async () => {
    const root = await fixtureRepo("stub-run:");
    await runBin(root);
    const built = await mtime(bundleOf(root));

    const touched = join(root, "packages", "cli", "src", "main.ts");
    await utimes(touched, new Date(), new Date());
    const started = await runBin(root);

    expect(started.stdout.trim()).toBe("stub-run:hello");
    expect(await mtime(bundleOf(root))).toBe(built);
  });

  it("picks up an edited source without a reinstall, rebuilding first", async () => {
    const root = await fixtureRepo("stub-run:");
    await runBin(root);
    const built = await mtime(bundleOf(root));

    await writeMarker(root, "edited-run:");
    const started = await runBin(root);

    expect(started.stdout.trim()).toBe("edited-run:hello");
    expect(await mtime(bundleOf(root))).toBeGreaterThan(built);
  });

  it("rebuilds when a workspace manifest changes, even with no source edited", async () => {
    const root = await fixtureRepo("stub-run:");
    const manifest = join(root, "packages", "harness", "package.json");
    await writeFile(manifest, "{ \"name\": \"stub\" }\n", "utf8");
    await runBin(root);
    const built = await mtime(bundleOf(root));

    await writeFile(manifest, "{ \"name\": \"stub\", \"version\": \"2\" }\n", "utf8");
    const started = await runBin(root);

    expect(started.stdout.trim()).toBe("stub-run:hello");
    expect(await mtime(bundleOf(root))).toBeGreaterThan(built);
  });

  it("rebuilds when an artifact is missing, rather than trusting the stamp", async () => {
    const root = await fixtureRepo("stub-run:");
    await runBin(root);
    const sidecar = join(distOf(root), "pi-web-search.js");
    await rm(sidecar, { force: true });

    const started = await runBin(root);

    expect(started.stdout.trim()).toBe("stub-run:hello");
    expect(started.stderr).toBe("");
    expect(existsSync(sidecar)).toBe(true);
  });

  it("rebuilds over an artifact that cannot start, and says nothing when it recovers", async () => {
    const root = await fixtureRepo("stub-run:");
    await runBin(root);
    await writeFile(bundleOf(root), "", "utf8");

    const started = await runBin(root);

    expect(started.stdout.trim()).toBe("stub-run:hello");
    expect(started.stderr).toBe("");
    expect(await readFile(bundleOf(root), "utf8")).not.toBe("");
  });

  it("sweeps staging directories left by a killed build", async () => {
    const root = await fixtureRepo("stub-run:");
    await runBin(root);
    const leftover = join(distOf(root), ".staging-999999");
    await mkdir(leftover, { recursive: true });

    // A rebuild is what sweeps, so the run has to find the bundle stale.
    await writeMarker(root, "edited-run:");
    await runBin(root);

    expect(existsSync(leftover)).toBe(false);
  });

  it("starts from a checkout path that needs URL encoding", async () => {
    const root = await fixtureRepo("stub-run:", "pi#ano");

    const started = await runBin(root);

    expect(started.stdout.trim()).toBe("stub-run:hello");
    expect(started.stderr).toBe("");
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

  it("runs from sources when the build module itself cannot be loaded", async () => {
    const root = await fixtureRepo("stub-run:");
    await writeFile(join(root, "packages", "cli", "scripts", "cli-bundle.mjs"), "export const half = {\n", "utf8");

    const started = await runBin(root);

    expect(started.code).toBe(0);
    expect(started.stdout.trim()).toBe("stub-run:hello");
    expect(started.stderr).toContain("prebuilt CLI unavailable");
  });

  it("records a fingerprint that follows the sources it was built from", async () => {
    const root = await fixtureRepo("stub-run:");
    await runBin(root);
    const stamp = join(distOf(root), ".fingerprint");
    const recorded = await readFile(stamp, "utf8");

    await writeMarker(root, "edited-run:");
    await runBin(root);

    expect(await readFile(stamp, "utf8")).not.toBe(recorded);
  });
});
