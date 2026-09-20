import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PINNED_KDS_COMMIT = "36c559d465ac7636678e094ccf512cfc5ff61bbe";
const workers = [
  "prepare",
  "characterize",
  "analyze",
  "implement",
  "evaluate",
  "promote",
  "summary",
] as const;
const knowledgeWorkers = [...workers, "tournament-partition"] as const;

interface ImportDocument {
  readonly architecture: string;
  readonly capability: string;
  readonly source_path: string;
  readonly destination_path: string;
  readonly sha256: string;
}

interface ImportManifest {
  readonly source: { readonly commit: string; readonly tracked_root: string };
  readonly policy: {
    readonly activation: string;
    readonly excluded: readonly string[];
  };
  readonly documents: readonly ImportDocument[];
}

interface StageRoute {
  readonly allowed_primary_domains: readonly string[];
  readonly allowed_auxiliary_domains: readonly string[];
  readonly max_primary_domains: number;
  readonly max_auxiliary_domains: number;
  readonly historical_optimization_policy: string;
}

interface RoutingManifest {
  readonly architecture: string;
  readonly corpus_root: string;
  readonly source: { readonly commit: string };
  readonly metadata_files: readonly string[];
  readonly selection_rule: string;
  readonly stages: Readonly<Record<string, StageRoute>>;
}

async function skillNames(worker: string): Promise<string[]> {
  return (
    await readdir(join(ROOT, `recipes/topsop-v2-${worker}/skills`), {
      withFileTypes: true,
    })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(join(ROOT, path), "utf8")) as T;
}

function sha256(content: Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

describe("topsop tuning v2 knowledge routing", () => {
  it.each(knowledgeWorkers)("gives %s local command, evidence, and knowledge routing", async (worker) => {
    const names = await skillNames(worker);
    expect(names).toContain("topsop-v2-command-safety");
    expect(names).toContain("topsop-v2-evidence-protocol");
    expect(names).toContain("topsop-v2-knowledge-router");
    expect(names).not.toContain("topsop-v2-gcu400-knowledge");

    const agents = await readFile(
      join(ROOT, `recipes/topsop-v2-${worker}/agents.md`),
      "utf8",
    );
    expect(agents).toContain("Piano 已注入的 workflow-local skills");
    expect(agents).toContain("禁止调用 `skill` 工具按名称加载");
    expect(agents).toContain("topsop-v2-command-safety");
    expect(agents).toContain("topsop-v2-evidence-protocol");
    expect(agents).toContain("topsop-v2-knowledge-router");
    expect(agents).toContain("canonical shared corpus");
    expect(agents).toContain("正式 schema/projection 校验由 Piano orchestrator");

    const evidence = await readFile(
      join(
        ROOT,
        `recipes/topsop-v2-${worker}/skills/topsop-v2-evidence-protocol/SKILL.md`,
      ),
      "utf8",
    );
    expect(evidence).toContain("写出最终 `result.json` 后立即返回");
    expect(evidence).toContain("不得运行 JSON Schema");
    expect(evidence).toContain("显式声明并校验过的 V2 durable state path");
    expect(evidence).toContain("禁止搜索其他 run 或枚举 state root");
  });

  it("restores one pinned canonical GCU400 corpus and verifies every imported digest", async () => {
    const manifest = await readJson<ImportManifest>(
      "recipes/shared-skills/topsop-gcu400-import-manifest.json",
    );
    const catalog = await readJson<{
      readonly architecture: string;
      readonly source_commit: string;
      readonly domains: readonly { readonly id: string }[];
    }>("recipes/shared-skills/topsop-gcu400-catalog.json");
    const hardware = await readJson<{ readonly architecture: string }>(
      "recipes/shared-skills/topsop-gcu400-foundation/hardware/gcu400-v1.json",
    );

    expect(manifest.source).toEqual({
      repository: "kerneldevsuite",
      commit: PINNED_KDS_COMMIT,
      tracked_root: "skills/gcu400",
    });
    expect(manifest.policy.activation).toContain("topsop-v2-knowledge-router");
    expect(manifest.policy.activation).toContain("no Piano shared-capability loader");
    expect(manifest.documents).toHaveLength(98);
    expect(catalog.architecture).toBe("GCU400");
    expect(catalog.source_commit).toBe(PINNED_KDS_COMMIT);
    expect(hardware.architecture).toBe("GCU400");
    expect(catalog.domains.map((domain) => domain.id)).toEqual([
      "compute-flow",
      "compute",
      "dataflow",
      "scalar",
      "dte",
      "ldst",
      "assembly",
      "perf-estimation",
      "optimization",
      "debug",
      "testing",
      "review",
    ]);

    for (const document of manifest.documents) {
      expect(document.architecture).toBe("GCU400");
      expect(document.source_path).toMatch(/^skills\/gcu400\//);
      expect(document.destination_path).toMatch(
        /^recipes\/shared-skills\/topsop-gcu400-(foundation|performance|validation)\//,
      );
      expect(sha256(await readFile(join(ROOT, document.destination_path)))).toBe(
        document.sha256,
      );
    }
  });

  it.each(knowledgeWorkers)("keeps %s routing local and progressively disclosed", async (worker) => {
    const routerRoot = join(
      ROOT,
      `recipes/topsop-v2-${worker}/skills/topsop-v2-knowledge-router`,
    );
    const entries = await readdir(routerRoot);
    const router = await readFile(join(routerRoot, "SKILL.md"), "utf8");

    expect(entries).toEqual(["SKILL.md"]);
    expect(router).toContain(`knowledge router: ${worker}`);
    expect(router).toContain("../../../shared-skills");
    expect(router).toContain("../../../topsop-v2-knowledge-routing.json");
    expect(router).toContain(PINNED_KDS_COMMIT);
    expect(router).toContain("1 个 primary domain");
    expect(router).toContain("1 个 auxiliary domain");
    expect(router).toContain("禁止递归读取、批量拼接、全文扫描整个 corpus");
    expect(router).toContain("不能证明当前 kernel 已实现");

    await expect(
      readdir(
        join(
          ROOT,
          `recipes/topsop-v2-${worker}/skills/topsop-v2-gcu400-knowledge`,
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("enforces a stage allowlist and keeps historical cases out of measurement authority", async () => {
    const routing = await readJson<RoutingManifest>(
      "recipes/topsop-v2-knowledge-routing.json",
    );

    expect(routing.architecture).toBe("GCU400");
    expect(routing.corpus_root).toBe("recipes/shared-skills");
    expect(routing.source.commit).toBe(PINNED_KDS_COMMIT);
    expect(routing.metadata_files).toEqual([
      "recipes/shared-skills/topsop-gcu400-catalog.json",
      "recipes/shared-skills/topsop-gcu400-import-manifest.json",
      "recipes/shared-skills/topsop-gcu400-foundation/hardware/gcu400-v1.json",
    ]);
    expect(routing.selection_rule).toContain("one primary domain");
    expect(Object.keys(routing.stages).sort()).toEqual([...knowledgeWorkers].sort());

    for (const route of Object.values(routing.stages)) {
      expect(route.max_primary_domains).toBe(1);
      expect(route.max_auxiliary_domains).toBeLessThanOrEqual(1);
      expect(route.allowed_primary_domains.length).toBeGreaterThan(0);
      for (const domain of [
        ...route.allowed_primary_domains,
        ...route.allowed_auxiliary_domains,
      ]) {
        expect(domain).toMatch(
          /^topsop-(gcu400-(foundation|performance|validation)|operator-evidence)\//,
        );
      }
    }

    const route = (stage: string): StageRoute => {
      const value = routing.stages[stage];
      expect(value).toBeDefined();
      if (value === undefined) throw new Error(`missing route for ${stage}`);
      return value;
    };
    expect(route("analyze").allowed_auxiliary_domains).toContain(
      "topsop-gcu400-performance/optimization",
    );
    expect(route("analyze").historical_optimization_policy).toContain(
      "hypothesis-only",
    );
    expect(route("tournament-partition").historical_optimization_policy).toContain(
      "cannot prove current applicability, speedup, or KEEP",
    );
    for (const stage of ["characterize", "implement", "evaluate"] as const) {
      expect(route(stage).allowed_primary_domains).not.toContain(
        "topsop-gcu400-performance/optimization",
      );
      expect(route(stage).allowed_auxiliary_domains).not.toContain(
        "topsop-gcu400-performance/optimization",
      );
      expect(route(stage).historical_optimization_policy).toContain("forbidden");
    }
    for (const stage of ["promote", "summary"] as const) {
      expect(route(stage).allowed_primary_domains).toEqual([
        "topsop-operator-evidence/operator-local",
      ]);
      expect(route(stage).allowed_auxiliary_domains).toEqual([]);
    }
  });

  it("uses V2 stage ownership in operator-local evidence", async () => {
    const protocol = await readFile(
      join(
        ROOT,
        "recipes/shared-skills/topsop-operator-evidence/document/operator-local-evidence-protocol.md",
      ),
      "utf8",
    );
    for (const stage of knowledgeWorkers) {
      expect(protocol).toContain(stage);
    }
    expect(protocol).not.toContain("setup-env records");
    expect(protocol).not.toContain("explore discovers");
    expect(protocol).not.toContain("profile and measure reuse");
    expect(protocol).not.toContain("topsop-final-summary.progress_record.record");
    expect(protocol).toContain("A human-visible progress note is optional");
  });

  it("bounds preparation discovery to current-run source evidence", async () => {
    const [agents, skill] = await Promise.all([
      readFile(join(ROOT, "recipes/topsop-v2-prepare/agents.md"), "utf8"),
      readFile(
        join(
          ROOT,
          "recipes/topsop-v2-prepare/skills/topsop-v2-prepare/SKILL.md",
        ),
        "utf8",
      ),
    ]);

    for (const text of [agents, skill]) {
      expect(text).toContain("V1 recipes");
      expect(text).toContain("其他 run");
      expect(text).toContain("Git 全分支历史");
      expect(text).toContain("12 个");
    }
  });

  it("documents one closed durable continuation protocol instead of case rules", async () => {
    const [design, prepare, characterize, promote] = await Promise.all([
      readFile(join(ROOT, "docs/topsop-tuning/v2/topsop-tuning-v2-design.md"), "utf8"),
      readFile(
        join(ROOT, "recipes/topsop-v2-prepare/skills/topsop-v2-prepare/SKILL.md"),
        "utf8",
      ),
      readFile(
        join(
          ROOT,
          "recipes/topsop-v2-characterize/skills/topsop-v2-characterize/SKILL.md",
        ),
        "utf8",
      ),
      readFile(
        join(ROOT, "recipes/topsop-v2-promote/skills/topsop-v2-promote/SKILL.md"),
        "utf8",
      ),
    ]);

    expect(design).toContain("Major change 1: durable session continuation");
    expect(design).toContain("absent");
    expect(design).toContain("present and strictly compatible");
    expect(design).toContain("durable_state_incompatible");
    expect(design).toContain("adds no Piano package API");
    expect(design).toContain("one document source of truth plus lightweight routers");
    expect(prepare).toContain("source_commit == HEAD");
    expect(prepare).toContain("不得自动删除、迁移、checkout、合并或降级为 fresh");
    expect(characterize).toContain("禁止把历史 `.so`、timing、profile 或 correctness");
    expect(promote).toContain("state_schema_version=1");
    expect(promote).toContain("不可变 snapshot");
  });

  it("compresses characterization into fixed device command batches", async () => {
    const [agents, skill] = await Promise.all([
      readFile(join(ROOT, "recipes/topsop-v2-characterize/agents.md"), "utf8"),
      readFile(
        join(
          ROOT,
          "recipes/topsop-v2-characterize/skills/topsop-v2-characterize/SKILL.md",
        ),
        "utf8",
      ),
    ]);

    for (const text of [agents, skill]) {
      expect(text).toContain("correctness");
      expect(text).toContain("timing");
      expect(text).toContain("metrics/VPD");
    }
    expect(agents).toContain("禁止查看 prepare transcript");
    expect(skill).toContain("不自行运行 contract validator");
  });

  it("accepts cumulative improvements only above the frozen noise-aware floor", async () => {
    const [characterize, evaluate, promote] = await Promise.all([
      readFile(join(ROOT, "recipes/topsop-v2-characterize/skills/topsop-v2-characterize/SKILL.md"), "utf8"),
      readFile(join(ROOT, "recipes/topsop-v2-evaluate/skills/topsop-v2-evaluate/SKILL.md"), "utf8"),
      readFile(join(ROOT, "recipes/topsop-v2-promote/skills/topsop-v2-promote/SKILL.md"), "utf8"),
    ]);

    for (const text of [characterize, evaluate, promote]) {
      expect(text).toContain("max(0.5%×");
      expect(text).toContain("3×MAD");
    }
    expect(evaluate).toContain("comparison_base");
    expect(evaluate).toContain("可以累积");
  });

  it("keeps source-provenance capability local to workers that inspect or edit source", async () => {
    for (const worker of ["prepare", "analyze", "implement"]) {
      expect(await skillNames(worker)).toContain("topsop-v2-source-evidence");
    }
    for (const worker of ["characterize", "evaluate", "promote", "summary"]) {
      expect(await skillNames(worker)).not.toContain("topsop-v2-source-evidence");
    }
  });

  it("loads validation procedure only where candidate safety is decided", async () => {
    expect(await skillNames("implement")).toContain("topsop-v2-validation");
    expect(await skillNames("evaluate")).toContain("topsop-v2-validation");
    for (const worker of ["prepare", "characterize", "analyze", "promote", "summary"]) {
      expect(await skillNames(worker)).not.toContain("topsop-v2-validation");
    }
  });

  it("documents plan-conformance and target-evidence gates at their owning stages", async () => {
    const [analyze, implement, evaluate, promote, summary] = await Promise.all([
      readFile(join(ROOT, "recipes/topsop-v2-analyze/agents.md"), "utf8"),
      readFile(join(ROOT, "recipes/topsop-v2-implement/agents.md"), "utf8"),
      readFile(join(ROOT, "recipes/topsop-v2-evaluate/agents.md"), "utf8"),
      readFile(join(ROOT, "recipes/topsop-v2-promote/agents.md"), "utf8"),
      readFile(join(ROOT, "recipes/topsop-v2-summary/agents.md"), "utf8"),
    ]);

    expect(analyze).toContain("implementation_constraints");
    expect(implement).toContain("candidate_plan_mismatch");
    expect(implement).toContain("plan_conformance");
    expect(evaluate).toContain("target_metrics_unavailable");
    expect(evaluate).toContain("每一个目标指标");
    expect(promote).toContain("target_validation");
    expect(promote).toContain("不能仅凭 latency 提升提交");
    expect(summary).toContain("final_target_validation");
  });

  it("uses one canonical workspace identity implementation across V2 workers", async () => {
    const helper = await readFile(
      join(ROOT, "recipes/topsop-v2-workspace-identity.py"),
      "utf8",
    );
    expect(helper).toContain('ALGORITHM = "topsop-v2-workspace-manifest-v1"');
    expect(helper).toContain('git_bytes(root, "diff", "HEAD")');
    expect(helper).toContain('"ls-files", "--others", "--exclude-standard", "-z"');

    const stateIdentityWorkers = [
      "prepare",
      "characterize",
      "implement",
      "promote",
      "summary",
    ] as const;
    const protocols = await Promise.all(
      stateIdentityWorkers.map((worker) =>
        readFile(
          join(
            ROOT,
            `recipes/topsop-v2-${worker}/skills/topsop-v2-evidence-protocol/SKILL.md`,
          ),
          "utf8",
        ),
      ),
    );
    expect(new Set(protocols).size).toBe(1);
    for (const protocol of protocols) {
      expect(protocol).toContain("topsop-v2-workspace-identity.py");
      expect(protocol).toContain("topsop-v2-workspace-manifest-v1");
      expect(protocol).toContain("不得把 `tracked_diff_sha256` 当作 workspace digest");
      expect(protocol).toContain("不得枚举历史算法");
    }

    const [prepare, characterize, implement, promote, summary] = await Promise.all([
      readFile(join(ROOT, "recipes/topsop-v2-prepare/agents.md"), "utf8"),
      readFile(join(ROOT, "recipes/topsop-v2-characterize/agents.md"), "utf8"),
      readFile(join(ROOT, "recipes/topsop-v2-implement/agents.md"), "utf8"),
      readFile(join(ROOT, "recipes/topsop-v2-promote/agents.md"), "utf8"),
      readFile(join(ROOT, "recipes/topsop-v2-summary/agents.md"), "utf8"),
    ]);
    expect(prepare).toContain("只调用一次");
    expect(prepare).toContain("禁止把其 `tracked_diff_sha256` 直接与 state 比较");
    for (const stage of [characterize, implement, promote, summary]) {
      expect(stage).toContain("topsop-v2-workspace-identity.py");
    }
  });

  it("documents bounded fast paths for pre-loop durable-state blocks", async () => {
    const files = {
      prepareAgents: await readFile(
        join(ROOT, "recipes/topsop-v2-prepare/agents.md"),
        "utf8",
      ),
      prepareSkill: await readFile(
        join(ROOT, "recipes/topsop-v2-prepare/skills/topsop-v2-prepare/SKILL.md"),
        "utf8",
      ),
      prepareRouter: await readFile(
        join(
          ROOT,
          "recipes/topsop-v2-prepare/skills/topsop-v2-knowledge-router/SKILL.md",
        ),
        "utf8",
      ),
      characterizeSkill: await readFile(
        join(
          ROOT,
          "recipes/topsop-v2-characterize/skills/topsop-v2-characterize/SKILL.md",
        ),
        "utf8",
      ),
      characterizeRouter: await readFile(
        join(
          ROOT,
          "recipes/topsop-v2-characterize/skills/topsop-v2-knowledge-router/SKILL.md",
        ),
        "utf8",
      ),
      summarySkill: await readFile(
        join(ROOT, "recipes/topsop-v2-summary/skills/topsop-v2-summary/SKILL.md"),
        "utf8",
      ),
      summaryRouter: await readFile(
        join(
          ROOT,
          "recipes/topsop-v2-summary/skills/topsop-v2-knowledge-router/SKILL.md",
        ),
        "utf8",
      ),
    };

    expect(files.prepareAgents).toContain("durable-state fail-fast");
    expect(files.prepareSkill).toContain("最多 4 个有界 tool batches");
    expect(files.prepareSkill).toContain("不得打开 knowledge routing manifest");
    expect(files.prepareRouter).toContain("本 router 立即停用");

    expect(files.characterizeSkill).toContain("Upstream-blocked fast path");
    expect(files.characterizeSkill).toContain("最多 3 个有界 tool batches");
    expect(files.characterizeSkill).toContain("保留原始 `failure.kind/scope/retryable/code/message/next_action`");
    expect(files.characterizeRouter).toContain("characterize 只传播上游 failure");

    expect(files.summarySkill).toContain("Pre-loop blocked fast path");
    expect(files.summarySkill).toContain("scheduled=attempted=measured=replans=kept=discarded=failed=0");
    expect(files.summarySkill).toContain("`result.json` 是最后一次写操作");
    expect(files.summaryRouter).toContain("summary 只传播 accepted upstream failure");
  });

});
