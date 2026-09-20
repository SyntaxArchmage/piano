import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Static regression guard for the topsop-explore SKILL manifest paths and
 * convergence boundaries (2026-08-28).
 *
 * Background: the first explore solo run timed out at 600s because the SKILL
 * step 1 listed device-kernel paths that do not exist in this topsop checkout
 * (`topsop/lib/kernel/cc_kernel/<op>/` — no `lib/kernel` here, and `lib/cc_kernel/`
 * holds only shared headers). The agent burned 7-8 bash calls locating the
 * kernel and 10+ chasing the compiler-builtin macro GCU_VDMEM_SIZE_PER_THREAD.
 * The fix (a) corrected the manifest to the real layout — kernel compile units
 * live next to their host in `lib/op/<域>/<op>/gcu400/*.tops`, build target from
 * `op_add_library(kernel_<target> ...)`, device-host externs in
 * `lib/cc_kernel/cc_host.h` — and (b) added explicit convergence boundaries so
 * explore stops at report-grade evidence instead of deep-diving.
 *
 * This file asserts both survive future edits. It imports ONLY vitest + node
 * builtins (no @piano/*) so it runs despite the pre-existing vitest
 * workspace-alias resolution gap. Behavior proof lives in the env-gated e2e
 * style of setup-env-config-guard.e2e.test.ts (a real explore run: see
 * docs/topsop-tuning/v1/topsop-setup-env-config-guard.md for the pattern).
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

describe("topsop-explore SKILL manifest paths & convergence guard", () => {
  let text: string;
  beforeAll(async () => {
    text = await readFile(SKILL_PATH, "utf8");
  });

  it("points at the real kernel layout, not the nonexistent generic path", () => {
    // The stale `topsop/lib/kernel/cc_kernel/<op>/` (and `topsop/lib/ops/`)
    // path made the agent hunt for a directory that does not exist here.
    expect(text).not.toMatch(/topsop\/lib\/kernel\/cc_kernel/);
    expect(text).not.toMatch(/topsop\/lib\/ops/);
    // Real layout: compile units live next to the host in gcu400/.
    expect(text).toMatch(/gcu400/);
    expect(text).toMatch(/op_add_library\(kernel_<target> \.\.\.\)/);
    expect(text).toMatch(/lib\/cc_kernel\/cc_host\.h/);
  });

  it("keeps the convergence boundaries that stop explore from deep-diving", () => {
    // Without these, explore burns wall-clock on compiler-builtin macros and
    // variant diffs (the two causes of the 600s timeout).
    expect(text).toMatch(/不溯源编译器内置宏/);
    expect(text).toMatch(/GCU_VDMEM_SIZE_PER_THREAD/);
    expect(text).toMatch(/不对比实现变体/);
    expect(text).toMatch(/从 `lib\/op\/` 域目录起搜/);
  });
});
