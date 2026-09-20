import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import { HARNESS_NAMES } from "@piano/harness";
import {
  compileWorkerContract,
  WorkerContractLoadError,
  type CompiledWorkerContract,
} from "@piano/contract";
import { logger, TRACE, type Logging, type Source } from "@piano/logging";
import { WorkflowError, errorMessage, workflowError } from "./errors.js";
import {
  parseWorkflow,
  type WorkflowDocument,
  type WorkflowNode,
  type WorkflowStage,
} from "./workflow.js";

export const defaultRoot = join(homedir(), ".piano");
/** The only workflow state Piano keeps in its root: a JSON object whose
 * "workflow" key records the default workflow — "builtin:<template>" for a
 * shipped template (e.g. "builtin:topsop-tuning") or a path to a user file.
 * The record is created naming the current default when config.json is
 * absent, and named when a legacy config carries no usable key; neither case
 * ever fails a run. Piano never copies or refreshes a workflow.yml into the
 * root, and a user's own workflow files are never touched. */
export const defaultConfigPath = "config.json";
export const recipesDir = "recipes";
/** Builtin default workflow: the source-controlled template loaded directly on
 * a default run, never copied into the user's root. */
export const defaultWorkflowTemplatePath = fileURLToPath(
  new URL("../../../recipes/workflows/topsop-tuning.yml", import.meta.url),
);
/** Installed, source-controlled worker plugin registry. This is deliberately
 * distinct from the target project cwd and from ~/.piano workflow state. */
export const defaultRecipeRepositoryRoot = fileURLToPath(
  new URL("../../../", import.meta.url),
);

export interface LoadedWorkflow {
  readonly root: string;
  readonly workflowPath: string;
  readonly document: WorkflowDocument;
  /** Resources resolved and contracts compiled during load. Optional only for
   * compatibility with callers that construct LoadedWorkflow fixtures. */
  readonly workerResources?: ReadonlyMap<string, WorkerResources>;
  readonly recipeRepositoryRoot?: string;
}

/** Worker-plugin resources. Missing optional files intentionally inherit the
 * configured harness defaults; the worker directory itself is always required. */
export interface WorkerResources {
  readonly systemPromptPath?: string;
  readonly contextFilePaths: readonly string[];
  readonly skillPaths: readonly string[];
  readonly contract?: CompiledWorkerContract;
  /** Default front matter for every stage of this worker; a stage that declares
   * its own `prologue` overrides it. The text is read here rather than left as a
   * path because the engine composes it into prompts itself, unlike
   * `systemPromptPath`, which the harness reads from disk. */
  readonly prologue?: string;
  /** Default back matter for every stage of this worker, overridden the same
   * way `prologue` is. */
  readonly epilogue?: string;
}

/** Read one optional prompt-text resource. An empty file is a mistake worth
 * failing on rather than a silent no-op, which is the rule the stage-level
 * `prologue`/`epilogue` fields already follow. */
function readPromptResource(
  fileSystem: FileSystem.FileSystem,
  workerDir: string,
  name: string,
): Effect.Effect<string | undefined, WorkflowError> {
  return Effect.gen(function* () {
    const path = join(workerDir, name);
    const exists = yield* fileSystem.exists(path).pipe(
      Effect.mapError((cause) => mapFsError(path, cause)),
    );
    if (!exists) return undefined;
    const source = yield* fileSystem.readFileString(path).pipe(
      Effect.mapError((cause) => mapFsError(path, cause)),
    );
    const text = source.trim();
    if (text === "") {
      return yield* Effect.fail(workflowError(
        "load",
        path,
        `${name} is empty; delete the file to inherit no default`,
      ));
    }
    return text;
  });
}

interface SkillDiscovery {
  /** Absolute path to the skill directory (recipes/<worker>/skills/<name>). */
  readonly dir: string;
  readonly name: string;
  readonly description: string;
}

function inside(parent: string, child: string): boolean {
  const childRelative = relative(parent, child);
  return childRelative === "" || (!childRelative.startsWith("..") && !isAbsolute(childRelative));
}

function mapFsError(path: string, cause: unknown): WorkflowError {
  return workflowError("load", path, errorMessage(cause));
}

const PARSE_SOURCE: Source = {
  module: "orchestrator",
  file: "workflow.ts",
  function: "parseWorkflow",
};

function workflowStages(nodes: readonly WorkflowNode[]): readonly WorkflowStage[] {
  return nodes.flatMap((node) => "stage" in node
    ? [node.stage]
    : workflowStages("loop" in node ? node.loop.nodes : node.tournament.nodes));
}

function warnLegacyValidation(
  workflowPath: string,
  stages: readonly WorkflowStage[],
): void {
  const legacyStages = stages.filter(
    (stage): stage is WorkflowStage & { readonly validate: string } =>
      typeof stage.validate === "string",
  );
  if (legacyStages.length === 0) return;
  const usages = legacyStages
    .map((stage) => `stage "${stage.name}" (${stage.validate})`)
    .join(", ");
  process.emitWarning(
    `Workflow "${workflowPath}" uses deprecated string-valued validation at ${usages}. ` +
      "Move each schema to recipes/<worker>/contract.json and use validate: true; " +
      "legacy named contracts will be removed in a future release.",
    {
      code: "PIANO_LEGACY_WORKER_CONTRACT",
      type: "DeprecationWarning",
    },
  );
}

export function workerResourcesKey(worker: string, harness: string): string {
  return `${worker}\u0000${harness}`;
}

/** Validate a skill name per the Agent Skills spec: lowercase letters, digits,
 * hyphens, non-empty. */
function validateSkillName(value: unknown, path: string): Effect.Effect<string, WorkflowError> {
  if (typeof value !== "string" || value.trim() === "") {
    return Effect.fail(workflowError("load", path, "skill name must be a non-empty string"));
  }
  const name = value.trim();
  if (!/^[a-z0-9-]+$/.test(name)) {
    return Effect.fail(workflowError("load", path, `skill name "${name}" must use only lowercase letters, digits, and hyphens`));
  }
  return Effect.succeed(name);
}

/** An `agents.<harness>.md` file must name a known harness: an unknown suffix
 * fails the load with the legal names, mirroring the strict worker/skill name
 * validation above. */
function harnessAppendixPath(
  workerDir: string,
  harness: string,
  absoluteWorkflowPath: string,
): Effect.Effect<string | undefined, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const appendixFiles: string[] = [];
    const entries = yield* fileSystem.readDirectory(workerDir).pipe(
      Effect.mapError((cause) => mapFsError(workerDir, cause)),
    );
    for (const entry of entries) {
      const match = /^agents\.(.+)\.md$/.exec(entry);
      if (match === null) continue;
      appendixFiles.push(match[1] ?? "");
    }
    for (const suffix of appendixFiles) {
      if (!(HARNESS_NAMES as readonly string[]).includes(suffix)) {
        return yield* Effect.fail(workflowError(
          "load",
          absoluteWorkflowPath,
          `agents.${suffix}.md in ${workerDir} names an unknown harness "${suffix}"; the file suffix must be one of ${HARNESS_NAMES.join(", ")}`,
        ));
      }
    }
    const requested = join(workerDir, `agents.${harness}.md`);
    const hasRequested = yield* fileSystem.exists(requested).pipe(
      Effect.mapError((cause) => mapFsError(requested, cause)),
    );
    return hasRequested ? requested : undefined;
  });
}

/** Parse a SKILL.md's YAML frontmatter and validate its required fields. */
function readSkillFrontmatter(
  source: string,
  skillMd: string,
): Effect.Effect<{ name: string; description: string }, WorkflowError> {
  return Effect.gen(function* () {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
    if (match === null) {
      return yield* Effect.fail(workflowError("load", skillMd, "missing YAML frontmatter"));
    }
    const frontmatter = yield* Effect.try({
      try: () => load(match[1] ?? "") as Record<string, unknown>,
      catch: (cause) => workflowError("load", skillMd, `invalid skill frontmatter: ${errorMessage(cause)}`),
    });
    const name = yield* validateSkillName(frontmatter.name, skillMd);
    const description = frontmatter.description;
    if (typeof description !== "string" || description.trim() === "") {
      return yield* Effect.fail(workflowError("load", skillMd, `skill "${name}" must declare a non-empty description`));
    }
    return { name, description: description.trim() };
  });
}

/** Discover every `skills/<name>/SKILL.md` under a worker's skills directory.
 * Each skill must have a valid SKILL.md whose frontmatter `name` matches its
 * directory name; a missing or malformed skill fails the load. */
function discoverSkills(
  skillsRoot: string,
): Effect.Effect<readonly SkillDiscovery[], WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const exists = yield* fileSystem.exists(skillsRoot).pipe(
      Effect.mapError((cause) => mapFsError(skillsRoot, cause)),
    );
    if (!exists) return [] as const;
    const entries = yield* fileSystem.readDirectory(skillsRoot).pipe(
      Effect.mapError((cause) => mapFsError(skillsRoot, cause)),
    );
    const directories = yield* Effect.filter(entries, (entry) =>
      fileSystem.stat(join(skillsRoot, entry)).pipe(
        Effect.map((info) => info.type === "Directory"),
        Effect.mapError((cause) => mapFsError(join(skillsRoot, entry), cause)),
      ),
    );
    return yield* Effect.forEach(directories, (dirName) => Effect.gen(function* () {
      const dir = join(skillsRoot, dirName);
      const skillMd = join(dir, "SKILL.md");
      const source = yield* fileSystem.readFileString(skillMd).pipe(
        Effect.mapError((cause) => workflowError("load", skillMd, `${errorMessage(cause)}: every skill directory must contain a SKILL.md`)),
      );
      const frontmatter = yield* readSkillFrontmatter(source, skillMd);
      if (frontmatter.name !== dirName) {
        return yield* Effect.fail(workflowError("load", skillMd, `skill name "${frontmatter.name}" must match its directory "${dirName}"`));
      }
      return { dir, name: frontmatter.name, description: frontmatter.description };
    }));
  });
}

/**
 * Resolve a stage's worker to its `recipes/<worker>/` directory and discover
 * the worker's resources: an optional `system-prompt.md`, an optional `agents.md`
 * shared context file plus this stage's `agents.<harness>.md` appendix, and
 * every valid `skills/<name>/SKILL.md`. Callers opt into compiling the optional
 * contract when the stage uses `validate: true`. This is worker-bound discovery
 * — the stage DSL no longer carries system_prompt/skills/contextFiles paths. By
 * default `recipes/` below the installed Piano root is the plugin registry, never
 * the target project cwd, `~/.piano` persistent state, or dirname(workflowPath).
 */
export function resolveWorkerResources(
  worker: string,
  recipeRepositoryRoot = defaultRecipeRepositoryRoot,
  absoluteWorkflowPath: string,
  harness: string,
  options: { readonly loadContract?: boolean } = {},
): Effect.Effect<WorkerResources, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(worker) || worker === "workflows") {
      return yield* Effect.fail(workflowError(
        "load",
        absoluteWorkflowPath,
        `worker "${worker}" must name one plugin directory under recipes`,
      ));
    }
    const resolvedRecipesRoot = resolve(recipeRepositoryRoot, recipesDir);
    const workerDir = resolve(resolvedRecipesRoot, worker);
    if (!inside(resolvedRecipesRoot, workerDir)) {
      return yield* Effect.fail(workflowError("load", absoluteWorkflowPath, `worker "${worker}" resolves to an unsafe path outside ${resolvedRecipesRoot}`));
    }
    const workerExists = yield* fileSystem.exists(workerDir).pipe(
      Effect.mapError((cause) => mapFsError(workerDir, cause)),
    );
    if (!workerExists) {
      return yield* Effect.fail(workflowError("load", absoluteWorkflowPath, `worker "${worker}" has no recipes directory at ${workerDir}`));
    }
    const workerInfo = yield* fileSystem.stat(workerDir).pipe(
      Effect.mapError((cause) => mapFsError(workerDir, cause)),
    );
    if (workerInfo.type !== "Directory") {
      return yield* Effect.fail(workflowError("load", absoluteWorkflowPath, `worker "${worker}" must resolve to a recipes directory at ${workerDir}`));
    }

    const systemPromptPath = join(workerDir, "system-prompt.md");
    const hasSystemPrompt = yield* fileSystem.exists(systemPromptPath).pipe(
      Effect.mapError((cause) => mapFsError(systemPromptPath, cause)),
    );

    const agentsPath = join(workerDir, "agents.md");
    const hasAgents = yield* fileSystem.exists(agentsPath).pipe(
      Effect.mapError((cause) => mapFsError(agentsPath, cause)),
    );

    // The shared agents.md always comes first; the harness appendix is appended
    // right after it so per-harness rules extend, rather than replace, the
    // shared worker context.
    const appendixPath = yield* harnessAppendixPath(workerDir, harness, absoluteWorkflowPath);
    const contextFilePaths = [
      ...(hasAgents ? [agentsPath] : []),
      ...(appendixPath === undefined ? [] : [appendixPath]),
    ];

    const skills = yield* discoverSkills(join(workerDir, "skills"));
    // Front and back matter a worker wants on every stage it runs. They are
    // deliberately NOT context files: those are files the harness hands to the
    // agent, so listing these would surface the same text twice — once inline
    // in the prompt and again as a file the stage is told to read.
    const prologue = yield* readPromptResource(fileSystem, workerDir, "prologue.md");
    const epilogue = yield* readPromptResource(fileSystem, workerDir, "epilogue.md");
    const contractPath = join(workerDir, "contract.json");
    const hasContract = options.loadContract === true && (yield* fileSystem.exists(contractPath).pipe(
      Effect.mapError((cause) => mapFsError(contractPath, cause)),
    ));
    const contract = hasContract
      ? yield* fileSystem.readFileString(contractPath).pipe(
        Effect.mapError((cause) => mapFsError(contractPath, cause)),
        Effect.flatMap((source) => Effect.try({
          try: () => compileWorkerContract(source, contractPath),
          catch: (cause) => workflowError(
            "load",
            contractPath,
            cause instanceof WorkerContractLoadError ? cause.message : errorMessage(cause),
          ),
        })),
      )
      : undefined;
    return {
      ...(hasSystemPrompt ? { systemPromptPath } : {}),
      contextFilePaths,
      skillPaths: skills.map((skill) => skill.dir),
      ...(contract === undefined ? {} : { contract }),
      ...(prologue === undefined ? {} : { prologue }),
      ...(epilogue === undefined ? {} : { epilogue }),
    };
  });
}

export function loadWorkflow(
  workflowPath: string,
  root = dirname(workflowPath),
  recipeRepositoryRoot = defaultRecipeRepositoryRoot,
): Effect.Effect<LoadedWorkflow, WorkflowError, FileSystem.FileSystem | Logging> {
  const absoluteWorkflowPath = resolve(workflowPath);
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const source = yield* fileSystem.readFileString(absoluteWorkflowPath).pipe(
      Effect.mapError((cause) => mapFsError(absoluteWorkflowPath, cause)),
    );
    const document = yield* TRACE(PARSE_SOURCE, parseWorkflow(source, absoluteWorkflowPath), {
      workflowPath: absoluteWorkflowPath,
    });
    // Validate every plugin eagerly so a malformed workflow cannot defer a
    // missing worker failure until an unrelated predecessor finishes. The
    // harness appendix is discovered per stage, so an unknown agents.<xxx>.md
    // suffix also fails here.
    const stages = workflowStages(document.workflow.nodes);
    yield* Effect.sync(() => warnLegacyValidation(absoluteWorkflowPath, stages));
    const contractKeys = new Set(stages
      .filter((stage) => stage.validate === true)
      .map((stage) => workerResourcesKey(stage.worker, stage.harness)));
    const resourceEntries = yield* Effect.forEach(
      stages,
      (stage) => resolveWorkerResources(
        stage.worker,
        recipeRepositoryRoot,
        absoluteWorkflowPath,
        stage.harness,
        { loadContract: contractKeys.has(workerResourcesKey(stage.worker, stage.harness)) },
      ).pipe(
        Effect.flatMap((resources) => stage.validate === true && resources.contract === undefined
          ? Effect.fail(workflowError(
            "load",
            absoluteWorkflowPath,
            `stage "${stage.name}" uses validate: true but worker "${stage.worker}" has no contract.json`,
          ))
          : Effect.succeed([workerResourcesKey(stage.worker, stage.harness), resources] as const)),
      ),
    );
    return {
      root: resolve(root),
      workflowPath: absoluteWorkflowPath,
      document,
      workerResources: new Map(resourceEntries),
      recipeRepositoryRoot: resolve(recipeRepositoryRoot),
    };
  });
}

/** Record value naming a shipped builtin workflow template by file stem,
 * e.g. "builtin:topsop-tuning". Builtin records always carry the exact name:
 * the builtin set is multiple, so an unnamed "builtin" would be ambiguous —
 * and a name (rather than an absolute path) keeps the record valid across
 * package moves and upgrades. */
export const builtinWorkflowSelectionPrefix = "builtin:";

export function builtinWorkflowSelection(name: string): string {
  return `${builtinWorkflowSelectionPrefix}${name}`;
}

/** Stem of the shipped default template, e.g. "topsop-tuning". */
function defaultTemplateStem(): string {
  return basename(defaultWorkflowTemplatePath).replace(/\.ya?ml$/i, "");
}

interface WorkflowRecordResolution {
  /** The workflow file to load, already resolved. */
  readonly workflowPath: string;
  /** config.json exists and parses but names no usable workflow — a legacy
   * install predating the record (or the old unnamed "builtin" value). Its
   * "workflow" key gains the current default's exact name. Absence is never
   * a load failure. */
  readonly backfills: boolean;
  /** config.json does not exist (or is unreadable): a fresh record file is
   * created naming the current default, and reported to the user. */
  readonly creates: boolean;
}

const DEFAULT_WORKFLOW_LOG = logger(
  { module: "orchestrator", file: "workflow-file.ts", function: "loadDefaultWorkflow" },
  { namespace: "workflow" },
);

/** Resolve the recorded default workflow from config.json. Best-effort
 * throughout: an unreadable file creates a fresh record, malformed JSON runs
 * on the shipped default without rewriting the user's file, and a
 * missing/empty/unnamed value names the current default in the record — none
 * of these ever fail the run. A usable value is either "builtin:<template>"
 * (resolved against the installed templates) or a path to a workflow file
 * (absolute, or relative to the Piano root). */
function resolveWorkflowRecord(
  root: string,
): Effect.Effect<WorkflowRecordResolution, never, FileSystem.FileSystem> {
  const configPath = join(root, defaultConfigPath);
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const read = yield* fileSystem.readFileString(configPath).pipe(Effect.either);
    if (read._tag === "Left") {
      return { workflowPath: defaultWorkflowTemplatePath, backfills: false, creates: true };
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(read.right) as Record<string, unknown>;
    } catch {
      return { workflowPath: defaultWorkflowTemplatePath, backfills: false, creates: false };
    }
    const selection = parsed.workflow;
    const value = typeof selection === "string" ? selection.trim() : "";
    // Legacy key, the old unnamed "builtin", or a malformed builtin name:
    // name the current default instead.
    const unnamed = value === "" || value === "builtin" || value === builtinWorkflowSelectionPrefix;
    if (unnamed) {
      return { workflowPath: defaultWorkflowTemplatePath, backfills: true, creates: false };
    }
    if (value.startsWith(builtinWorkflowSelectionPrefix)) {
      const name = value.slice(builtinWorkflowSelectionPrefix.length);
      if (!/^[A-Za-z0-9._-]+$/.test(name)) {
        return { workflowPath: defaultWorkflowTemplatePath, backfills: true, creates: false };
      }
      return {
        workflowPath: resolve(dirname(defaultWorkflowTemplatePath), `${name}.yml`),
        backfills: false,
        creates: false,
      };
    }
    return { workflowPath: resolve(root, value), backfills: false, creates: false };
  });
}

/** Load the default workflow from the record in ~/.piano/config.json. The
 * record is created (naming the current default) when config.json is absent,
 * and named when a legacy config carries no usable key; both writes are
 * best-effort, reported in the workflow log, and never affect the run being
 * loaded. */
export function loadDefaultWorkflow(
  root = defaultRoot,
  recipeRepositoryRoot = defaultRecipeRepositoryRoot,
): Effect.Effect<LoadedWorkflow, WorkflowError, FileSystem.FileSystem | Logging> {
  return Effect.gen(function* () {
    const { workflowPath, backfills, creates } = yield* resolveWorkflowRecord(root);
    if (backfills || creates) {
      const record = builtinWorkflowSelection(defaultTemplateStem());
      yield* setWorkflowSelection(root, record).pipe(Effect.catchAll(() => Effect.void));
      yield* DEFAULT_WORKFLOW_LOG.info(
        creates ? "workflow.config.created" : "workflow.config.backfilled",
        {
          data: { configPath: join(root, defaultConfigPath), workflow: record },
        },
      );
    }
    return yield* loadWorkflow(workflowPath, root, recipeRepositoryRoot);
  });
}

/** Record the user's workflow selection as the default. Only the "workflow"
 * key of config.json is touched; every other key is preserved. An
 * unparseable config.json fails the write rather than silently discarding the
 * user's other settings. */
export function setWorkflowSelection(
  root: string,
  workflowPath: string,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  const configPath = join(root, defaultConfigPath);
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const source = yield* fileSystem.readFileString(configPath).pipe(
      Effect.catchAll(() => Effect.succeed("")),
    );
    let config: Record<string, unknown> = {};
    if (source.trim() !== "") {
      const parsed = yield* Effect.try({
        try: () => JSON.parse(source) as Record<string, unknown>,
        catch: (cause) => workflowError(
          "load",
          configPath,
          `refusing to record a workflow selection in an unparseable config.json: ${errorMessage(cause)}`,
        ),
      });
      config = parsed;
    }
    yield* fileSystem.writeFileString(
      configPath,
      `${JSON.stringify({ ...config, workflow: workflowPath }, null, 2)}\n`,
    ).pipe(Effect.mapError((cause) => mapFsError(configPath, cause)));
  });
}
