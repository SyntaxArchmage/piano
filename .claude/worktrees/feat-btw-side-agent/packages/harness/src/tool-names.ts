import type { HarnessName } from "./harness-config.js";

/** Native tool ids for the Pi SDK/CLI built-in tools (the only names
 * `pi --tools` resolves without an extension). Source of truth: the installed
 * pi-coding-agent's core/tools modules. */
export const PI_TOOL_NAMES = ["bash", "edit", "find", "grep", "ls", "read", "write"] as const;

/** Additional tool ids injected as customTools by piano's Pi SDK adapter.
 * These are NOT built into the Pi SDK — piano implements them and passes them
 * via CreateAgentSessionOptions.customTools at session creation time. */
export const PI_CUSTOM_TOOL_NAMES = ["web_fetch"] as const;

/** Tool ids Piano mounts as Pi extensions. These are available to both the
 * in-process SDK adapter and the pi-cli subprocess when a stage declares them. */
export const PI_EXTENSION_TOOL_NAMES = ["web_search"] as const;

/** Claude Code's model-facing tool ids. Names are PascalCase and must match
 * exactly: the CLI ignores unknown `--allowed-tools` entries silently, so a
 * typo degrades into "that tool is unavailable" at run time, not an error.
 * Permission-rule scoping (`Bash(git *)`) and `mcp__<server>__<tool>` names
 * are additionally accepted for this harness only — the CLI understands them. */
export const CLAUDE_TOOL_NAMES = [
  "Agent",
  "AskUserQuestion",
  "Bash",
  "CronCreate",
  "CronDelete",
  "CronList",
  "Edit",
  "EnterPlanMode",
  "EnterWorktree",
  "ExitPlanMode",
  "ExitWorktree",
  "Glob",
  "Grep",
  "NotebookEdit",
  "NotebookRead",
  "Read",
  "ReportFindings",
  "ScheduleWakeup",
  "SendMessage",
  "Skill",
  "SlashCommand",
  "Task",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskOutput",
  "TaskStop",
  "TaskUpdate",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "Workflow",
  "Write",
] as const;

/** Claude's minimal `--bare` mode does not attach these native tools to the
 * model request. A stage declaring one must use the full client. */
export const CLAUDE_BARE_UNAVAILABLE_TOOLS: readonly string[] = ["WebSearch"];

/** dsh model-facing tool ids exposed by the standard plugin set (lowercase).
 * dsh headless spawns with the preset's own mount set — the stage `tools`
 * list never travels to the child — so this catalog guards recipe intent
 * (typos, stale names) rather than the spawn contract. When a dsh plugin adds
 * or renames a tool, add the id here. */
export const DSH_TOOL_NAMES = [
  "ask_user_question",
  "bash",
  "create_goal",
  "edit",
  "get_goal",
  "update_goal",
  "glob",
  "grep",
  "interrupt_agent",
  "job_kill",
  "job_list",
  "job_output",
  "plan",
  "pwsh",
  "ralph",
  "read",
  "read_image",
  "report",
  "send_message",
  "skill",
  "str_replace_editor",
  "todo_write",
  "web_fetch",
  "web_search",
  "write",
  "cordis_define",
  "cordis_inspect_list",
  "cordis_inspect_query",
  "cordis_inspect_self",
  "cordis_run",
  "cordis_stop",
  "cordis_undefine",
] as const;

interface HarnessToolCatalog {
  readonly known: readonly string[];
  /** Whether the harness's own CLI interprets `Name(spec)` permission rules. */
  readonly supportsScopedNames: boolean;
  /** Whether the harness can mount `mcp__<server>__<tool>` names. */
  readonly supportsMcpNames: boolean;
  /** Base names that let a stage create files (validate result contract). */
  readonly write: readonly string[];
  /** Base names that let a stage run arbitrary commands. */
  readonly exec: readonly string[];
}

const PI_SDK_TOOL_NAMES = [...PI_TOOL_NAMES, ...PI_CUSTOM_TOOL_NAMES, ...PI_EXTENSION_TOOL_NAMES] as const;
const PI_CLI_TOOL_NAMES = [...PI_TOOL_NAMES, ...PI_EXTENSION_TOOL_NAMES] as const;

const CATALOGS: Record<HarnessName, HarnessToolCatalog> = {
  pi: { known: PI_SDK_TOOL_NAMES, supportsScopedNames: false, supportsMcpNames: false, write: ["write"], exec: ["bash"] },
  "pi-cli": { known: PI_CLI_TOOL_NAMES, supportsScopedNames: false, supportsMcpNames: false, write: ["write"], exec: ["bash"] },
  claude: { known: CLAUDE_TOOL_NAMES, supportsScopedNames: true, supportsMcpNames: true, write: ["Write"], exec: ["Bash"] },
  dsh: { known: DSH_TOOL_NAMES, supportsScopedNames: false, supportsMcpNames: false, write: ["write"], exec: ["bash"] },
};

/** The catalog for a harness, e.g. to list valid names in an error message. */
export function harnessToolNames(harness: HarnessName): readonly string[] {
  return CATALOGS[harness].known;
}

/** Strip a `Name(spec)` permission-rule suffix. Only meaningful for harnesses
 * with `supportsScopedNames`; for the others the paren marks an invalid name,
 * which callers catch because the raw string is not in `known`. */
function toolSpecParts(harness: HarnessName, tool: string): { base: string; scoped: boolean } {
  const paren = tool.indexOf("(");
  return paren === -1 ? { base: tool, scoped: false } : { base: tool.slice(0, paren), scoped: true };
}

/** True when `tool` is a name the harness itself would accept: an exact
 * native id (plus scoped/mcp forms where the harness CLI understands them). */
export function isKnownToolName(harness: HarnessName, tool: string): boolean {
  const catalog = CATALOGS[harness];
  const { base, scoped } = toolSpecParts(harness, tool);
  if (scoped && !catalog.supportsScopedNames) return false;
  if (scoped && !catalog.known.includes(base)) return false;
  if (catalog.supportsMcpNames && /^mcp__[A-Za-z0-9_-]+(__[A-Za-z0-9_-]+)?$/.test(base)) return true;
  return catalog.known.includes(tool) || catalog.known.includes(base);
}

/** True when `tool` grants the named capability for the harness, comparing
 * base names so a scoped `Bash(git *)` counts as exec. */
export function toolGrantsCapability(
  harness: HarnessName,
  tool: string,
  capability: "write" | "exec",
): boolean {
  return CATALOGS[harness][capability].includes(toolSpecParts(harness, tool).base);
}

/** The tools that are not valid for the harness, in input order. */
export function unknownToolNames(harness: HarnessName, tools: readonly string[]): string[] {
  return tools.filter((tool) => !isKnownToolName(harness, tool));
}
