// `PIANO_PI_SDK_ROOT` is the explicit deployment override for the in-process
// pi SDK location. It must drive discovery directly (no `npm root -g`) and
// keep every check the default path applies, including the version floor.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { piAvailable } from "../../packages/harness/src/index.js";

const original = process.env.PIANO_PI_SDK_ROOT;

beforeEach(() => {
  delete process.env.PIANO_PI_SDK_ROOT;
});

afterEach(() => {
  if (original === undefined) delete process.env.PIANO_PI_SDK_ROOT;
  else process.env.PIANO_PI_SDK_ROOT = original;
});

async function sdkDirectory(version: string, withEntry = true): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "piano-pi-sdk-root-"));
  await writeFile(join(root, "package.json"), JSON.stringify({ version }));
  if (withEntry) {
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "index.js"), "export {};\n");
  }
  return root;
}

describe("PIANO_PI_SDK_ROOT", () => {
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
