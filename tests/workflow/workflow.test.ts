import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  compileWorkflow,
  PI_WORKFLOW_HARNESS,
  defaultConfigPath,
  defaultWorkflowTemplatePath,
  loadWorkflow,
  loadDefaultWorkflow,
  setWorkflowSelection,
  resolveWorkerResources,
  parseWorkflow,
  stageModelForSlot,
  WorkflowError,
  type WorkflowDocument,
} from "../../packages/orchestrator/src/index.js";
import { LogWriter, TraceWriter, Logging, loggingService } from "../../packages/logging/src/index.js";

const SOURCE = "/tmp/workflow.yaml";
/** The shipped dsh coding template (kept in sync with recipes/workflows/coding-dsh.yml). */
const codingWorkflowTemplatePath = fileURLToPath(
  new URL("../../recipes/workflows/coding-dsh.yml", import.meta.url),
);
const CODING_WORKFLOW = `version: 3
workflow:
  name: coding-dsh
  nodes:
    - stage:
        name: coding
        worker: basic
        harness: dsh
        model: deepseek-flash
        thinkingLevel: max
        tools: [read, bash, edit, write, web_search]
        from: []
`;

/** The shipped claude coding template (kept in sync with recipes/workflows/coding-claude.yml). */
const codingClaudeWorkflowTemplatePath = fileURLToPath(
  new URL("../../recipes/workflows/coding-claude.yml", import.meta.url),
);
const CODING_CLAUDE_WORKFLOW = `version: 3
workflow:
  name: coding-claude
  nodes:
    - stage:
        name: coding
        worker: basic
        harness: claude
        model: deepseek-flash
        thinkingLevel: max
        tools: [Read, Bash, Edit, Write, Glob, Grep, WebSearch]
        from: []
`;

const codingPiWorkflowTemplatePath = fileURLToPath(
  new URL("../../recipes/workflows/coding-pi.yml", import.meta.url),
);

const WEB_SEARCH_WORKFLOWS = [
  { path: fileURLToPath(new URL("../../recipes/workflows/web-search.yml", import.meta.url)), harness: "pi", tool: "web_search" },
  { path: fileURLToPath(new URL("../../recipes/workflows/web-search-dsh.yml", import.meta.url)), harness: "dsh", tool: "web_search" },
  { path: fileURLToPath(new URL("../../recipes/workflows/web-search-claude.yml", import.meta.url)), harness: "claude", tool: "WebSearch" },
] as const;

// A worker-bound workflow whose `worker: smoke-test-agent` resolves to a
// recipes/<worker>/ tree at the workspace root. The worker resources
// (system-prompt.md / agents.md / skills) are auto-discovered from that
// directory — the stage DSL itself carries no resource paths.
const SMOKE_WORKFLOW = `version: 3
workflow:
  name: prompt-response
  nodes:
    - stage:
        name: respond
        worker: smoke-test-agent
        from: []
        tools: []
`;

const VALIDATE_WORKFLOW = CODING_WORKFLOW.replace(
  "        from: []\n",
  "        validate: text-response\n        from: []\n",
);

function run<A, E>(effect: Effect.Effect<A, E, never>): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(effect);
}

function runLogging<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Logging>): Promise<Exit.Exit<A, E>> {
  const log = new LogWriter("test", join(tmpdir(), "piano-workflow-log.jsonl"), "trace-test");
  const trace = new TraceWriter("test", join(tmpdir(), "piano-workflow-trace.jsonl"), "trace-test");
  return run(effect.pipe(
    Effect.provideService(Logging, loggingService(log, trace)),
    Effect.provide(NodeFileSystem.layer),
  ));
}

function firstStage(document: WorkflowDocument) {
  const node = document.workflow.nodes[0];
  return node !== undefined && "stage" in node ? node.stage : undefined;
}

describe(" single-stage workflow", () => {
  it("compiles the latest DSL shape into one ordered leaf", async () => {
    await expect(readFile(codingWorkflowTemplatePath, "utf8")).resolves.toBe(CODING_WORKFLOW);
    const parsed = await run(parseWorkflow(CODING_WORKFLOW, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isSuccess(compiled)).toBe(true);
    if (!Exit.isSuccess(compiled)) return;
    // compileWorkflow already emits leaves in dependency order.
    expect(compiled.value.stages.map((item) => item.stage.name)).toEqual(["coding"]);
    expect(compiled.value.stages[0]?.stage.worker).toBe("basic");
    expect(compiled.value.stages[0]?.stage.harness).toBe("dsh");
    expect(compiled.value.stages[0]?.stage.tools).toEqual(["read", "bash", "edit", "write", "web_search"]);
  });

  it("defaults stage memory to enabled and accepts only boolean overrides", async () => {
    const parsed = await run(parseWorkflow(CODING_WORKFLOW, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    expect(firstStage(parsed.value)?.memory).toBeUndefined();

    const disabled = await run(parseWorkflow(
      CODING_WORKFLOW.replace("        from: []\n", "        memory: false\n        from: []\n"),
      SOURCE,
    ));
    expect(Exit.isSuccess(disabled)).toBe(true);
    if (Exit.isSuccess(disabled)) expect(firstStage(disabled.value)?.memory).toBe(false);

    const malformed = await run(parseWorkflow(
      CODING_WORKFLOW.replace("        from: []\n", "        memory: yes\n        from: []\n"),
      SOURCE,
    ));
    expect(Exit.isFailure(malformed)).toBe(true);
    if (Exit.isFailure(malformed)) expect(String(malformed.cause)).toContain("stage.memory must be a boolean");
  });

  it("ships the coding-claude template parsed against the claude tool catalog", async () => {
    await expect(readFile(codingClaudeWorkflowTemplatePath, "utf8")).resolves.toBe(CODING_CLAUDE_WORKFLOW);
    const parsed = await run(parseWorkflow(CODING_CLAUDE_WORKFLOW, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isSuccess(compiled)).toBe(true);
    if (!Exit.isSuccess(compiled)) return;
    const stage = compiled.value.stages[0]?.stage;
    expect(stage?.harness).toBe("claude");
    expect(stage?.tools).toEqual(["Read", "Bash", "Edit", "Write", "Glob", "Grep", "WebSearch"]);
  });

  it("ships coding-pi with web_search instead of the larger web_fetch surface", async () => {
    const source = await readFile(codingPiWorkflowTemplatePath, "utf8");
    const parsed = await run(parseWorkflow(source, codingPiWorkflowTemplatePath));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    const compiled = await run(compileWorkflow(parsed.value, codingPiWorkflowTemplatePath));
    expect(Exit.isSuccess(compiled)).toBe(true);
    if (!Exit.isSuccess(compiled)) return;
    const tools = compiled.value.stages[0]?.stage.tools ?? [];
    expect(tools).toContain("web_search");
    expect(tools).not.toContain("web_fetch");
  });

  it("ships one explicit web-search workflow for each supported native adapter", async () => {
    for (const workflow of WEB_SEARCH_WORKFLOWS) {
      const source = await readFile(workflow.path, "utf8");
      const parsed = await run(parseWorkflow(source, workflow.path));
      expect(Exit.isSuccess(parsed)).toBe(true);
      if (!Exit.isSuccess(parsed)) continue;
      const compiled = await run(compileWorkflow(parsed.value, workflow.path));
      expect(Exit.isSuccess(compiled)).toBe(true);
      if (!Exit.isSuccess(compiled)) continue;
      const stage = compiled.value.stages[0]?.stage;
      expect(stage?.harness).toBe(workflow.harness);
      expect(stage?.tools).toEqual([workflow.tool]);
    }
  });

  it("accepts additional stages and orders them by dependency at compile", async () => {
    const secondStage = SMOKE_WORKFLOW.replace(
      "        tools: []\n",
      "        tools: []\n    - stage:\n        name: second\n        worker: other\n        validate: text-response\n        from: [respond]\n",
    );
    const parsed = await run(parseWorkflow(secondStage, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isSuccess(compiled)).toBe(true);
    if (Exit.isSuccess(compiled)) {
      expect(compiled.value.stages.map((s) => s.stage.name)).toEqual(["respond", "second"]);
    }
  });

  it("rejects an unknown validator name at compile time", async () => {
    const source = VALIDATE_WORKFLOW.replace(
      "        validate: text-response\n",
      "        validate: no-such-validator\n",
    );
    const parsed = await run(parseWorkflow(source, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isFailure(compiled)).toBe(true);
    if (Exit.isFailure(compiled)) {
      const failure = Cause.failureOption(compiled.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value).toBeInstanceOf(WorkflowError);
        expect(failure.value.message).toContain("no-such-validator");
      }
    }
  });

  it("uses pi as the canonical default harness", async () => {
    expect(PI_WORKFLOW_HARNESS).toBe("pi");
    const parsed = await run(parseWorkflow(SMOKE_WORKFLOW, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (Exit.isSuccess(parsed)) expect(firstStage(parsed.value)?.harness).toBe("pi");
  });

  it("accepts an optional whole-stage timeout", async () => {
    const source = SMOKE_WORKFLOW.replace(
      "        from: []\n",
      "        from: []\n        timeout: 1800\n",
    );
    const parsed = await run(parseWorkflow(source, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (Exit.isSuccess(parsed)) expect(firstStage(parsed.value)?.timeout).toBe(1800);
  });

  it("rejects a non-positive stage timeout", async () => {
    for (const bad of ["0", "-5"]) {
      const source = SMOKE_WORKFLOW.replace(
        "        from: []\n",
        `        from: []\n        timeout: ${bad}\n`,
      );
      const parsed = await run(parseWorkflow(source, SOURCE));
      expect(Exit.isFailure(parsed)).toBe(true);
      if (Exit.isFailure(parsed)) {
        const failure = Cause.failureOption(parsed.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) {
          expect(failure.value).toBeInstanceOf(WorkflowError);
          expect(failure.value.message).toContain("stage.timeout");
        }
      }
    }
  });

  it("rejects an unsupported default harness value", async () => {
    const source = SMOKE_WORKFLOW.replace(
      "        from: []\n",
      "        from: []\n        harness: default\n",
    );
    const parsed = await run(parseWorkflow(source, SOURCE));
    expect(Exit.isFailure(parsed)).toBe(true);
  });

  it("keeps an explicit pi harness canonical", async () => {
    const source = SMOKE_WORKFLOW.replace(
      "        from: []\n",
      "        from: []\n        harness: pi\n",
    );
    const parsed = await run(parseWorkflow(source, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (Exit.isSuccess(parsed)) expect(firstStage(parsed.value)?.harness).toBe("pi");
  });

  it("accepts the selectable subprocess harnesses at the workflow DSL boundary", async () => {
    for (const harness of ["pi-cli", "claude", "dsh", "codex"] as const) {
      const source = SMOKE_WORKFLOW.replace(
        "        from: []\n",
        `        from: []\n        harness: ${harness}\n`,
      );
      const parsed = await run(parseWorkflow(source, SOURCE));
      expect(Exit.isSuccess(parsed)).toBe(true);
      if (Exit.isSuccess(parsed)) expect(firstStage(parsed.value)?.harness).toBe(harness);
    }
  });

  it("accepts signoff as a stage boolean", async () => {
    for (const value of ["true", "false"]) {
      const source = SMOKE_WORKFLOW.replace(
        "        from: []\n",
        `        from: []\n        signoff: ${value}\n`,
      );
      const parsed = await run(parseWorkflow(source, SOURCE));
      expect(Exit.isSuccess(parsed)).toBe(true);
      if (Exit.isSuccess(parsed)) expect(firstStage(parsed.value)?.signoff).toBe(value === "true");
    }
  });

  it("omits signoff when the stage does not declare it", async () => {
    const parsed = await run(parseWorkflow(SMOKE_WORKFLOW, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (Exit.isSuccess(parsed)) expect(firstStage(parsed.value)?.signoff).toBeUndefined();
  });

  it("rejects a non-boolean stage signoff", async () => {
    const source = SMOKE_WORKFLOW.replace(
      "        from: []\n",
      "        from: []\n        signoff: \"ask\"\n",
    );
    expect(Exit.isFailure(await run(parseWorkflow(source, SOURCE)))).toBe(true);
  });

  it("accepts multiple tools as stage inputs", async () => {
    const source = SMOKE_WORKFLOW.replace(
      "        tools: []\n",
      "        tools:\n          - read\n          - bash\n",
    );
    const parsed = await run(parseWorkflow(source, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    expect(firstStage(parsed.value)?.tools).toEqual(["read", "bash"]);
  });

  it("rejects empty or duplicate tool names", async () => {
    const duplicateTools = SMOKE_WORKFLOW.replace(
      "        tools: []\n",
      "        tools:\n          - read\n          - read\n",
    );
    expect(Exit.isFailure(await run(parseWorkflow(duplicateTools, SOURCE)))).toBe(true);
  });

  // Exact-native-name contract: a stage lists its harness's real tool ids;
  // adapters transport them verbatim. Wrong-cased or wrong-harness names are
  // rejected at parse time instead of being silently dropped by the CLI.
  describe("stage.tools exact-name validation", () => {
    const withTools = (harness: string, tools: string) => SMOKE_WORKFLOW
      .replace("        tools: []\n", `        harness: ${harness}\n        tools: ${tools}\n`);

    const parseFailureMessage = async (source: string): Promise<string> => {
      const parsed = await run(parseWorkflow(source, SOURCE));
      expect(Exit.isFailure(parsed)).toBe(true);
      if (!Exit.isFailure(parsed)) return "";
      const failure = Cause.failureOption(parsed.cause);
      expect(Option.isSome(failure)).toBe(true);
      return Option.isSome(failure) ? failure.value.message : "";
    };

    it("rejects a claude-native name on a pi stage", async () => {
      const message = await parseFailureMessage(withTools("pi", "[Read]"));
      expect(message).toContain('unknown tool "Read"');
      expect(message).toContain('harness "pi"');
    });

    it("rejects a pi-native name on a claude stage", async () => {
      const message = await parseFailureMessage(withTools("claude", "[read, bash, edit, write]"));
      expect(message).toContain('unknown tool "read"');
      expect(message).toContain('harness "claude"');
    });

    it("accepts claude native ids including scoped Bash patterns", async () => {
      const parsed = await run(parseWorkflow(
        withTools("claude", "[Read, Bash, Edit, Write, Bash(git *)]"),
        SOURCE,
      ));
      expect(Exit.isSuccess(parsed)).toBe(true);
      if (Exit.isSuccess(parsed)) {
        expect(firstStage(parsed.value)?.tools).toEqual(["Read", "Bash", "Edit", "Write", "Bash(git *)"]);
      }
    });

    it("accepts mcp server tool names on claude", async () => {
      const parsed = await run(parseWorkflow(withTools("claude", "[mcp__github__list_issues]"), SOURCE));
      expect(Exit.isSuccess(parsed)).toBe(true);
    });

    it("accepts the native dsh tool ids", async () => {
      const parsed = await run(parseWorkflow(
        withTools("dsh", "[read, bash, edit, write, ask_user_question, web_search]"),
        SOURCE,
      ));
      expect(Exit.isSuccess(parsed)).toBe(true);
    });

    it("rejects scoped patterns on harnesses without permission-rule syntax", async () => {
      const message = await parseFailureMessage(withTools("pi", "[read(*)]"));
      expect(message).toContain('unknown tool "read(*)"');
    });
  });

  it("requires a harness-exact write or exec tool on a validating claude stage", async () => {
    const validateStage = (tools: string) => VALIDATE_WORKFLOW
      .replace("        harness: dsh\n", "        harness: claude\n")
      .replace("        tools: [read, bash, edit, write, web_search]\n", `        tools: ${tools}\n`);

    const withoutExec = await run(parseWorkflow(validateStage("[Read, Edit]"), SOURCE));
    expect(Exit.isSuccess(withoutExec)).toBe(true);
    if (Exit.isSuccess(withoutExec)) {
      const compiled = await run(compileWorkflow(withoutExec.value, SOURCE));
      expect(Exit.isFailure(compiled)).toBe(true);
      if (Exit.isFailure(compiled)) {
        const failure = Cause.failureOption(compiled.cause);
        expect(Option.isSome(failure) ? failure.value.message : "").toContain("must allow write or bash");
      }
    }

    // Scoped Bash still grants exec capability.
    const scopedExec = await run(parseWorkflow(validateStage("[Read, Bash(git *)]"), SOURCE));
    expect(Exit.isSuccess(scopedExec)).toBe(true);
    if (Exit.isSuccess(scopedExec)) {
      expect(Exit.isSuccess(await run(compileWorkflow(scopedExec.value, SOURCE)))).toBe(true);
    }
  });

  it("rejects a validation stage that cannot write its result", async () => {
    const source = VALIDATE_WORKFLOW.replace(
      "        tools: [read, bash, edit, write, web_search]\n",
      "        tools: []\n",
    );
    const parsed = await run(parseWorkflow(source, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isFailure(compiled)).toBe(true);
    if (!Exit.isFailure(compiled)) return;
    const failure = Cause.failureOption(compiled.cause);
    expect(Option.isSome(failure)).toBe(true);
    if (Option.isSome(failure)) expect(failure.value.message).toContain("must allow write or bash");
  });

  it("rejects a stage that declares a removed resource field", async () => {
    const source = SMOKE_WORKFLOW.replace(
      "        tools: []\n",
      "        tools: []\n        system_prompt: recipes/system-prompt.md\n",
    );
    expect(Exit.isFailure(await run(parseWorkflow(source, SOURCE)))).toBe(true);
  });

  it("rejects the renamed contract field with an actionable migration error", async () => {
    const source = CODING_WORKFLOW.replace("        from: []\n", "        contract: text-response\n        from: []\n");
    const parsed = await run(parseWorkflow(source, SOURCE));
    expect(Exit.isFailure(parsed)).toBe(true);
    if (!Exit.isFailure(parsed)) return;
    const failure = Cause.failureOption(parsed.cause);
    expect(Option.isSome(failure)).toBe(true);
    if (Option.isSome(failure)) expect(failure.value.message).toContain("renamed to stage.validate");
  });

  it("rejects validate:false instead of creating a second no-validation spelling", async () => {
    const source = CODING_WORKFLOW.replace("        from: []\n", "        validate: false\n        from: []\n");
    const parsed = await run(parseWorkflow(source, SOURCE));
    expect(Exit.isFailure(parsed)).toBe(true);
    if (!Exit.isFailure(parsed)) return;
    const failure = Cause.failureOption(parsed.cause);
    expect(Option.isSome(failure)).toBe(true);
    if (Option.isSome(failure)) expect(failure.value.message).toContain("true or omitted");
  });

  it("rejects an unsafe handoff path before dispatch", async () => {
    const source = CODING_WORKFLOW.replace("        from: []\n", "        handoff: ../outside.json\n        from: []\n");
    expect(Exit.isFailure(await run(parseWorkflow(source, SOURCE)))).toBe(true);
  });

  it("creates config.json naming the shipped default when no record exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-"));
    try {
      const result = await runLogging(loadDefaultWorkflow(root, process.cwd()));
      expect(Exit.isSuccess(result)).toBe(true);
      if (Exit.isSuccess(result)) {
        expect(result.value.workflowPath).toBe(defaultWorkflowTemplatePath);
        expect(result.value.document.workflow.name).toBe("coding-pi");
      }
      // The record file is created naming the exact shipped default; a
      // workflow.yml copy never happens.
      await expect(readdir(root)).resolves.toEqual([defaultConfigPath]);
      const config = JSON.parse(
        await readFile(join(root, defaultConfigPath), "utf8"),
      ) as Record<string, unknown>;
      expect(config.workflow).toBe("builtin:coding-pi");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads the workflow recorded as the user selection in config.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-selected-"));
    try {
      const selectedPath = join(root, "selected.yml");
      await writeFile(selectedPath, CODING_WORKFLOW);
      await writeFile(
        join(root, defaultConfigPath),
        JSON.stringify({ harness: "pi", workflow: selectedPath }),
      );
      const result = await runLogging(loadDefaultWorkflow(root, process.cwd()));
      expect(Exit.isSuccess(result)).toBe(true);
      if (Exit.isSuccess(result)) {
        expect(result.value.workflowPath).toBe(selectedPath);
        expect(result.value.document.workflow.name).toBe("coding-dsh");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to the builtin default when config.json is malformed", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-badconfig-"));
    try {
      await writeFile(join(root, defaultConfigPath), "{ not json {{{");
      const result = await runLogging(loadDefaultWorkflow(root, process.cwd()));
      expect(Exit.isSuccess(result)).toBe(true);
      if (Exit.isSuccess(result)) {
        expect(result.value.workflowPath).toBe(defaultWorkflowTemplatePath);
      }
      // A broken config is never rewritten behind the user's back.
      await expect(readFile(join(root, defaultConfigPath), "utf8")).resolves.toBe("{ not json {{{");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("backfills the builtin workflow key into a legacy config.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-legacyconfig-"));
    try {
      // A config written before the record existed: the missing key is not a
      // failure — the key is added, naming the current default exactly.
      await writeFile(join(root, defaultConfigPath), JSON.stringify({ harness: "pi", agents: 1 }));
      const result = await runLogging(loadDefaultWorkflow(root, process.cwd()));
      expect(Exit.isSuccess(result)).toBe(true);
      if (Exit.isSuccess(result)) {
        expect(result.value.workflowPath).toBe(defaultWorkflowTemplatePath);
      }
      const config = JSON.parse(
        await readFile(join(root, defaultConfigPath), "utf8"),
      ) as Record<string, unknown>;
      expect(config.workflow).toBe("builtin:coding-pi");
      expect(config.harness).toBe("pi");
      expect(config.agents).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads the shipped default from a named builtin record", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-builtin-record-"));
    try {
      await writeFile(
        join(root, defaultConfigPath),
        JSON.stringify({ workflow: "builtin:coding-pi" }),
      );
      const result = await runLogging(loadDefaultWorkflow(root, process.cwd()));
      expect(Exit.isSuccess(result)).toBe(true);
      if (Exit.isSuccess(result)) {
        expect(result.value.workflowPath).toBe(defaultWorkflowTemplatePath);
      }
      // Already recorded: the config is left exactly as it was.
      await expect(readFile(join(root, defaultConfigPath), "utf8")).resolves.toBe(
        JSON.stringify({ workflow: "builtin:coding-pi" }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves any builtin template by exact name", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-builtin-named-"));
    try {
      await writeFile(join(root, defaultConfigPath), JSON.stringify({ workflow: "builtin:coding-dsh" }));
      const result = await runLogging(loadDefaultWorkflow(root, process.cwd()));
      expect(Exit.isSuccess(result)).toBe(true);
      if (Exit.isSuccess(result)) {
        expect(result.value.workflowPath).toBe(codingWorkflowTemplatePath);
        expect(result.value.document.workflow.name).toBe("coding-dsh");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renames the old unnamed builtin record to the current default", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-builtin-unnamed-"));
    try {
      // An unnamed "builtin" is ambiguous (the builtin set is multiple), so it
      // is rewritten to name the current default — never a load failure.
      await writeFile(join(root, defaultConfigPath), JSON.stringify({ workflow: "builtin" }));
      const result = await runLogging(loadDefaultWorkflow(root, process.cwd()));
      expect(Exit.isSuccess(result)).toBe(true);
      if (Exit.isSuccess(result)) {
        expect(result.value.workflowPath).toBe(defaultWorkflowTemplatePath);
      }
      const config = JSON.parse(
        await readFile(join(root, defaultConfigPath), "utf8"),
      ) as Record<string, unknown>;
      expect(config.workflow).toBe("builtin:coding-pi");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports a clear load failure when the recorded selection is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-gone-"));
    try {
      await writeFile(
        join(root, defaultConfigPath),
        JSON.stringify({ workflow: join(root, "deleted.yml") }),
      );
      const result = await runLogging(loadDefaultWorkflow(root, process.cwd()));
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const failure = Cause.failureOption(result.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) expect(failure.value.message).toContain("deleted.yml");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records a selection in config.json preserving the other config keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-record-"));
    try {
      await writeFile(join(root, defaultConfigPath), JSON.stringify({ harness: "pi", agents: 2 }));
      const written = await runLogging(setWorkflowSelection(root, "/opt/selected.yml"));
      expect(Exit.isSuccess(written)).toBe(true);
      const config = JSON.parse(
        await readFile(join(root, defaultConfigPath), "utf8"),
      ) as Record<string, unknown>;
      expect(config.workflow).toBe("/opt/selected.yml");
      expect(config.harness).toBe("pi");
      expect(config.agents).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an unparseable config.json with a selection", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-record-bad-"));
    try {
      await writeFile(join(root, defaultConfigPath), "{ broken");
      const written = await runLogging(setWorkflowSelection(root, "/opt/selected.yml"));
      expect(Exit.isFailure(written)).toBe(true);
      // The user's file is left exactly as it was.
      await expect(readFile(join(root, defaultConfigPath), "utf8")).resolves.toBe("{ broken");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("discovers worker resources from the recipes tree for an explicit workflow", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-assets-"));
    try {
      const workflowPath = join(root, "special.yml");
      const workflow = SMOKE_WORKFLOW.replace(
        "        tools: []\n",
        "        tools:\n          - read\n",
      );
      await writeFile(workflowPath, workflow);
      const workerDir = join(root, "recipes", "smoke-test-agent");
      await mkdir(join(workerDir, "skills", "smoke-test-agent"), { recursive: true });
      await writeFile(join(workerDir, "system-prompt.md"), "system\n");
      await writeFile(join(workerDir, "agents.md"), "test context\n");
      await writeFile(
        join(workerDir, "skills", "smoke-test-agent", "SKILL.md"),
        "---\nname: smoke-test-agent\ndescription: test skill\n---\n",
      );
      const result = await runLogging(resolveWorkerResources("smoke-test-agent", root, workflowPath, "pi"));
      expect(Exit.isSuccess(result)).toBe(true);
      if (!Exit.isSuccess(result)) return;
      expect(result.value.systemPromptPath).toBe(join(workerDir, "system-prompt.md"));
      expect(result.value.contextFilePaths).toEqual([join(workerDir, "agents.md")]);
      expect(result.value.skillPaths).toEqual([join(workerDir, "skills", "smoke-test-agent")]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("appends only the stage harness's agents.<harness>.md after the shared agents.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-harness-appendix-"));
    try {
      const workflowPath = join(root, "appendix.yml");
      await writeFile(workflowPath, SMOKE_WORKFLOW);
      const workerDir = join(root, "recipes", "smoke-test-agent");
      await mkdir(workerDir, { recursive: true });
      await writeFile(join(workerDir, "agents.md"), "shared\n");
      await writeFile(join(workerDir, "agents.pi.md"), "pi-only rules\n");
      await writeFile(join(workerDir, "agents.claude.md"), "claude-only rules\n");

      const piStage = await runLogging(resolveWorkerResources("smoke-test-agent", root, workflowPath, "pi"));
      expect(Exit.isSuccess(piStage)).toBe(true);
      if (Exit.isSuccess(piStage)) {
        expect(piStage.value.contextFilePaths).toEqual([
          join(workerDir, "agents.md"),
          join(workerDir, "agents.pi.md"),
        ]);
      }

      const claudeStage = await runLogging(resolveWorkerResources("smoke-test-agent", root, workflowPath, "claude"));
      expect(Exit.isSuccess(claudeStage)).toBe(true);
      if (Exit.isSuccess(claudeStage)) {
        expect(claudeStage.value.contextFilePaths).toEqual([
          join(workerDir, "agents.md"),
          join(workerDir, "agents.claude.md"),
        ]);
      }

      // A harness with no appendix keeps just the shared context file.
      const dshStage = await runLogging(resolveWorkerResources("smoke-test-agent", root, workflowPath, "dsh"));
      expect(Exit.isSuccess(dshStage)).toBe(true);
      if (Exit.isSuccess(dshStage)) {
        expect(dshStage.value.contextFilePaths).toEqual([join(workerDir, "agents.md")]);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads a worker's optional prologue.md and epilogue.md as prompt text", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-prompt-resources-"));
    try {
      const workflowPath = join(root, "prompts.yml");
      await writeFile(workflowPath, SMOKE_WORKFLOW);
      const workerDir = join(root, "recipes", "smoke-test-agent");
      await mkdir(workerDir, { recursive: true });

      // Absent files mean no default, not an empty one.
      const bare = await runLogging(resolveWorkerResources("smoke-test-agent", root, workflowPath, "pi"));
      expect(Exit.isSuccess(bare)).toBe(true);
      if (Exit.isSuccess(bare)) {
        expect(bare.value.prologue).toBeUndefined();
        expect(bare.value.epilogue).toBeUndefined();
      }

      // The file's text is trimmed, and it stays out of the context files: the
      // engine composes it into the prompt, so the harness must not also see it
      // as an injected file.
      await writeFile(join(workerDir, "prologue.md"), "\n  Read WORKLOG.md first.\n\n");
      await writeFile(join(workerDir, "epilogue.md"), "Append your WORKLOG.md entry.\n");
      const loaded = await runLogging(resolveWorkerResources("smoke-test-agent", root, workflowPath, "pi"));
      expect(Exit.isSuccess(loaded)).toBe(true);
      if (Exit.isSuccess(loaded)) {
        expect(loaded.value.prologue).toBe("Read WORKLOG.md first.");
        expect(loaded.value.epilogue).toBe("Append your WORKLOG.md entry.");
        expect(loaded.value.contextFilePaths).not.toContain(join(workerDir, "prologue.md"));
        expect(loaded.value.contextFilePaths).not.toContain(join(workerDir, "epilogue.md"));
      }

      // An empty file is a silent no-op the author would not notice, so it
      // fails the load, matching the stage-level fields' rule.
      await writeFile(join(workerDir, "epilogue.md"), "   \n");
      const blank = await runLogging(resolveWorkerResources("smoke-test-agent", root, workflowPath, "pi"));
      expect(Exit.isFailure(blank)).toBe(true);
      if (Exit.isFailure(blank)) {
        expect(String(blank.cause)).toContain("epilogue.md is empty");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an agents.<harness>.md file with an unknown harness suffix at load", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-unknown-appendix-"));
    try {
      const workflowPath = join(root, "unknown.yml");
      await writeFile(workflowPath, SMOKE_WORKFLOW);
      const workerDir = join(root, "recipes", "smoke-test-agent");
      await mkdir(workerDir, { recursive: true });
      await writeFile(join(workerDir, "agents.md"), "shared\n");
      await writeFile(join(workerDir, "agents.gpt.md"), "mystery rules\n");

      const result = await runLogging(loadWorkflow(workflowPath, root, root));
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const failure = Cause.failureOption(result.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) {
          expect(failure.value).toBeInstanceOf(WorkflowError);
          expect(failure.value.message).toContain("agents.gpt.md");
          expect(failure.value.message).toContain("pi, pi-cli, claude, dsh, codex");
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("discovers skills whose frontmatter uses CRLF line endings", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-crlf-skill-"));
    try {
      const workflowPath = join(root, "crlf.yml");
      await writeFile(workflowPath, SMOKE_WORKFLOW);
      const skillDir = join(root, "recipes", "smoke-test-agent", "skills", "smoke-test-agent");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        "---\r\nname: smoke-test-agent\r\ndescription: test skill\r\n---\r\n",
      );

      const result = await runLogging(resolveWorkerResources("smoke-test-agent", root, workflowPath, "pi"));
      expect(Exit.isSuccess(result)).toBe(true);
      if (Exit.isSuccess(result)) expect(result.value.skillPaths).toEqual([skillDir]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails the load when the worker has no recipes directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-missing-worker-"));
    try {
      const workflowPath = join(root, "missing.yml");
      await writeFile(workflowPath, SMOKE_WORKFLOW);
      const result = await runLogging(loadWorkflow(workflowPath, root, root));
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const failure = Cause.failureOption(result.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) {
          expect(failure.value).toBeInstanceOf(WorkflowError);
          expect(failure.value.message).toContain("smoke-test-agent");
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects worker values that are not plugin directory names", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-unsafe-worker-"));
    try {
      const workflowPath = join(root, "unsafe.yml");
      await writeFile(workflowPath, CODING_WORKFLOW.replace("worker: basic", "worker: ."));
      const result = await runLogging(loadWorkflow(workflowPath, root, root));
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const failure = Cause.failureOption(result.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) expect(failure.value.message).toContain("plugin directory");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails the load when a skill directory has no valid SKILL.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-bad-skill-"));
    try {
      const workflowPath = join(root, "bad-skill.yml");
      await writeFile(workflowPath, SMOKE_WORKFLOW);
      await mkdir(join(root, "recipes/smoke-test-agent/skills/broken"), { recursive: true });
      const result = await runLogging(loadWorkflow(workflowPath, root, root));
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const failure = Cause.failureOption(result.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) {
          expect(failure.value).toBeInstanceOf(WorkflowError);
          expect(failure.value.message).toContain("SKILL.md");
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves validate:true from the worker-owned contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-worker-contract-"));
    try {
      const workflowPath = join(root, "contract.yml");
      const workerDir = join(root, "recipes", "custom-worker");
      await mkdir(workerDir, { recursive: true });
      await writeFile(workflowPath, CODING_WORKFLOW
        .replace("worker: basic", "worker: custom-worker")
        .replace("        from: []", "        validate: true\n        from: []"));
      await writeFile(join(workerDir, "contract.json"), JSON.stringify({
        version: 1,
        id: "custom-result",
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          required: ["value"],
          properties: { value: { type: "string" } },
          additionalProperties: false,
        },
        example: { value: "ok" },
        outputs: { metrics: [] },
      }));

      const result = await runLogging(loadWorkflow(workflowPath, root, root));
      expect(Exit.isSuccess(result)).toBe(true);
      if (Exit.isSuccess(result)) {
        expect([...result.value.workerResources!.values()][0]?.contract?.manifest.id).toBe("custom-result");
        expect(result.value.recipeRepositoryRoot).toBe(root);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("emits a user-visible deprecation warning for string-valued validation", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-legacy-warning-"));
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    try {
      const workflowPath = join(root, "legacy.yml");
      await writeFile(workflowPath, VALIDATE_WORKFLOW);

      const result = await runLogging(loadWorkflow(workflowPath, root, process.cwd()));

      expect(Exit.isSuccess(result)).toBe(true);
      expect(emitWarning).toHaveBeenCalledOnce();
      expect(emitWarning).toHaveBeenCalledWith(
        expect.stringContaining('stage "coding" (text-response)'),
        {
          code: "PIANO_LEGACY_WORKER_CONTRACT",
          type: "DeprecationWarning",
        },
      );
    } finally {
      emitWarning.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails workflow loading when validate:true has no usable worker contract", async () => {
    for (const contractSource of [undefined, "{not-json"] as const) {
      const root = await mkdtemp(join(tmpdir(), "piano-workflow-invalid-contract-"));
      try {
        const workflowPath = join(root, "contract.yml");
        const workerDir = join(root, "recipes", "custom-worker");
        await mkdir(workerDir, { recursive: true });
        await writeFile(workflowPath, CODING_WORKFLOW
          .replace("worker: basic", "worker: custom-worker")
          .replace("        from: []", "        validate: true\n        from: []"));
        if (contractSource !== undefined) await writeFile(join(workerDir, "contract.json"), contractSource);

        const result = await runLogging(loadWorkflow(workflowPath, root, root));
        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          const failure = Cause.failureOption(result.cause);
          expect(Option.isSome(failure)).toBe(true);
          if (Option.isSome(failure)) expect(failure.value.message).toContain("contract");
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  it("ignores an unused worker contract when validation is omitted", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-unused-contract-"));
    try {
      const workflowPath = join(root, "contract.yml");
      const workerDir = join(root, "recipes", "custom-worker");
      await mkdir(workerDir, { recursive: true });
      await writeFile(workflowPath, CODING_WORKFLOW.replace("worker: basic", "worker: custom-worker"));
      await writeFile(join(workerDir, "contract.json"), "{not-json");

      const result = await runLogging(loadWorkflow(workflowPath, root, root));
      expect(Exit.isSuccess(result)).toBe(true);
      if (Exit.isSuccess(result)) {
        expect([...result.value.workerResources!.values()][0]?.contract).toBeUndefined();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["CUDA", "gpu-cuda-tuning.yml", "cuda-round-result-v2"],
    ["Triton", "gpu-triton-tuning.yml", "triton-round-result"],
  ] as const)("discovers every worker-owned contract in the built-in %s workflow", async (_family, file, roundContractId) => {
    const repositoryRoot = process.cwd();
    const workflowPath = join(repositoryRoot, "recipes", "workflows", file);
    const result = await runLogging(loadWorkflow(workflowPath, repositoryRoot, repositoryRoot));

    expect(Exit.isSuccess(result)).toBe(true);
    if (!Exit.isSuccess(result)) return;
    const contracts = [...result.value.workerResources!.values()].map((resources) => resources.contract?.manifest.id);
    expect(contracts).toHaveLength(6);
    expect(contracts.every((id) => id !== undefined)).toBe(true);
    expect(contracts).toContain(roundContractId);
  });

  it("binds the canonical coding workflow as the default worker template", async () => {
    const repositoryRoot = process.cwd();
    const workflowPath = join(repositoryRoot, "recipes", "workflows", "coding-pi.yml");
    const result = await runLogging(loadWorkflow(workflowPath, repositoryRoot, repositoryRoot));

    expect(Exit.isSuccess(result)).toBe(true);
    if (!Exit.isSuccess(result)) return;
    expect(result.value.document.workflow.name).toBe("coding-pi");
    expect(result.value.workerResources).toBeDefined();
  });

  it("keeps the workflow error as a typed Effect failure", async () => {
    const parsed = await run(parseWorkflow("version: 2\n", SOURCE));
    expect(Exit.isFailure(parsed)).toBe(true);
    if (Exit.isFailure(parsed)) {
      const failure = parsed.cause as unknown;
      expect(failure).toBeDefined();
    }
    expect(new WorkflowError({ phase: "parse", path: SOURCE, message: "bad" }).phase).toBe("parse");
  });
});

describe("workflow autoCommit (ISSUE-017)", () => {
  const WITH_AUTO_COMMIT = CODING_WORKFLOW.replace("  name: coding-dsh\n", "  name: coding-dsh\n  autoCommit: true\n");

  it("parses autoCommit: true and threads it through compile", async () => {
    const parsed = await run(parseWorkflow(WITH_AUTO_COMMIT, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    expect(parsed.value.workflow.autoCommit).toBe(true);
    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isSuccess(compiled)).toBe(true);
    if (Exit.isSuccess(compiled)) expect(compiled.value.autoCommit).toBe(true);
  });

  it("parses autoCommit: false", async () => {
    const source = CODING_WORKFLOW.replace("  name: coding-dsh\n", "  name: coding-dsh\n  autoCommit: false\n");
    const parsed = await run(parseWorkflow(source, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (Exit.isSuccess(parsed)) expect(parsed.value.workflow.autoCommit).toBe(false);
  });

  it("defaults autoCommit to false when omitted (opt-in)", async () => {
    const parsed = await run(parseWorkflow(CODING_WORKFLOW, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    expect(parsed.value.workflow.autoCommit).toBe(false);
    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isSuccess(compiled)).toBe(true);
    if (Exit.isSuccess(compiled)) expect(compiled.value.autoCommit).toBe(false);
  });

  it("rejects a non-boolean autoCommit value", async () => {
    const source = CODING_WORKFLOW.replace("  name: coding-dsh\n", "  name: coding-dsh\n  autoCommit: yes\n");
    expect(Exit.isFailure(await run(parseWorkflow(source, SOURCE)))).toBe(true);
  });

  it("still rejects unknown workflow-level fields next to autoCommit", async () => {
    const source = CODING_WORKFLOW.replace("  name: coding-dsh\n", "  name: coding-dsh\n  autoCommit: true\n  push: true\n");
    expect(Exit.isFailure(await run(parseWorkflow(source, SOURCE)))).toBe(true);
  });
});

describe("workflow mnemonic", () => {
  it("parses workflow.mnemonic and threads it through compile", async () => {
    const source = CODING_WORKFLOW.replace("  name: coding-dsh\n", "  name: coding-dsh\n  mnemonic: gemm\n");
    const parsed = await run(parseWorkflow(source, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    expect(parsed.value.workflow.mnemonic).toBe("gemm");
    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isSuccess(compiled)).toBe(true);
    if (Exit.isSuccess(compiled)) expect(compiled.value.mnemonic).toBe("gemm");
  });

  it("defaults mnemonic to undefined when omitted", async () => {
    const parsed = await run(parseWorkflow(CODING_WORKFLOW, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (Exit.isSuccess(parsed)) expect(parsed.value.workflow.mnemonic).toBeUndefined();
  });

  it("rejects a mnemonic that is not a workflow identifier", async () => {
    const source = CODING_WORKFLOW.replace("  name: coding-dsh\n", "  name: coding-dsh\n  mnemonic: gemm/relu\n");
    expect(Exit.isFailure(await run(parseWorkflow(source, SOURCE)))).toBe(true);
  });
});

const TOURNAMENT_WORKFLOW = `version: 3
workflow:
  name: per-lane-models
  nodes:
    - stage:
        name: seed
        worker: smoke-test-agent
        from: []
        tools: []
    - tournament:
        name: race
        from: [seed]
        over: seed.strategies
        count: 3
        entry: work
        exit: score
        nodes:
          - stage:
              name: work
              worker: smoke-test-agent
              from: []
              tools: []
          - stage:
              name: score
              worker: smoke-test-agent
              from: [work]
              tools: []
`;

/** The `work` lane stage of {@link TOURNAMENT_WORKFLOW} with a `model:` line.
 * `model` is injected verbatim, so callers control its YAML shape. */
function tournamentWithWorkModel(model: string): string {
  return TOURNAMENT_WORKFLOW.replace(
    "              name: work\n              worker: smoke-test-agent\n",
    `              name: work\n              worker: smoke-test-agent\n${model}\n`,
  );
}

function failureMessage<E>(cause: Cause.Cause<E>): string {
  const failure = Cause.failureOption(cause);
  return Option.isSome(failure) && failure.value instanceof WorkflowError
    ? failure.value.message
    : "";
}

/** Compile `source`, asserting it fails, and return the reported message. */
async function compileFailure(source: string): Promise<string> {
  const parsed = await run(parseWorkflow(source, SOURCE));
  if (!Exit.isSuccess(parsed)) return failureMessage(parsed.cause);
  const compiled = await run(compileWorkflow(parsed.value, SOURCE));
  expect(Exit.isFailure(compiled)).toBe(true);
  return Exit.isFailure(compiled) ? failureMessage(compiled.cause) : "";
}

describe("tournament per-lane stage models", () => {
  it("carries a model list into the compiled lane stage", async () => {
    const parsed = await run(parseWorkflow(tournamentWithWorkModel("              model: [m-one, m-two, m-three]"), SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isSuccess(compiled)).toBe(true);
    if (!Exit.isSuccess(compiled)) return;
    expect(compiled.value.stages.find((stage) => stage.stage.name === "work")?.stage.model)
      .toEqual(["m-one", "m-two", "m-three"]);
  });

  it("keeps a single model legal inside a tournament", async () => {
    // The list form is additive: a lane stage pinned to one model must not
    // start demanding an entry per lane.
    const parsed = await run(parseWorkflow(tournamentWithWorkModel("              model: m-one"), SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isSuccess(compiled)).toBe(true);
    if (!Exit.isSuccess(compiled)) return;
    expect(compiled.value.stages.find((stage) => stage.stage.name === "work")?.stage.model).toBe("m-one");
  });

  it("refuses a list that is not exactly one model per lane", async () => {
    for (const models of ["[m-one, m-two]", "[m-one, m-two, m-three, m-four]", "[m-one]"]) {
      const message = await compileFailure(tournamentWithWorkModel(`              model: ${models}`));
      expect(message).toContain("stage \"work\"");
      expect(message).toContain("tournament \"race\"");
      expect(message).toContain("count 3");
    }
  });

  it("refuses a model list on a stage outside every tournament", async () => {
    const source = SMOKE_WORKFLOW.replace(
      "        worker: smoke-test-agent\n",
      "        worker: smoke-test-agent\n        model: [m-one, m-two]\n",
    );
    const message = await compileFailure(source);
    expect(message).toContain("stage \"respond\"");
    expect(message).toContain("not inside a tournament");
  });

  it("refuses an empty list and a blank entry at parse time", async () => {
    for (const models of ["[]", "[m-one, '']"]) {
      const parsed = await run(parseWorkflow(tournamentWithWorkModel(`              model: ${models}`), SOURCE));
      expect(Exit.isFailure(parsed)).toBe(true);
      if (Exit.isFailure(parsed)) expect(failureMessage(parsed.cause)).toContain("stage.model");
    }
  });

  it("allows the same model on every lane", async () => {
    // Racing one model under several strategies is a legitimate experiment, so
    // the entries are not required to be distinct.
    const parsed = await run(parseWorkflow(tournamentWithWorkModel("              model: [m-one, m-one, m-one]"), SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
  });

  it("matches the innermost tournament when tournaments nest", async () => {
    const nested = `version: 3
workflow:
  name: nested-lanes
  nodes:
    - stage:
        name: seed
        worker: smoke-test-agent
        from: []
        tools: []
    - tournament:
        name: outer
        from: [seed]
        over: seed.strategies
        count: 2
        entry: prep
        exit: inner
        nodes:
          - stage:
              name: prep
              worker: smoke-test-agent
              from: []
              tools: []
          - tournament:
              name: inner
              from: [prep]
              over: prep.strategies
              count: 3
              entry: work
              exit: score
              nodes:
                - stage:
                    name: work
                    worker: smoke-test-agent
                    from: []
                    tools: []
                - stage:
                    name: score
                    worker: smoke-test-agent
                    from: [work]
                    tools: []
`;
    // The lane stage belongs to `inner`, so three entries compile...
    const withInner = nested.replace(
      "                    name: work\n                    worker: smoke-test-agent\n",
      "                    name: work\n                    worker: smoke-test-agent\n                    model: [m-one, m-two, m-three]\n",
    );
    const parsed = await run(parseWorkflow(withInner, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    expect(Exit.isSuccess(await run(compileWorkflow(parsed.value, SOURCE)))).toBe(true);

    // ...and the outer stage belongs to `outer`, so it takes two and not three.
    const withOuter = nested.replace(
      "              name: prep\n              worker: smoke-test-agent\n",
      "              name: prep\n              worker: smoke-test-agent\n              model: [m-one, m-two]\n",
    );
    const outerParsed = await run(parseWorkflow(withOuter, SOURCE));
    expect(Exit.isSuccess(outerParsed)).toBe(true);
    if (!Exit.isSuccess(outerParsed)) return;
    expect(Exit.isSuccess(await run(compileWorkflow(outerParsed.value, SOURCE)))).toBe(true);

    const tooMany = nested.replace(
      "              name: prep\n              worker: smoke-test-agent\n",
      "              name: prep\n              worker: smoke-test-agent\n              model: [m-one, m-two, m-three]\n",
    );
    expect(await compileFailure(tooMany)).toContain("tournament \"outer\"");
  });

  it("selects one model per lane, and a single model for every lane", () => {
    expect(stageModelForSlot(["m-one", "m-two", "m-three"], 0)).toBe("m-one");
    expect(stageModelForSlot(["m-one", "m-two", "m-three"], 2)).toBe("m-three");
    expect(stageModelForSlot("m-one", 2)).toBe("m-one");
    expect(stageModelForSlot(undefined, 1)).toBeUndefined();
  });
});
