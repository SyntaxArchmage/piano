import { discussMcpServerPath } from "./discuss-mcp-path.js";

/** Environment variables the stdio MCP server reads for its bridge. Kept here
 * so the Claude config, dsh patch, and attempt environment cannot drift. */
export const DISCUSS_MCP_ENV_URL = "PIANO_DISCUSS_URL";
export const DISCUSS_MCP_ENV_TOKEN = "PIANO_DISCUSS_TOKEN";

export interface DiscussMcpEndpoint {
  readonly url: string;
  readonly token: string;
}

export interface DiscussMcpServerConfig {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/** The stdio server descriptor both harnesses launch. The dsh patch renders
 * the same command/path/env names with YAML `!!js` expressions. */
export function discussMcpServerConfig(endpoint: DiscussMcpEndpoint): DiscussMcpServerConfig {
  return {
    command: process.execPath,
    args: [discussMcpServerPath()],
    env: {
      [DISCUSS_MCP_ENV_URL]: endpoint.url,
      [DISCUSS_MCP_ENV_TOKEN]: endpoint.token,
    },
  };
}
