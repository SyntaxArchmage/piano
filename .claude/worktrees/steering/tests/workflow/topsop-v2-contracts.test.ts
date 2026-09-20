import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileWorkerContract,
  validateWorkerContract,
} from "../../packages/contract/src/index.js";

const ROOT = process.cwd();
const V2_WORKERS = [
  "topsop-v2-prepare",
  "topsop-v2-characterize",
  "topsop-v2-analyze",
  "topsop-v2-implement",
  "topsop-v2-evaluate",
  "topsop-v2-promote",
  "topsop-v2-summary",
] as const;

async function contractSource(worker: string): Promise<string> {
  return readFile(join(ROOT, "recipes", worker, "contract.json"), "utf8");
}

describe("topsop tuning v2 contracts", () => {
  it.each(V2_WORKERS)("validates the compact %s example", async (worker) => {
    const source = await contractSource(worker);
    const contract = compileWorkerContract(
      source,
      join(ROOT, "recipes", worker, "contract.json"),
    );

    expect(validateWorkerContract(contract, contract.manifest.example).success).toBe(
      true,
    );
    expect(source.length).toBeLessThan(16_000);
    expect(contract.manifest.schema.properties).toEqual(
      expect.objectContaining({
        protocol_version: { const: 2 },
      }),
    );
  });

  it("keeps V2 contract ids globally unique", async () => {
    const recipeEntries = await readdir(join(ROOT, "recipes"), {
      withFileTypes: true,
    });
    const existingIds = new Set<string>();
    const v2Ids = new Map<string, string>();

    for (const entry of recipeEntries) {
      if (!entry.isDirectory()) continue;
      const path = join(ROOT, "recipes", entry.name, "contract.json");
      let raw: string;
      try {
        raw = await readFile(path, "utf8");
      } catch {
        continue;
      }
      const id = (JSON.parse(raw) as { id: string }).id;
      if (entry.name.startsWith("topsop-v2-")) {
        expect(v2Ids.get(id), `duplicate V2 contract id ${id}`).toBeUndefined();
        expect(existingIds.has(id), `V2 contract id collides with V1: ${id}`).toBe(false);
        v2Ids.set(id, entry.name);
      } else {
        existingIds.add(id);
      }
    }

    for (const worker of V2_WORKERS) {
      const contract = JSON.parse(await contractSource(worker)) as { id: string };
      expect(contract.id).toMatch(/^topsop-v2-/);
      expect(v2Ids.get(contract.id)).toBe(worker);
    }
  });

  it("rejects V1 state namespace in prepared workspace", async () => {
    const source = await contractSource("topsop-v2-prepare");
    const contract = compileWorkerContract(source, "topsop-v2-prepare/contract.json");
    const payload = structuredClone(contract.manifest.example) as {
      workspace: { state_namespace: string; state_root: string };
    };
    payload.workspace.state_namespace = "topsop";
    payload.workspace.state_root = "/tmp/.piano/state/topsop/repo/operator/workload";

    expect(validateWorkerContract(contract, payload).success).toBe(false);
  });

  it("keeps the tournament referee optional for serial measured results", async () => {
    const source = await contractSource("topsop-v2-evaluate");
    const contract = compileWorkerContract(source, "topsop-v2-evaluate/contract.json");
    const payload = structuredClone(contract.manifest.example) as Record<string, unknown>;
    delete payload.referee;

    expect(validateWorkerContract(contract, payload).success).toBe(true);
  });

  it("rejects an evaluation that claims an unmatched runtime case passed", async () => {
    const source = await contractSource("topsop-v2-evaluate");
    const contract = compileWorkerContract(source, "topsop-v2-evaluate/contract.json");
    const payload = structuredClone(contract.manifest.example) as {
      correctness: {
        cases: Array<{ runtime_identity_matched: boolean }>;
      };
    };
    payload.correctness.cases[0]!.runtime_identity_matched = false;

    expect(validateWorkerContract(contract, payload).success).toBe(false);
  });

  it("allows summary to truthfully complete an upstream block", async () => {
    const source = await contractSource("topsop-v2-summary");
    const contract = compileWorkerContract(source, "topsop-v2-summary/contract.json");
    const payload = {
      protocol_version: 2,
      status: "completed",
      outcome: "blocked",
      rounds: { scheduled: 0, attempted: 0, measured: 0, target_measured: 10, replans: 0, kept: 0, discarded: 0, failed: 0 },
      upstream_failure: {
        kind: "device",
        scope: "run",
        retryable: true,
        code: "device_busy",
        message: "GCU400 is occupied",
        next_action: "retry later",
      },
      cleanup: {
        lease_release_attempted: true,
        lease_released: true,
        workspace_restored: true,
        issues: [],
      },
      next_action: "retry when a device is available",
    };

    expect(validateWorkerContract(contract, payload).success).toBe(true);
  });
});
