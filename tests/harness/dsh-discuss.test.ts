import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { AgentRequest } from "../../packages/harness/src/agent-contract.js";
import type { DiscussBridge } from "../../packages/harness/src/discuss-bridge.js";
import { DISCUSS_MCP_ENV_URL } from "../../packages/harness/src/discuss-mcp-config.js";
import {
  dshArguments,
  type LoadedResources,
} from "../../packages/harness/src/harness-argv.js";
import { dshDiscussMcpPath, dshDiscussPatchPath, prepareHarnessHomes } from "../../packages/harness/src/harness-home.js";

const resources: LoadedResources = { contextFiles: [], skills: [] };

function bridge(): DiscussBridge {
  return {
    url: "tcp://127.0.0.1:43210",
    token: "test-token",
    close: () => Effect.void,
  };
}

function request(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    cwd: "/tmp/piano",
    prompt: "design it",
    ...overrides,
  };
}

describe("dsh discuss wiring", () => {
  it("generates the MCP client patch and adds it only for discuss stages", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-dsh-discuss-"));
    try {
      const homes = await Effect.runPromise(
        prepareHarnessHomes({ rootDir: root, models: [] }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const patchPath = dshDiscussPatchPath(homes.paths.dsh);
      const patch = await readFile(patchPath, "utf8");
      expect(patch).toContain("@deepseek-ai/dsh-mcp-client");
      expect(patch).toContain("serverName: piano");
      expect(patch).toContain("transport: stdio");
      expect(patch).toContain(DISCUSS_MCP_ENV_URL);
      expect(patch).toContain("failOnStartupError: true");
      expect(patch).toContain(dshDiscussMcpPath(homes.paths.dsh));
      await expect(readFile(dshDiscussMcpPath(homes.paths.dsh), "utf8")).resolves.toContain("stdio MCP server");

      const discussing = dshArguments(
        request({ discuss: () => Effect.succeed("answer") }),
        {},
        resources,
        homes.paths.dsh,
        undefined,
        bridge(),
      );
      expect(discussing).toContain("--patch");
      expect(discussing).toContain(patchPath);
      expect(discussing.join("\n")).toContain("mcp__piano__discuss");

      const ordinary = dshArguments(request(), {}, resources, homes.paths.dsh);
      expect(ordinary).not.toContain(patchPath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
