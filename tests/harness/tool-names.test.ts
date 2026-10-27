import { describe, expect, it } from "vitest";
import {
  harnessSupportsDiscuss,
  harnessToolNames,
  isKnownToolName,
  CODEX_TOOL_NAMES,
  PI_TOOL_NAMES,
  PI_CUSTOM_TOOL_NAMES,
  PI_EXTENSION_TOOL_NAMES,
  toolGrantsCapability,
  unknownToolNames,
} from "../../packages/harness/src/index.js";

// The exact-native-name contract behind workflow parse validation: recipes
// list each harness's real tool ids and adapters transport them verbatim.
describe("harness tool-name registry", () => {
  it("keeps pi and pi-cli on the same built-in ids", () => {
    expect(harnessToolNames("pi")).toEqual([...PI_TOOL_NAMES, ...PI_CUSTOM_TOOL_NAMES, ...PI_EXTENSION_TOOL_NAMES]);
    for (const name of ["read", "bash", "edit", "write", "find", "grep", "ls"]) {
      expect(isKnownToolName("pi", name)).toBe(true);
      expect(isKnownToolName("pi-cli", name)).toBe(true);
    }
    expect(isKnownToolName("pi", "Read")).toBe(false);
    expect(isKnownToolName("pi-cli", "Glob")).toBe(false);
  });

  it("accepts SDK customTools only on pi, not pi-cli", () => {
    for (const name of [...PI_CUSTOM_TOOL_NAMES]) {
      expect(isKnownToolName("pi", name)).toBe(true);
      expect(isKnownToolName("pi-cli", name)).toBe(false);
    }
  });

  it("accepts the extension tool on both Pi adapters", () => {
    for (const name of [...PI_EXTENSION_TOOL_NAMES]) {
      expect(isKnownToolName("pi", name)).toBe(true);
      expect(isKnownToolName("pi-cli", name)).toBe(true);
    }
  });

  it("accepts only PascalCase ids on claude", () => {
    for (const name of ["Read", "Bash", "Edit", "Write", "Grep", "Glob", "WebSearch", "WebFetch", "TodoWrite", "AskUserQuestion"]) {
      expect(isKnownToolName("claude", name)).toBe(true);
    }
    expect(isKnownToolName("claude", "read")).toBe(false);
    expect(isKnownToolName("claude", "red")).toBe(false);
  });

  it("accepts claude permission-rule scopes only over known base names", () => {
    expect(isKnownToolName("claude", "Bash(git *)")).toBe(true);
    expect(isKnownToolName("claude", "WebFetch(domain:docs.anthropic.com)")).toBe(true);
    expect(isKnownToolName("claude", "Bogus(x)")).toBe(false);
  });

  it("accepts mcp server tool names on MCP-capable harnesses", () => {
    expect(isKnownToolName("claude", "mcp__github__list_issues")).toBe(true);
    expect(isKnownToolName("claude", "mcp__github")).toBe(true);
    expect(isKnownToolName("claude", "mcp__")).toBe(false);
    expect(isKnownToolName("dsh", "mcp__piano__discuss")).toBe(true);
    expect(isKnownToolName("pi", "mcp__github__list_issues")).toBe(false);
  });

  it("accepts the standard dsh ids, including the fs tool pair", () => {
    for (const name of ["read", "bash", "edit", "write", "read_image", "glob", "grep", "pwsh", "ask_user_question", "web_search"]) {
      expect(isKnownToolName("dsh", name)).toBe(true);
    }
    expect(isKnownToolName("dsh", "Read")).toBe(false);
    // dsh has no ls/find; the pi id family does not leak across harnesses.
    expect(isKnownToolName("dsh", "ls")).toBe(false);
    expect(isKnownToolName("dsh", "find")).toBe(false);
  });

  it("validates Codex recipes against Piano's capability names without CLI renaming", () => {
    expect(harnessToolNames("codex")).toEqual(CODEX_TOOL_NAMES);
    for (const name of ["read", "bash", "edit", "write"]) {
      expect(isKnownToolName("codex", name)).toBe(true);
    }
    expect(isKnownToolName("codex", "Read")).toBe(false);
    expect(isKnownToolName("codex", "Bash(git *)")).toBe(false);
    expect(toolGrantsCapability("codex", "edit", "write")).toBe(true);
    expect(toolGrantsCapability("codex", "bash", "exec")).toBe(true);
  });

  it("reports the unknown subset in input order", () => {
    expect(unknownToolNames("pi", ["read", "Read", "bash"])).toEqual(["Read"]);
    expect(unknownToolNames("claude", ["read", "write"])).toEqual(["read", "write"]);
  });

  it("accepts the logical discuss tool only where the harness can mount it", () => {
    for (const harness of ["pi", "claude", "dsh"] as const) {
      expect(harnessSupportsDiscuss(harness)).toBe(true);
      expect(isKnownToolName(harness, "discuss")).toBe(true);
      expect(unknownToolNames(harness, ["discuss"])).toEqual([]);
    }
    for (const harness of ["pi-cli", "codex"] as const) {
      expect(harnessSupportsDiscuss(harness)).toBe(false);
      expect(isKnownToolName(harness, "discuss")).toBe(false);
      expect(unknownToolNames(harness, ["discuss"])).toEqual(["discuss"]);
    }
    expect(harnessToolNames("claude")).toContain("discuss");
    expect(harnessToolNames("dsh")).toContain("discuss");
  });

  it("maps capabilities to harness-native base names", () => {
    expect(toolGrantsCapability("pi", "write", "write")).toBe(true);
    expect(toolGrantsCapability("pi", "Write", "write")).toBe(false);
    expect(toolGrantsCapability("claude", "Write", "write")).toBe(true);
    expect(toolGrantsCapability("claude", "Bash(git *)", "exec")).toBe(true);
    expect(toolGrantsCapability("dsh", "bash", "exec")).toBe(true);
    expect(toolGrantsCapability("pi", "read", "exec")).toBe(false);
  });
});
