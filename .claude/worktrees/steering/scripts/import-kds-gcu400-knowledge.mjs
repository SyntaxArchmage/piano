#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const recipesRoot = join(repositoryRoot, "recipes", "shared-skills");
const manifestPath = join(recipesRoot, "topsop-gcu400-import-manifest.json");
const catalogPath = join(recipesRoot, "topsop-gcu400-catalog.json");

const imports = [
  { sourceSkill: "gcu400-compute-flow", capability: "topsop-gcu400-foundation", domain: "compute-flow", keywords: ["host-api", "runtime", "dispatch", "topscc", "execution-model"] },
  { sourceSkill: "gcu400-compute", capability: "topsop-gcu400-foundation", domain: "compute", keywords: ["1d", "2d", "oacc", "gemm", "l0p5", "vector"] },
  { sourceSkill: "gcu400-dataflow", capability: "topsop-gcu400-foundation", domain: "dataflow", keywords: ["pipeline", "sub-thread", "buffering", "mailbox", "fusion", "resource-budget"], includeSkill: true },
  { sourceSkill: "gcu400-compute-scalar", capability: "topsop-gcu400-foundation", domain: "scalar", keywords: ["salu", "sldst", "branch", "stack", "sdmem", "scalar"], includeSkill: true },
  { sourceSkill: "gcu400-dte", capability: "topsop-gcu400-foundation", domain: "dte", keywords: ["dte", "hwsync", "fence", "mailbox", "address-space"] },
  { sourceSkill: "gcu400-compute-ldst", capability: "topsop-gcu400-foundation", domain: "ldst", keywords: ["load-store", "alignment", "specifier", "tar", "vdmem"] },
  { sourceSkill: "gcu400-compute-assembly", capability: "topsop-gcu400-foundation", domain: "assembly", keywords: ["isa4", "vliw", "csr", "pipeline", "codegen"] },
  { sourceSkill: "gcu400-perf-estimation", capability: "topsop-gcu400-performance", domain: "perf-estimation", keywords: ["roofline", "bound", "profile", "latency", "bandwidth", "utilization"] },
  {
    sourceSkill: "gcu400-perf-optimization",
    capability: "topsop-gcu400-performance",
    domain: "optimization",
    keywords: ["historical-case", "bottleneck-signature", "attention", "gemm", "reduction", "moe", "topk", "data-movement"],
    documents: [
      "optimization_report_index.md",
      "gcu400_deep_dive_01_flash_attn_varlen_fp8_prefill_192_causal.md",
      "gcu400_deep_dive_14_matmul_quant_fp8_l2_general_pipeline.md",
      "gcu400_deep_dive_19_moe_align_block_size.md",
      "gcu400_deep_dive_25_fused_add_rms_norm_fp8.md",
      "gcu400_deep_dive_28_top_k_renorm_probs.md",
      "gcu400_deep_dive_108_index_put_gcu400_manual.md",
    ],
    retrievalProfiles: [
      { id: "attention", signatures: ["attention", "mla", "kv cache", "softmax", "causal", "prefill"], documents: ["gcu400_deep_dive_01_flash_attn_varlen_fp8_prefill_192_causal.md"] },
      { id: "gemm", signatures: ["gemm", "matmul", "fp8", "l2 pipeline", "quant"], documents: ["gcu400_deep_dive_14_matmul_quant_fp8_l2_general_pipeline.md"] },
      { id: "elementwise-reduction", signatures: ["elementwise", "reduction", "rmsnorm", "norm", "fused add"], documents: ["gcu400_deep_dive_25_fused_add_rms_norm_fp8.md"] },
      { id: "moe-routing", signatures: ["moe", "expert routing", "align block", "token routing", "histogram"], documents: ["gcu400_deep_dive_19_moe_align_block_size.md"] },
      { id: "topk", signatures: ["topk", "top-k", "renorm", "probability", "selection"], documents: ["gcu400_deep_dive_28_top_k_renorm_probs.md"] },
      { id: "data-movement", signatures: ["data movement", "gather", "scatter", "index_put", "indexed write"], documents: ["gcu400_deep_dive_108_index_put_gcu400_manual.md"] },
    ],
  },
  { sourceSkill: "gcu400-debug", capability: "topsop-gcu400-validation", domain: "debug", keywords: ["mismatch", "hang", "reset", "sanitizer", "driver", "probe"] },
  { sourceSkill: "gcu400-testing", capability: "topsop-gcu400-validation", domain: "testing", keywords: ["correctness", "boundary", "dtype", "dispatch", "sanitizer", "regression"], includeSkill: true },
  { sourceSkill: "gcu400-code-review", capability: "topsop-gcu400-validation", domain: "review", keywords: ["review", "host-device", "alignment", "budget", "dte-lifecycle", "synchronization", "numeric"], includeDirectories: ["checklist"] },
];

function usage() {
  console.error("usage: node scripts/import-kds-gcu400-knowledge.mjs --source <kerneldevsuite> [--check]");
  process.exit(2);
}

const args = process.argv.slice(2);
let sourceRoot;
let check = false;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--source") sourceRoot = resolve(args[++index] ?? "");
  else if (args[index] === "--check") check = true;
  else usage();
}
if (!sourceRoot) usage();

function git(...gitArgs) {
  return execFileSync("git", ["-C", sourceRoot, ...gitArgs], { encoding: "utf8" }).trim();
}

function sha256(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function titleOf(content, fallback) {
  const text = content.toString("utf8");
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallback;
}

function documentKind(fileName, domain) {
  if (fileName === "SKILL.md") return "upstream-skill";
  if (fileName === "optimization_report_index.md") return "optimization-index";
  if (domain === "review") return "review-checklist";
  if (fileName.startsWith("gcu400_deep_dive_")) return "historical-case-study";
  if (fileName === "source_materials_index.md") return "upstream-source-index";
  if (fileName.startsWith("meeting_") || fileName.startsWith("report_")) return "internal-report";
  if (/reference|_ref|specification|_spec|guide/.test(fileName)) return "reference-or-spec";
  return "derived-reference";
}

function fileKeywords(config, fileName, title) {
  const tokens = `${fileName.replace(/\.md$/, "")} ${title}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
  return [...new Set([...config.keywords, ...tokens])].sort();
}

function sourceFiles(config) {
  const skillRoot = `skills/gcu400/${config.sourceSkill}`;
  const prefix = `${skillRoot}/document/`;
  const trackedDocuments = execFileSync("git", ["-C", sourceRoot, "ls-files", "-z", `${prefix}*.md`])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const trackedSet = new Set(trackedDocuments);
  const documents = config.documents === undefined
    ? trackedDocuments.filter((path) => basename(path) !== "image_catalog.md")
    : config.documents.map((fileName) => `${prefix}${fileName}`);
  for (const directory of config.includeDirectories ?? []) {
    documents.push(...execFileSync("git", ["-C", sourceRoot, "ls-files", "-z", `${skillRoot}/${directory}/*.md`])
      .toString("utf8")
      .split("\0")
      .filter(Boolean));
  }
  for (const sourcePath of documents) {
    if (!trackedSet.has(sourcePath) && !sourcePath.startsWith(`${skillRoot}/checklist/`)) {
      throw new Error(`allowlisted document is not tracked: ${sourcePath}`);
    }
  }
  if (config.includeSkill === true) documents.push(`${skillRoot}/SKILL.md`);
  return [...new Set(documents)].sort();
}

function inside(root, path) {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

const sourceCommit = git("rev-parse", "HEAD");
const trackedChanges = git("status", "--porcelain", "--untracked-files=no");
if (trackedChanges !== "") throw new Error("KDS source has tracked changes; commit or revert them before importing a pinned snapshot");

const generated = [];
for (const config of imports) {
  const destinationRoot = join(recipesRoot, config.capability, "document", config.domain);
  if (!check) {
    if (!inside(recipesRoot, destinationRoot)) throw new Error(`unsafe destination: ${destinationRoot}`);
    rmSync(destinationRoot, { recursive: true, force: true });
    mkdirSync(destinationRoot, { recursive: true });
  }
  for (const sourcePath of sourceFiles(config)) {
    const skillRoot = `skills/gcu400/${config.sourceSkill}`;
    if (!(sourcePath === `${skillRoot}/SKILL.md` || (sourcePath.startsWith(`${skillRoot}/`) && sourcePath.endsWith(".md")))) {
      throw new Error(`non-GCU400 source escaped allowlist: ${sourcePath}`);
    }
    const content = readFileSync(join(sourceRoot, sourcePath));
    const destinationName = basename(sourcePath) === "SKILL.md" ? "upstream-skill.md" : basename(sourcePath).toLowerCase();
    const destinationPath = `recipes/shared-skills/${config.capability}/document/${config.domain}/${destinationName}`;
    if (!check) writeFileSync(join(repositoryRoot, destinationPath), content);
    generated.push({
      architecture: "GCU400",
      capability: config.capability,
      domain: config.domain,
      kind: documentKind(basename(sourcePath), config.domain),
      source_path: sourcePath,
      destination_path: destinationPath,
      bytes: content.byteLength,
      sha256: sha256(content),
      title: titleOf(content, basename(sourcePath)),
      keywords: fileKeywords(config, basename(sourcePath), titleOf(content, basename(sourcePath))),
    });
  }
}

generated.sort((left, right) => left.destination_path.localeCompare(right.destination_path));

const manifest = {
  version: 1,
  architecture: "GCU400",
  source: {
    repository: "kerneldevsuite",
    commit: sourceCommit,
    tracked_root: "skills/gcu400",
  },
  policy: {
    activation: "on-demand through workflow-local topsop-v2-knowledge-router skills and recipes/topsop-v2-knowledge-routing.json; no Piano shared-capability loader",
    authority_order: ["current workspace source", "current tool output", "pinned imported reference", "historical report"],
    included_domains: imports.map(({ sourceSkill, capability, domain }) => ({ source_skill: sourceSkill, capability, domain })),
    excluded: ["GCU300-only skills and documents", "communication-only skills", "image assets", "unselected gcu400-perf-optimization documents"],
  },
  documents: generated,
};

const domains = imports.map((config) => {
  const documents = generated
    .filter((entry) => entry.capability === config.capability && entry.domain === config.domain)
    .map(({ destination_path, kind, title, keywords, sha256 }) => ({ path: destination_path, kind, title, keywords, sha256 }));
  return {
    id: config.domain,
    architecture: "GCU400",
    capability: config.capability,
    upstream_skill: config.sourceSkill,
    keywords: config.keywords,
    documents,
  };
});
const retrievalProfiles = imports.flatMap((config) => (config.retrievalProfiles ?? []).map((profile) => ({
  id: profile.id,
  architecture: "GCU400",
  capability: config.capability,
  domain: config.domain,
  signatures: profile.signatures,
  documents: profile.documents.map((fileName) => `document/${config.domain}/${fileName}`),
})));
const catalog = {
  version: 1,
  architecture: "GCU400",
  source_commit: sourceCommit,
  selection_rule: "Choose one primary domain and at most one auxiliary domain; open only documents needed for the current claim.",
  retrieval_profiles: retrievalProfiles,
  domains,
};

function indexText(capability) {
  const selected = domains.filter((domain) => domain.capability === capability);
  const lines = [
    `# ${capability} document index`,
    "",
    `Pinned source: kerneldevsuite commit \`${sourceCommit}\`.`,
    "",
    "Current workspace source and current tool output override these imported references. Read one primary domain and at most one auxiliary domain. Historical case studies are hypothesis sources, not proof of current implementation or speedup; images and unselected optimization documents remain excluded.",
    "",
  ];
  for (const domain of selected) {
    lines.push(`## ${domain.id}`, "", `Keywords: ${domain.keywords.map((value) => `\`${value}\``).join(", ")}.`, "");
    for (const document of domain.documents) {
      const localPath = relative(join(recipesRoot, capability, "document"), join(repositoryRoot, document.path)).split(sep).join("/");
      lines.push(`- [${document.title}](${localPath}) — ${document.kind}; \`${document.sha256}\``);
    }
    const profiles = retrievalProfiles.filter((profile) => profile.capability === capability && profile.domain === domain.id);
    if (profiles.length > 0) {
      lines.push("", "### Bottleneck-signature routing", "");
      for (const profile of profiles) {
        const links = profile.documents.map((documentPath) => {
          const document = domain.documents.find((entry) => entry.path.endsWith(`/${documentPath}`));
          if (document === undefined) throw new Error(`retrieval profile references an unimported document: ${documentPath}`);
          const localPath = relative(join(recipesRoot, capability, "document"), join(recipesRoot, capability, documentPath)).split(sep).join("/");
          return `[${document.title}](${localPath})`;
        });
        lines.push(`- \`${profile.id}\` — signatures: ${profile.signatures.map((value) => `\`${value}\``).join(", ")}; open ${links.join(", ")}.`);
      }
    }
    lines.push("");
  }
  while (lines.at(-1) === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

if (check) {
  const existingManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const existingCatalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  if (JSON.stringify(existingManifest) !== JSON.stringify(manifest)) throw new Error("import manifest differs from the pinned KDS source");
  if (JSON.stringify(existingCatalog) !== JSON.stringify(catalog)) throw new Error("catalog differs from the pinned KDS source");
  for (const entry of generated) {
    const destination = readFileSync(join(repositoryRoot, entry.destination_path));
    if (sha256(destination) !== entry.sha256) throw new Error(`snapshot checksum mismatch: ${entry.destination_path}`);
  }
  for (const capability of [...new Set(imports.map((entry) => entry.capability))]) {
    if (readFileSync(join(recipesRoot, capability, "document", "INDEX.md"), "utf8") !== indexText(capability)) {
      throw new Error(`generated index differs: ${capability}`);
    }
  }
  console.log(`verified ${generated.length} GCU400 documents from kerneldevsuite@${sourceCommit}`);
} else {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  for (const capability of [...new Set(imports.map((entry) => entry.capability))]) {
    const path = join(recipesRoot, capability, "document", "INDEX.md");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, indexText(capability));
  }
  console.log(`imported ${generated.length} GCU400 documents from kerneldevsuite@${sourceCommit}`);
}
