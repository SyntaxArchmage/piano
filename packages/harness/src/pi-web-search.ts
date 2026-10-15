import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";

/** Pi has no built-in web search. Piano exposes the same `web_search` id used
 * by dsh by forwarding one Anthropic server-tool request to the configured
 * gateway. The extension is loaded explicitly only for stages that declare
 * the tool, both by the Pi SDK and by pi-cli. */
export const PI_WEB_SEARCH_TOOL_NAME = "web_search";

/** The path handed to pi-cli's `--extension` option: the extension must be a
 * file pi-cli can load on its own. From sources this module is that file. Inside
 * the prebuilt CLI bundle this code travels in the bundle and the extension is
 * the sidecar the build emits beside it, named the same as this file —
 * `packages/cli/scripts/cli-bundle.mjs` owns that name. */
export const piWebSearchExtensionPath = (() => {
  const self = fileURLToPath(import.meta.url);
  const sidecar = join(dirname(self), "pi-web-search.js");
  return existsSync(sidecar) ? sidecar : self;
})();

const DEFAULT_API_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_MAX_USES = 5;
const SEARCH_TIMEOUT_MS = 60_000;

export interface PiWebSearchOptions {
  /** Anthropic-messages base; the request is sent to `{baseUrl}/messages`. */
  readonly baseUrl?: string;
  readonly apiKey?: string;
  /** The configured model. Required: the search runs against the same gateway
   * route as chat, so a hardcoded fallback model could name one the gateway
   * does not serve. */
  readonly model?: string;
}

interface SearchResponseBlock {
  readonly type?: unknown;
  readonly citations?: readonly {
    readonly url?: unknown;
    readonly cited_text?: unknown;
  }[];
  readonly content?: readonly {
    readonly type?: unknown;
    readonly url?: unknown;
    readonly title?: unknown;
  }[];
}

function normalizeSearchResponse(blocks: readonly SearchResponseBlock[] | undefined): string {
  const snippets = new Map<string, string>();
  for (const block of blocks ?? []) {
    if (block.type !== "text") continue;
    for (const citation of block.citations ?? []) {
      if (
        typeof citation.url === "string" && citation.url !== ""
        && typeof citation.cited_text === "string" && citation.cited_text !== ""
        && !snippets.has(citation.url)
      ) {
        snippets.set(citation.url, citation.cited_text);
      }
    }
  }

  const lines: string[] = [];
  const seen = new Set<string>();
  for (const block of blocks ?? []) {
    if (block.type !== "web_search_tool_result") continue;
    for (const item of block.content ?? []) {
      if (
        item.type !== "web_search_result"
        || typeof item.url !== "string"
        || item.url === ""
        || seen.has(item.url)
      ) continue;
      seen.add(item.url);
      const title = typeof item.title === "string" && item.title !== "" ? item.title : item.url;
      const snippet = snippets.get(item.url);
      lines.push(`${lines.length + 1}. ${title}\n   ${item.url}${snippet === undefined ? "" : `\n   ${snippet}`}`);
    }
  }
  return lines.length > 0 ? lines.join("\n\n") : "The search returned no results.";
}

/** Execute one server-side web search and return a compact, cited result list. */
export async function runPiWebSearch(
  options: PiWebSearchOptions,
  query: string,
  signal?: AbortSignal,
): Promise<string> {
  const baseUrl = options.baseUrl?.trim().replace(/\/+$/u, "");
  const model = options.model?.trim();
  if (baseUrl === undefined || baseUrl === "" || options.apiKey === undefined || options.apiKey === ""
    || model === undefined || model === "") {
    throw new Error("web_search is not configured: the configured endpoint, API key, or model is missing");
  }

  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  const searchSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  const response = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    redirect: "error",
    headers: {
      "x-api-key": options.apiKey,
      authorization: `Bearer ${options.apiKey}`,
      "anthropic-version": DEFAULT_API_VERSION,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
      messages: [{
        role: "user",
        content: [{ type: "text", text: `Perform a web search for the query: ${query}` }],
      }],
      tools: [{
        type: "web_search_20250305",
        name: "web_search",
        max_uses: DEFAULT_MAX_USES,
      }],
    }),
    signal: searchSignal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`web_search request failed (HTTP ${response.status}): ${detail.slice(0, 400)}`);
  }

  const data = await response.json() as {
    readonly type?: unknown;
    readonly error?: unknown;
    readonly content?: readonly SearchResponseBlock[];
  };
  if (data.type === "error" || data.error !== undefined) {
    throw new Error(`web_search provider error: ${JSON.stringify(data.error ?? data).slice(0, 400)}`);
  }
  return normalizeSearchResponse(data.content);
}

interface PiExtensionRegistrar {
  registerTool(definition: {
    readonly name: string;
    readonly label: string;
    readonly description: string;
    readonly promptSnippet: string;
    readonly promptGuidelines: readonly string[];
    readonly parameters: unknown;
    execute(
      toolCallId: string,
      params: { query: string },
      signal?: AbortSignal,
    ): Promise<{ content: { type: "text"; text: string }[]; details: Record<string, unknown> }>;
  }): void;
}

/** Build the Pi extension factory for either the in-process or CLI load path. */
export function webSearchExtensionFactory(options: PiWebSearchOptions) {
  return (pi: PiExtensionRegistrar): void => {
    pi.registerTool({
      name: PI_WEB_SEARCH_TOOL_NAME,
      label: "Web Search",
      description: "Search the web for current information and return result titles, URLs, and cited excerpts.",
      promptSnippet: "Search the web for current external information",
      promptGuidelines: ["Use web_search when the task needs facts, references, or current information outside the workspace."],
      parameters: Type.Object({
        query: Type.String({ description: "The search query" }),
      }),
      async execute(_toolCallId, params, signal) {
        const text = await runPiWebSearch(options, params.query, signal);
        return { content: [{ type: "text", text }], details: { query: params.query } };
      },
    });
  };
}

/** pi-cli loads this module inside the child process after Piano has populated
 * the endpoint and credential environment variables. */
export default webSearchExtensionFactory({
  baseUrl: process.env.PI_BASE_URL,
  apiKey: process.env.PI_API_KEY,
  model: process.env.PI_MODEL,
});
