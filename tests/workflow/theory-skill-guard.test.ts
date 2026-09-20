import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Static regression guard for the topsop-estimate theory-mode SKILL (2026-08-28).
 *
 * Background: the first setup-env→explore→theory run (20260828T082139-ec8f92)
 * completed but theory exposed two avoidable behaviors:
 *   1. It rebuilt unconditionally (ophal build at cmd 13) even after stat-checking
 *      that setup-env's so was fresh (mtime 13:08 → 16:29, minutes wasted). The
 *      SKILL step 1 said "baseline 构建: ophal build" with no reuse gate.
 *   2. Its first report attempt was rejected: llc_read_bytes/llc_write_bytes were
 *      floats from tcu counters (209808384.0) while the schema requires int; the
 *      repair round rounded them. One extra round-trip that a hint prevents.
 *
 * This file asserts both rules survive future edits. Imports ONLY vitest + node
 * builtins (no @piano/*) to dodge the pre-existing vitest workspace-alias gap.
 * Behavior proof lives in the env-gated e2e style (real theory run on device).
 */
const SKILL_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "recipes",
  "topsop-estimate",
  "skills",
  "topsop-estimate",
  "SKILL.md",
);

describe("topsop-estimate theory-mode SKILL guard", () => {
  let text: string;
  beforeAll(async () => {
    text = await readFile(SKILL_PATH, "utf8");
  });

  it("reuses setup-env's fresh build creds instead of rebuilding unconditionally", () => {
    // Without this gate theory wastes minutes re-building a so setup-env already
    // certified fresh, and the rebuild may differ due to uncommitted workspace edits.
    expect(text).toMatch(/直接复用|不重建/);
    expect(text).toMatch(/禁止无条件重编/);
    expect(text).toMatch(/缺失或过期/);
  });

  it("rounds llc byte counters to int before reporting", () => {
    // Schema requires z.number().int(); tcu counters come back as floats and a
    // raw pass is rejected, costing an extra repair round.
    expect(text).toMatch(/必须取整为 int/);
    expect(text).toMatch(/llc_read_bytes/);
  });
});

describe("topsop-estimate hardware-constant reference guard (ISSUE-015)", () => {
  let text: string;
  beforeAll(async () => {
    text = await readFile(SKILL_PATH, "utf8");
  });

  it("references the injected hardware constants table instead of searching", () => {
    expect(text).toMatch(/硬件常量引用（ISSUE-015）/);
    expect(text).toMatch(/hardware_constants/);
    expect(text).toMatch(/禁止全盘搜索硬件定义/);
  });

  it("carries the concrete constants and the per-op kMaxDLen derivation rule", () => {
    expect(text).toMatch(/1572864/);
    expect(text).toMatch(/QA 512B \/ DA 256B \/ VA 128B/);
    expect(text).toMatch(/kMaxDLen/);
    expect(text).toMatch(/per-operator/);
  });
});
