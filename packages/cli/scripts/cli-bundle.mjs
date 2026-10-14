// Build and freshness support for the prebuilt CLI bundle.
/* global process, Buffer */
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
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, from this file at <root>/packages/cli/scripts/. */
export const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
/** Bundle output directory. `dist/` is ignored by git. */
export const defaultDistDir = join(defaultRoot, "packages", "cli", "dist");

/** Everything published beside the stamp. A dist missing any of these is not
 * usable, so `isBundleFresh` requires all of them: the sidecars are loaded by
 * other processes, and a bundle without them fails far from here. */
const ARTIFACT_NAMES = [
  "piano.js",
  "pi-web-search.js",
  "dsh-resume-runner.mjs",
];
const STAMP_NAME = ".fingerprint";
const STAGING_PREFIX = ".staging-";

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
    if (!entry.isDirectory()) continue;
    await walk(join(root, "packages", entry.name, "src"), inputs);
    // A workspace manifest decides which file its package's imports resolve to
    // — an `exports` remap changes the bundle without touching any source — so
    // it is an input of the build even though esbuild never inlines it.
    inputs.push(join(root, "packages", entry.name, "package.json"));
  }
  inputs.push(...extraInputs(root));
  return inputs.sort();
}

/** Path and content of every input, as one string. Contents rather than
 * timestamps: a copy that preserves mtime still changes the bytes, and an edit
 * reverted before the next start changes nothing at all. */
export async function fingerprint(root = defaultRoot) {
  const inputs = await collectInputs(root);
  const hash = createHash("sha256");
  for (const path of inputs) {
    hash.update(`${relative(root, path)}\n`);
    hash.update(await readFile(path).catch(() => Buffer.alloc(0)));
  }
  return hash.digest("hex");
}

/** True when every artifact is present and the stamp was built from exactly
 * these sources. */
export async function isBundleFresh(distDir = defaultDistDir, root = defaultRoot) {
  const recorded = await readFile(join(distDir, STAMP_NAME), "utf8").catch(() => undefined);
  if (recorded === undefined) return false;
  const present = await Promise.all(ARTIFACT_NAMES.map((name) => readFile(join(distDir, name)).then(() => true, () => false)));
  if (present.includes(false)) return false;
  return recorded.trim() === await fingerprint(root);
}

/** Drop the stamp without touching the artifacts, so the next start rebuilds.
 * The caller uses this when a fresh stamp sits over artifacts that do not
 * start: the stamp is what would otherwise keep them trusted forever. */
export async function invalidateBundle(distDir = defaultDistDir) {
  await rm(join(distDir, STAMP_NAME), { force: true });
}

/** Leftover staging directories from a build that was killed mid-flight. */
async function sweepStaging(distDir) {
  const entries = await readdir(distDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries
    .filter((entry) => entry.name.startsWith(STAGING_PREFIX))
    .map((entry) => rm(join(distDir, entry.name), { recursive: true, force: true })));
}

/** The three files the bundle needs beside it: the second entry that pi-cli
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
  await cp(join(root, "packages", "harness", "src", "dsh-resume-runner.mjs"), join(staging, "dsh-resume-runner.mjs"));
}

/** Build the bundle and the fingerprint that goes with it. Files land through a
 * staging directory and a rename, so a concurrent `piano` never reads a
 * half-written bundle.
 *
 * Two processes can reach this at the same time. They read the same sources and
 * publish the same bytes, so the only cost is one wasted build; the stamp is
 * renamed last, so a process killed mid-publish leaves a stamp that fails the
 * fingerprint check and triggers a rebuild rather than a dist trusted with
 * mixed artifacts. */
export async function buildBundle(distDir = defaultDistDir, root = defaultRoot) {
  // Fingerprinted before esbuild reads anything. The other order would let a
  // save that lands during the build — after esbuild read that file, before
  // the stamp is written — be recorded as fresh over a bundle that missed it.
  // This order's failure is one wasted rebuild.
  const stamp = await fingerprint(root);
  const staging = join(distDir, `${STAGING_PREFIX}${process.pid}`);
  // Swept before staging exists, so the sweep cannot take our own directory:
  // it removes what a killed build left behind.
  await sweepStaging(distDir);
  await mkdir(staging, { recursive: true });
  try {
    await buildInto(staging, root);
    await writeFile(join(staging, STAMP_NAME), stamp);
    for (const name of [...ARTIFACT_NAMES, STAMP_NAME]) {
      await rename(join(staging, name), join(distDir, name));
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return join(distDir, "piano.js");
}
