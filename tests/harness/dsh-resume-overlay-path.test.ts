import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  dshResumeOverlayPath,
  dshResumeRunnerPath,
  prepareHarnessHomes,
} from "../../packages/harness/src/index.js";

describe("dsh resume overlay module resolution", () => {
  it("resolves the relative plugin name to the generated resume runner", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-dsh-resume-overlay-"));
    try {
      const homes = await Effect.runPromise(prepareHarnessHomes({ rootDir: root, models: [] }));
      const overlayPath = dshResumeOverlayPath(homes.paths.dsh);
      const overlay = await readFile(overlayPath, "utf8");
      const moduleName = /^\s+name:\s+(\S+)\s*$/mu.exec(overlay)?.[1];

      // dsh resolves a patch row's `name` against the directory the patch file
      // sits in, so the overlay climbs from `patches/` back to the runner under
      // the headless profile — where the runner's bare dsh imports resolve.
      expect(moduleName).toBe("../profiles/headless/resume-runner.mjs");
      const resolvedModulePath = resolve(dirname(overlayPath), moduleName!);
      expect(dshResumeRunnerPath(homes.paths.dsh)).toBe(resolvedModulePath);
      expect(await readFile(resolvedModulePath, "utf8")).toContain("agents.resume");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
