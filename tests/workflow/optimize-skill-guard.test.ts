import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Static regression guard for the topsop-optimize SKILL's idea/measure-mode
 * discipline (ISSUE-014 / ISSUE-015 / ISSUE-018).
 *
 * - ISSUE-014 (premise recheck): after a structural change the previous round
 *   may have invalidated old premise judgments ("read rate is a hard ceiling",
 *   "compute is not the bottleneck"); idea mode must recheck them and write the
 *   conclusion into `rechecked_premises`. The proposal contract enforces
 *   `strategies[].variable_type = "structural"` ⇒ rechecked_premises present;
 *   this file locks the SKILL text that drives that behavior.
 * - ISSUE-015 (hardware constants): idea mode must use the injected
 *   `hardware_constants` table instead of searching the filesystem for
 *   compiler-injected macros (observed `find /` accident in
 *   run 20260830T112927-928828).
 * - ISSUE-018 (external mechanism candidates): a mechanism verified by an
 *   official/reference implementation but absent from the current source must
 *   become the first candidate (mechanism-over-config), not a config variant.
 *
 * Imports ONLY vitest + node builtins (no @piano/*) so it runs under vitest
 * despite the workspace-alias resolution gap that keeps other suites from loading.
 */
const SKILL_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "recipes",
  "topsop-optimize",
  "skills",
  "topsop-optimize",
  "SKILL.md",
);

describe("topsop-optimize SKILL premise-recheck guard (ISSUE-014)", () => {
  let text: string;
  beforeAll(async () => {
    text = await readFile(SKILL_PATH, "utf8");
  });

  it("keeps the premise-recheck step in idea mode", () => {
    // A structural round must recheck old premise judgments and write the
    // conclusion into the proposal; the contract rejects structural rounds that
    // omit rechecked_premises.
    expect(text).toMatch(/前提失效检查（ISSUE-014）/);
    expect(text).toMatch(/rechecked_premises/);
    expect(text).toMatch(/旧判别/);
    expect(text).toMatch(/某路径是硬上限|计算非瓶颈|读速率饱和/);
  });

  it("marks the proposed variable as structural / config", () => {
    // variable_type drives both the round-result injection context and the
    // contract's structural-round requirement.
    expect(text).toMatch(/strategies\[\]\.variable_type/);
    expect(text).toMatch(/structural/);
    expect(text).toMatch(/config/);
  });

  it("does not trigger on consecutive config rounds", () => {
    expect(text).toMatch(/无结构改动的连续 config 轮不触发/);
  });

  it("threads variable_type from the proposal into the round result for the next idea", () => {
    // measure mode fills round-result.variable_type so the next round's idea
    // knows whether the previous variable was structural.
    expect(text).toMatch(/variable_type/);
    expect(text).toMatch(/下一轮 idea/);
  });
});

describe("topsop-optimize SKILL hardware-constant guard (ISSUE-015)", () => {
  let text: string;
  beforeAll(async () => {
    text = await readFile(SKILL_PATH, "utf8");
  });

  it("references the injected hardware constants table instead of searching", () => {
    expect(text).toMatch(/hardware_constants/);
    expect(text).toMatch(/禁止全盘搜索硬件定义/);
    expect(text).toMatch(/GCU_VDMEM_SIZE_PER_THREAD/);
  });

  it("derives kMaxDLen from the target kernel source, not from a manual", () => {
    expect(text).toMatch(/kMaxDLen/);
    expect(text).toMatch(/per-operator/);
    expect(text).toMatch(/kMaxDUnit|AlignDown/);
  });
});

describe("topsop-optimize SKILL external-mechanism guard (ISSUE-018)", () => {
  let text: string;
  beforeAll(async () => {
    text = await readFile(SKILL_PATH, "utf8");
  });

  it("promotes a verified-but-absent mechanism to the first candidate", () => {
    expect(text).toMatch(/external_mechanism_candidates/);
    expect(text).toMatch(/present_in_source/);
    expect(text).toMatch(/第一(个)?候选/);
    expect(text).toMatch(/只当可达性参考|不读官方 diff|不复制其机制/);
  });
});
