import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileWorkerContract, validateWorkerContract } from "../../packages/contract/src/index.js";

/** The paper workflow's two prose stages may not finish with a manuscript that
 * does not build: the loop's remaining rounds all write into that tree, so a
 * broken build discovered at the end has already spent the whole budget. The
 * guard is an `x-piano-assertions` rule on `compiles`, with a `blocked` escape
 * hatch for a tree that genuinely cannot be fixed from here — without which an
 * unbounded retry policy would loop on it forever. These cases pin both halves
 * down, because a guard that only rejects is a deadlock and one that only
 * accepts is decoration. */
const PROSE_CONTRACTS = ["paper-write", "paper-revise"] as const;

async function loadContract(worker: string) {
  const path = join(process.cwd(), "recipes", worker, "contract.json");
  return compileWorkerContract(await readFile(path, "utf8"), path);
}

/** A payload that satisfies everything except the field under test, built from
 * the contract's own accepted example so it cannot drift from the schema. */
async function examplePayload(worker: string, patch: Record<string, unknown>) {
  const compiled = await loadContract(worker);
  const example = (compiled.manifest as unknown as { example: Record<string, unknown> }).example;
  return { ...example, ...patch };
}

/** `ContractValidationError` does not serialize its message, so read the field
 * rather than stringifying the result. */
function rejectionReason(result: unknown): string {
  const error = (result as { error?: { message?: string } }).error;
  return error?.message ?? JSON.stringify(result);
}

describe("paper prose contracts refuse an unbuildable manuscript", () => {
  it.each(PROSE_CONTRACTS)("accepts the accepted example for %s", async (worker) => {
    const compiled = await loadContract(worker);
    const result = validateWorkerContract(compiled, await examplePayload(worker, {}));
    expect(result.success, result.success ? "" : JSON.stringify(result.error)).toBe(true);
  });

  it.each(PROSE_CONTRACTS)("rejects compiles: false in %s", async (worker) => {
    const compiled = await loadContract(worker);
    const result = validateWorkerContract(
      compiled,
      await examplePayload(worker, { compiles: false }),
    );
    expect(result.success).toBe(false);
    expect(rejectionReason(result)).toContain("compiles must be true");
  });

  it.each(PROSE_CONTRACTS)("lets %s stop the loop with a real blocker", async (worker) => {
    const compiled = await loadContract(worker);
    // The escape hatch has to be reachable, or an unbuildable tree retries
    // forever under `attempts: unbounded`.
    const accepted = validateWorkerContract(compiled, await examplePayload(worker, {
      compiles: false,
      status: "blocked",
      build_blocker: "main.tex:41 — the acmart class file is missing from the tree and is not ours to add.",
    }));
    expect(accepted.success, accepted.success ? "" : JSON.stringify(accepted.error)).toBe(true);

    // …but only with the blocker named: "blocked" must not become a way to
    // skip the compile and still finish normally.
    const unexplained = validateWorkerContract(compiled, await examplePayload(worker, {
      compiles: false,
      status: "blocked",
    }));
    expect(unexplained.success).toBe(false);

    // And a claimed blocker with a working build is not a legal exit either,
    // because it would stop the loop on a manuscript that was fine — the most
    // expensive mistake available here, since a spurious block ends the run.
    const needless = validateWorkerContract(compiled, await examplePayload(worker, {
      compiles: true,
      status: "blocked",
      build_blocker: "the build actually succeeded; this blocker is not real.",
    }));
    expect(needless.success, "compiles: true with status blocked must not be an accepted exit").toBe(false);
    expect(rejectionReason(needless)).toContain("must report compiles: false");
  });

  it.each(PROSE_CONTRACTS)("projects %s's status so the engine can stop the loop", async (worker) => {
    const compiled = await loadContract(worker);
    // The engine reads the `workflow.status` projection to decide a loop round
    // is terminal; a `blocked` result with no projection would be accepted and
    // the loop would carry on regardless.
    expect(compiled.manifest.outputs.projections.map((projection) => projection.id)).toContain(
      "workflow.status",
    );
  });
});
