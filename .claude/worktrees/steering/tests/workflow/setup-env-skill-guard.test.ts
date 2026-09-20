import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Static regression guard for the setup-env worker's OPHAL config-resolution
 * trap (2026-08-28).
 *
 * Background: the setup-env stage is launched with a shared workspace whose
 * cwd is the piano repo root, not the injected topsop workspace. `ophal`
 * resolves its config by walking up from cwd, so the first
 * `ophal device --status` call from the wrong directory falls back to the
 * kit-builtin xiaomeng.zhao config (test_host root@10.12.115.72 + permission
 * errors on that config's home paths).
 * The SKILL.md step 2 guard mandates running ophal from the injected workspace
 * path (`cd <workspace> && ophal ...`, or with OPHAL_CONFIG set) so the FIRST
 * ophal call is already correct.
 *
 * This file asserts the guard stays in the skill text. It deliberately imports
 * ONLY vitest + node builtins (no @piano/* workspace packages) so it runs under
 * vitest even while the workspace-alias resolution gap keeps other workflow
 * suites from loading. The real agent-behavior proof lives in the env-gated
 * e2e case: setup-env-config-guard.e2e.test.ts.
 */
const SKILL_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "recipes",
  "topsop-setup-env",
  "skills",
  "topsop-setup-env",
  "SKILL.md",
);

describe("setup-env SKILL config-resolution guard", () => {
  let text: string;
  beforeAll(async () => {
    text = await readFile(SKILL_PATH, "utf8");
  });

  it("mandates running ophal from the topsop repo or with OPHAL_CONFIG", () => {
    // The guard must survive edits: without it, the first ophal call from the
    // piano workspace falls into the kit-builtin config trap.
    expect(text).toMatch(/OPHAL_CONFIG/);
    expect(text).toMatch(/<workspace>\/ophal_config\.json/);
    expect(text).toMatch(/从注入的 workspace 目录运行|cd <workspace> && ophal/);
  });

  it("keeps the trap evidence so future editors see why the guard exists", () => {
    // Wrong-test-host symptom and stale config owner are the observable marks
    // of the trap; deleting them silently weakens the rationale.
    expect(text).toMatch(/xiaomeng/);
    expect(text).toMatch(/root@10\.12\.115\.72/);
    expect(text).toMatch(/wsj@10\.12\.115\.153/);
  });

  it("keeps the config-resolution priority so the mechanism is documented", () => {
    expect(text).toMatch(/config_path > OPHAL_CONFIG > cwd 向上查找/);
  });
});
