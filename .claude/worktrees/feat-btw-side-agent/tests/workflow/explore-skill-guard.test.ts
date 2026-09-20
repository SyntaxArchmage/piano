import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Static regression guard for the topsop-explore command-timeout discipline
 * (ISSUE-013).
 *
 * Background: run 20260829T111032-f0088a's explore stage sent a filesystem-wide
 * `find / -name "topscc_types.h"` that produced no output for 15+ minutes and
 * blocked the run for 21 minutes until the subprocess was killed manually. The
 * SDK's bash tool has NO default timeout (its `timeout` field is optional and
 * unset), so a single runaway explore command has no recovery point. The SKILL
 * already forbade `find /`, but a soft prohibition alone was violated by the
 * agent. The workflow-level `stage.timeout` cap (added in the same ISSUE) is the
 * hard backstop; this file asserts the SKILL's command-level discipline stays in
 * place so normal runs avoid triggering it.
 *
 * Imports ONLY vitest + node builtins (no @piano/*) so it runs under vitest
 * despite the workspace-alias resolution gap that keeps other suites from loading.
 */
const SKILL_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "recipes",
  "topsop-explore",
  "skills",
  "topsop-explore",
  "SKILL.md",
);

describe("topsop-explore command-timeout discipline guard", () => {
  let text: string;
  beforeAll(async () => {
    text = await readFile(SKILL_PATH, "utf8");
  });

  it("mandates an explicit timeout on every explore bash command", () => {
    // The SDK's bash tool has no default timeout; without this the agent's own
    // judgment is the only guard against a `find /` style hang.
    expect(text).toMatch(/timeout <N>s <cmd>/);
    expect(text).toMatch(/任何 bash 命令都要用/);
  });

  it("keeps the find / prohibition and scopes search to the workspace", () => {
    // The runaway command in the observed run was exactly this shape; the
    // prohibition must survive edits alongside the new timeout discipline.
    expect(text).toMatch(/禁止 `find \/`/);
    expect(text).toMatch(/从 `lib\/op\/` 域目录起搜/);
  });

  it("keeps the observed-run evidence so future editors see why the rule exists", () => {
    expect(text).toMatch(/20260829T111032-f0088a/);
    expect(text).toMatch(/topscc_types\.h/);
  });

  it("instructs timeouts to narrow the search instead of re-sending the same wide command", () => {
    expect(text).toMatch(/缩小搜索范围重试/);
    expect(text).toMatch(/不重复发同款全盘命令/);
  });
});

describe("topsop-explore hardware-constant discipline guard (ISSUE-015)", () => {
  let text: string;
  beforeAll(async () => {
    text = await readFile(SKILL_PATH, "utf8");
  });

  it("outputs hardware_constants with source paths instead of searching for definitions", () => {
    // idea agent grepped the whole filesystem for VDMEM macros in
    // run 20260830T112927-928828; the explore report must carry the constants +
    // their authoritative source paths so downstream stages never search.
    expect(text).toMatch(/hardware_constants/);
    expect(text).toMatch(/sources/);
    expect(text).toMatch(/禁止全盘搜索硬件定义/);
    expect(text).toMatch(/GCU_VDMEM_SIZE_PER_THREAD/);
  });

  it("carries the concrete constant values in the return report", () => {
    expect(text).toMatch(/1572864|1\.5MB/);
    expect(text).toMatch(/64MB\/DIE/);
    expect(text).toMatch(/512B \/ DA 256B \/ VA 128B|QA 512B/);
  });
});

describe("topsop-explore external-mechanism guard (ISSUE-018)", () => {
  let text: string;
  beforeAll(async () => {
    text = await readFile(SKILL_PATH, "utf8");
  });

  it("explicitly explores same-family DTE transfer strategies and emits candidates", () => {
    // The official block-shared local DTE gamma move (eb8b65cc5e, 2776 GB/s) is a
    // cross-layer structure piano never considered; explore must scan that axis.
    expect(text).toMatch(/external_mechanism_candidates/);
    expect(text).toMatch(/present_in_source/);
    expect(text).toMatch(/同类算子的 DTE 搬移策略/);
    expect(text).toMatch(/block-shared local DTE/);
  });

  it("treats external mechanisms as reachability references, not copyable diffs", () => {
    expect(text).toMatch(/只当可达性参考/);
    expect(text).toMatch(/不读官方 diff/);
    expect(text).toMatch(/不复制机制/);
  });
});
