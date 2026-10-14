// Build and freshness support for the prebuilt CLI bundle.
/* global process */
//
// `piano` runs from TypeScript sources through tsx, which re-reads and
// re-transpiles the whole module graph on every process start. Bundling the
// CLI into one JavaScript file removes that cost, but the bundle is only valid
// for the sources it was built from. The fingerprint below is how the bin
// knows: the build records it, and every start recomputes it. A bundle whose
// fingerprint no longer matches is rebuilt before use, so editing a source file
// and running `piano` again takes effect without any reinstall step.

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, from this file at <root>/packages/cli/scripts/. */
export const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
/** Bundle output directory. `dist/` is ignored by git. */
export const defaultDistDir = join(defaultRoot, "packages", "cli", "dist");

const BUNDLE_NAME = "piano.js";
const WEB_SEARCH_SIDECAR_NAME = "pi-web-search.js";
const DSH_RUNNER_NAME = "dsh-resume-runner.mjs";
const STAMP_NAME = ".fingerprint";

/** Files the bundle is built from beyond the sources under each package's src
 * directory: the lock file, because dependencies are inlined, and these build
 * scripts, because they decide the bundle's shape. */
function extraInputs(root) {
  return [
    join(root, "package-lock.json"),
    join(root, "packages", "cli", "scripts", "cli-bundle.mjs"),
    join(root, "packages", "cli", "scripts", "build.mjs"),
  ];
}

async function walk(directory, into) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path, into);
    } else if (entry.isFile()) {
      into.push(path);
    }
  }
}

/** Every file that goes into the bundle, as absolute paths. */
export async function collectInputs(root = defaultRoot) {
  const packages = await readdir(join(root, "packages"), { withFileTypes: true }).catch(() => []);
  const inputs = [];
  for (const entry of packages) {
    if (entry.isDirectory()) await walk(join(root, "packages", entry.name, "src"), inputs);
  }
  inputs.push(...extraInputs(root));
  return inputs.sort();
}

/** Path, mtime and size of every input, as one string. Sizes and mtimes catch
 * an edit; the file list itself catches an addition or deletion. */
export async function fingerprint(root = defaultRoot) {
  const inputs = await collectInputs(root);
  const parts = [];
  for (const path of inputs) {
    const info = await stat(path).catch(() => undefined);
    parts.push(`${relative(root, path)}|${info === undefined ? "missing" : info.mtimeMs}|${info?.size ?? 0}`);
  }
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

/** True when a bundle exists and was built from exactly these sources. */
export async function isBundleFresh(distDir = defaultDistDir, root = defaultRoot) {
  const recorded = await readFile(join(distDir, STAMP_NAME), "utf8").catch(() => undefined);
  if (recorded === undefined) return false;
  if (await stat(join(distDir, BUNDLE_NAME)).catch(() => undefined) === undefined) return false;
  return recorded.trim() === await fingerprint(root);
}

/** The three artifacts the bundle needs beside it: the second entry that pi-cli
 * loads as an extension, the resume runner `harness-home` reads from its own
 * directory, and the fingerprint the bin compares against. */
async function buildInto(staging, root) {
  // Loaded here rather than at module scope: a fresh start only fingerprints
  // sources, and never pays for the bundler.
  const esbuild = createRequire(import.meta.url)("esbuild");
  await esbuild.build({
    entryPoints: [
      // esbuild appends the `.js` extension itself, so these are bare names.
      { in: join(root, "packages", "cli", "src", "main.ts"), out: "piano" },
      { in: join(root, "packages", "harness", "src", "pi-web-search.ts"), out: "pi-web-search" },
    ],
    outdir: staging,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // Native module: it ships a platform binary and resolves its own .node file.
    external: ["@resvg/resvg-js"],
    // Some bundled dependencies reach for `require` at call time; in an ESM
    // output there is no ambient one, so hand them the real thing.
    banner: { js: "import { createRequire as __pianoCreateRequire } from 'node:module'; const require = __pianoCreateRequire(import.meta.url);" },
    logLevel: "silent",
  });
  await cp(join(root, "packages", "harness", "src", DSH_RUNNER_NAME), join(staging, DSH_RUNNER_NAME));
}

/** Build the bundle and the fingerprint that goes with it. Files land through a
 * staging directory and a rename, so a concurrent `piano` never reads a
 * half-written bundle. */
export async function buildBundle(distDir = defaultDistDir, root = defaultRoot) {
  const staging = join(distDir, `.staging-${process.pid}`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    await buildInto(staging, root);
    await writeFile(join(staging, STAMP_NAME), await fingerprint(root));
    await mkdir(distDir, { recursive: true });
    for (const name of [BUNDLE_NAME, WEB_SEARCH_SIDECAR_NAME, DSH_RUNNER_NAME, STAMP_NAME]) {
      await rename(join(staging, name), join(distDir, name));
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return join(distDir, BUNDLE_NAME);
}
