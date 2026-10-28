import { describe, expect, it } from "vitest";
import { createLangfuseExport } from "../src/sink.js";
import { shutdownLangfuse } from "../src/runtime.js";

/** Every turn ends by flushing the export — through `LangfuseExport.flush` on
 * the mission's port and on the side agent's own hook. A turn must not fail
 * because export is absent, already shut down, or broken: a flush gap is an
 * evidence gap, never a run failure. */
describe("LangfuseExport.flush", () => {
  it("resolves when no export runtime is running", async () => {
    const exported = await createLangfuseExport("run-flush-1");
    await expect(exported.flush()).resolves.toBeUndefined();
  });

  it("stays a no-op after shutdown", async () => {
    const exported = await createLangfuseExport("run-flush-2");
    await shutdownLangfuse();
    await expect(exported.flush()).resolves.toBeUndefined();
  });
});

describe("shutdownLangfuse", () => {
  it("is a no-op when no export runtime is running", async () => {
    await expect(shutdownLangfuse()).resolves.toBeUndefined();
  });
});
