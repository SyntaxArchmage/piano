import { describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { Effect } from "effect";
import {
  PI_WEB_SEARCH_TOOL_NAME,
  piWebSearchExtensionPath,
  runPiWebSearch,
  webSearchExtensionFactory,
} from "../../packages/harness/src/index.js";

interface CapturedTool {
  readonly name: string;
  readonly parameters: { readonly properties?: Record<string, unknown> };
}

function searchResponse(content: unknown[]): Response {
  return new Response(JSON.stringify({ content }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("pi web_search extension", () => {
  it("registers the native tool and exposes a loadable CLI extension", () => {
    const registered: CapturedTool[] = [];
    webSearchExtensionFactory({ baseUrl: "https://gw.example/v1", apiKey: "key", model: "model-a" })({
      registerTool: (definition) => registered.push(definition as unknown as CapturedTool),
    });
    expect(registered).toHaveLength(1);
    expect(registered[0]?.name).toBe(PI_WEB_SEARCH_TOOL_NAME);
    expect(registered[0]?.parameters.properties).toHaveProperty("query");
    expect(existsSync(piWebSearchExtensionPath)).toBe(true);
  });

  it("sends one server-tool request and normalizes cited results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse([
      { type: "text", citations: [{ url: "https://example.com/a", cited_text: "cited snippet" }] },
      {
        type: "web_search_tool_result",
        content: [
          { type: "web_search_result", url: "https://example.com/a", title: "GPU Glossary" },
          { type: "web_search_result", url: "https://example.com/a", title: "duplicate" },
          { type: "web_search_result", url: "https://example.com/b", title: "Second source" },
        ],
      },
    ]));
    vi.stubGlobal("fetch", fetchMock);
    const text = await Effect.runPromise(runPiWebSearch({ baseUrl: "https://gw.example/v1/", apiKey: "key", model: "model-a" }, "tuned gemm kernel"));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://gw.example/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("key");
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(init.body)) as { tools: unknown; messages: unknown; model: string };
    // The configured model, never a hardcoded fallback: the search runs on the
    // same gateway route as chat.
    expect(body.model).toBe("model-a");
    expect(body.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]);
    expect(JSON.stringify(body.messages)).toContain("tuned gemm kernel");
    expect(text).toContain("1. GPU Glossary\n   https://example.com/a\n   cited snippet");
    expect(text).toContain("2. Second source\n   https://example.com/b");
    expect(text).not.toContain("duplicate");
  });

  it("surfaces HTTP and provider errors instead of fabricating an empty result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no such tool", { status: 400 })));
    const httpError = await Effect.runPromise(Effect.flip(
      runPiWebSearch({ baseUrl: "https://gw.example/v1", apiKey: "key", model: "model-a" }, "q"),
    ));
    expect(httpError.message).toMatch(/HTTP 400.*no such tool/s);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "gateway down" } }),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
    const providerError = await Effect.runPromise(Effect.flip(
      runPiWebSearch({ baseUrl: "https://gw.example/v1", apiKey: "key", model: "model-a" }, "q"),
    ));
    expect(providerError.message).toMatch(/provider error.*gateway down/s);
  });

  it("rejects a missing endpoint, credential, or model", async () => {
    const unconfigured = [
      {},
      { baseUrl: "https://gw.example/v1" },
      { baseUrl: "https://gw.example/v1", apiKey: "key" },
    ];
    for (const options of unconfigured) {
      const error = await Effect.runPromise(Effect.flip(runPiWebSearch(options, "q")));
      expect(error.message).toMatch(/not configured/);
    }
  });
});
