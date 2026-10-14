// The bundle built from the real sources, not a fixture.
//
// The fixture tests drive the start path; this one is the gate on the bundle
// itself, because nothing else in the suite would notice if the real module
// graph stopped bundling, or if a sidecar stopped being produced under the name
// its consumer looks for. Both failures are quiet at runtime: the first sends
// every `piano` back through tsx, the second hands pi-cli the whole CLI as an
// extension.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const distDir = join(repoRoot, "packages", "cli", "dist");

function run(command: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, command, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  return new Promise((resolve_) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("close", (code) => { clearTimeout(timer); resolve_({ code, stdout, stderr }); });
  });
}

/** The literal a consumer resolves its sidecar by, read from the consumer. */
async function sidecarLiteral(file: string, pattern: RegExp): Promise<string> {
  const source = await readFile(join(repoRoot, file), "utf8");
  const match = pattern.exec(source);
  expect(match?.[1], `${file} no longer states a sidecar name this test can read`).toBeDefined();
  return match?.[1] ?? "";
}

describe("the bundle built from the real sources", () => {
  it("builds, ships every artifact its consumers load, and starts", async () => {
    const built = await run([join(repoRoot, "packages", "cli", "scripts", "build.mjs")]);
    expect(built.stderr).toBe("");
    expect(built.code).toBe(0);

    for (const name of ["piano.js", "pi-web-search.js", "dsh-resume-runner.mjs", ".fingerprint"]) {
      expect(existsSync(join(distDir, name)), `${name} was not published`).toBe(true);
    }

    // Both sides of each sidecar name: the producer above, the consumer here.
    const webSearch = await sidecarLiteral("packages/harness/src/pi-web-search.ts", /const sidecar = join\(dirname\(self\), "([^"]+)"\)/);
    expect(existsSync(join(distDir, webSearch)), `pi-web-search resolves ${webSearch}, which the build did not publish`).toBe(true);
    const resumeRunner = await sidecarLiteral("packages/harness/src/harness-home.ts", /new URL\("\.\/([^"]+)", import\.meta\.url\)/);
    expect(existsSync(join(distDir, resumeRunner)), `harness-home reads ${resumeRunner}, which the build did not publish`).toBe(true);

    // The bundle finds the repository by walking up from its own location, so
    // it has to sit exactly as deep as the sources it was built from.
    const anchored = resolve(dirname(join(distDir, "piano.js")), "../../../recipes/workflows/coding-pi.yml");
    expect(existsSync(anchored), `the bundle's recipes anchor resolved to ${anchored}`).toBe(true);

    const started = await run([join(repoRoot, "packages", "cli", "bin", "piano.mjs"), "--not-an-option"]);
    expect(started.stderr).toContain("usage: piano");
    // And the bundle, not the tsx fallback, is what answered.
    expect(started.stderr).not.toContain("prebuilt CLI unavailable");
  });
});
