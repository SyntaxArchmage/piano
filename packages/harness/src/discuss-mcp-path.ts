import { fileURLToPath } from "node:url";

/** Location of the stdio MCP server the Claude/dsh children launch. In a
 * source checkout this sits beside the module; the CLI bundle copies it next
 * to `piano.js` so the same URL resolves in an installed build. */
export function discussMcpServerPath(): string {
  return fileURLToPath(new URL("./discuss-mcp.mjs", import.meta.url));
}
