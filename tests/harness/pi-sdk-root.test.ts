// `PIANO_PI_SDK_ROOT` is the explicit deployment override for the in-process
// pi SDK location. It must drive discovery directly (no `npm root -g`) and
// keep every check the default path applies, including the version floor.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { piAvailable } from "../../packages/harness/src/index.js";

const originalRoot = process.env.PIANO_PI_SDK_ROOT;
const originalPrefix = process.env.npm_config_prefix;

beforeEach(() => {
  delete process.env.PIANO_PI_SDK_ROOT;
  delete process.env.npm_config_prefix;
});

afterEach(() => {
  if (originalRoot === undefined) delete process.env.PIANO_PI_SDK_ROOT;
  else process.env.PIANO_PI_SDK_ROOT = originalRoot;
  if (originalPrefix === undefined) delete process.env.npm_config_prefix;
  else process.env.npm_config_prefix = originalPrefix;
});

async function writeSdkAt(dir: string, version: string, withEntry = true): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ version }));
  if (withEntry) {
    await mkdir(join(dir, "dist"), { recursive: true });
    await writeFile(join(dir, "dist", "index.js"), "export {};\n");
  }
}

async function sdkDirectory(version: string, withEntry = true): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "piano-pi-sdk-root-"));
  await writeSdkAt(root, version, withEntry);
  return root;
}

describe("PIANO_PI_SDK_ROOT", () => {
  it("derives the global module root without spawning npm", async () => {
    const prefix = await mkdtemp(join(tmpdir(), "piano-pi-prefix-"));
    const modules = process.platform === "win32"
      ? join(prefix, "node_modules")
      : join(prefix, "lib", "node_modules");
    const sdk = join(modules, "@earendil-works", "pi-coding-agent");
    try {
      await writeSdkAt(sdk, "0.99.0");
      process.env.npm_config_prefix = prefix;
      expect(await Effect.runPromise(piAvailable())).toBe(true);
    } finally {
      await rm(prefix, { recursive: true, force: true });
    }
  });

  it("uses the explicit root and applies the same availability checks", async () => {
    const modern = await sdkDirectory("0.99.0");
    const old = await sdkDirectory("0.10.0");
    const missingEntry = await sdkDirectory("0.99.0", false);
    try {
      process.env.PIANO_PI_SDK_ROOT = modern;
      expect(await Effect.runPromise(piAvailable())).toBe(true);
      // A root below the version floor is not usable.
      process.env.PIANO_PI_SDK_ROOT = old;
      expect(await Effect.runPromise(piAvailable())).toBe(false);
      // Nor is one without the SDK entry point.
      process.env.PIANO_PI_SDK_ROOT = missingEntry;
      expect(await Effect.runPromise(piAvailable())).toBe(false);
      // Nor is a path that does not exist.
      process.env.PIANO_PI_SDK_ROOT = join(modern, "missing");
      expect(await Effect.runPromise(piAvailable())).toBe(false);
    } finally {
      await rm(modern, { recursive: true, force: true });
      await rm(old, { recursive: true, force: true });
      await rm(missingEntry, { recursive: true, force: true });
    }
  });
});
