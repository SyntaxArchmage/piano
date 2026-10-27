import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { AgentRequest } from "../../packages/harness/src/agent-contract.js";
import type { DiscussBridge } from "../../packages/harness/src/discuss-bridge.js";
import { claudeArguments, type LoadedResources } from "../../packages/harness/src/harness-argv.js";
import { DISCUSS_MCP_TOOL_NAME, DISCUSS_TOOL_NAME } from "../../packages/harness/src/tool-names.js";

const resources: LoadedResources = { contextFiles: [], skills: [] };

function request(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    cwd: "/tmp/piano",
    prompt: "design it",
    tools: ["read", "bash", DISCUSS_TOOL_NAME],
    ...overrides,
  };
}

function bridge(): DiscussBridge {
  return {
    url: "tcp://127.0.0.1:43210",
    token: "test-token",
    close: () => Effect.void,
  };
}

describe("Claude discuss wiring", () => {
  it("mounts the Piano MCP server and translates the discuss tool id", () => {
    const args = claudeArguments(request(), {}, undefined, resources, bridge());
    const configIndex = args.indexOf("--mcp-config");
    expect(configIndex).toBeGreaterThanOrEqual(0);
    const config = JSON.parse(args[configIndex + 1]!) as {
      mcpServers?: { piano?: { type?: string; args?: string[]; env?: Record<string, string> } };
    };
    expect(config.mcpServers?.piano).toMatchObject({
      type: "stdio",
      env: {
        PIANO_DISCUSS_URL: "tcp://127.0.0.1:43210",
        PIANO_DISCUSS_TOKEN: "test-token",
      },
    });
    expect(config.mcpServers?.piano?.args?.[0]).toContain("discuss-mcp.mjs");

    const allowedIndex = args.indexOf("--allowed-tools");
    expect(allowedIndex).toBeGreaterThanOrEqual(0);
    expect(args.slice(allowedIndex + 1)).toContain(DISCUSS_MCP_TOOL_NAME);
    expect(args.slice(allowedIndex + 1)).not.toContain(DISCUSS_TOOL_NAME);
    expect(args[args.indexOf("--append-system-prompt") + 1]).toContain(DISCUSS_MCP_TOOL_NAME);
  });

  it("leaves the ordinary Claude argument list untouched", () => {
    const args = claudeArguments(request({ tools: ["read", "bash"] }), {}, undefined, resources);
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain(DISCUSS_MCP_TOOL_NAME);
    expect(args[args.indexOf("--append-system-prompt") + 1] ?? "").not.toContain("Supervisor discussion");
  });
});
