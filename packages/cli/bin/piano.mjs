#!/usr/bin/env node
/* global process, URL */
// Start path for the CLI. A bundle built from exactly these sources starts
// without transpiling anything; anything else is rebuilt first, and a rebuild
// that cannot happen at all — a source tree mid-edit, a missing bundler — falls
// back to running the TypeScript sources through tsx, which is what this bin
// did before the bundle existed.
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));
const bundlePath = join(distDir, "piano.js");

function noteFallback(detail) {
  process.stderr.write(
    `piano: prebuilt CLI unavailable${detail === undefined ? "" : ` (${detail})`}; running from sources\n`,
  );
}

/** The bundle's `runCli`, or undefined when it cannot be started at all.
 * `tag` makes a retry a different module URL, because the registry keeps the
 * failed or empty module imported a moment ago under the plain one. */
async function loadBundle(tag = "") {
  try {
    const loaded = await import(`${pathToFileURL(bundlePath).href}${tag}`);
    return typeof loaded.runCli === "function" ? loaded : undefined;
  } catch {
    return undefined;
  }
}

let cli;
try {
  // Imported inside the try rather than at the top: a build module that is
  // missing or saved half-written must not kill the launcher while its imports
  // are being linked, because the fallback below is what runs in that case.
  const { buildBundle, invalidateBundle, isBundleFresh } = await import("../scripts/cli-bundle.mjs");
  if (await isBundleFresh(distDir)) {
    cli = await loadBundle();
    // A matching stamp over artifacts that do not start means the dist is
    // damaged, not outdated. Dropping the stamp is what lets the rebuild below
    // happen; without it every later start would trust the same broken file.
    if (cli === undefined) await invalidateBundle(distDir);
  }
  if (cli === undefined) {
    await buildBundle(distDir);
    cli = await loadBundle(`?rebuilt=${Date.now()}`);
  }
  if (cli === undefined) noteFallback("the prebuilt bundle did not start");
} catch (cause) {
  noteFallback(cause instanceof Error ? cause.message : String(cause));
  cli = undefined;
}
if (cli === undefined) {
  await import("tsx/esm");
  cli = await import("../src/main.ts");
}
cli.runCli(process.argv.slice(2));
