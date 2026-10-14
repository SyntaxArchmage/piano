#!/usr/bin/env node
/* global process, URL */
// Start path for the CLI. A bundle built from exactly these sources starts
// without transpiling anything; anything else is rebuilt first, and a rebuild
// that cannot happen at all — a source tree mid-edit, a missing bundler — falls
// back to running the TypeScript sources through tsx, which is what this bin
// did before the bundle existed.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBundle, isBundleFresh } from "../scripts/cli-bundle.mjs";

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));
const bundlePath = join(distDir, "piano.js");

/** The bundle's `runCli`, or undefined when it could not be produced. */
async function loadBundle() {
  if (!(await isBundleFresh(distDir))) await buildBundle(distDir);
  const loaded = await import(bundlePath);
  return typeof loaded.runCli === "function" ? loaded : undefined;
}

let cli;
try {
  cli = await loadBundle();
} catch (cause) {
  process.stderr.write(
    `piano: prebuilt CLI unavailable (${cause instanceof Error ? cause.message : String(cause)}); running from sources\n`,
  );
  cli = undefined;
}
if (cli === undefined) {
  await import("tsx/esm");
  cli = await import("../src/main.ts");
}
cli.runCli(process.argv.slice(2));
