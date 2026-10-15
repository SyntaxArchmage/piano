import { PI_CUSTOM_TOOL_NAMES } from "./tool-names.js";

/**
 * The tools Piano implements for the in-process Pi adapter.
 *
 * Pi ships a fixed set of built-in tools; these two are ours. `discuss` hands
 * a question to the supervisor through a callback the workflow supplies, and
 * `web_fetch` is a bounded fetch with its own truncation, timeout and abort
 * wiring — which is why it lives here rather than inline in the session setup:
 * it is a small piece of I/O with its own failure modes, not a line of
 * adapter glue.
 *
 * Both are passed to the SDK as `customTools`, and only for the stages that
 * name them.
 */

/** Max bytes of response body returned to the model; avoids flooding context. */
const WEB_FETCH_MAX_BYTES = 200_000;

/** Build the customTools array for tools in request.tools that are piano-owned
 * (not built into the Pi SDK). Returns undefined when no custom tools are
 * needed so the caller can skip the option entirely. */
export function buildCustomTools(
  requestTools: readonly string[] | undefined,
  discuss: ((question: string) => Promise<string>) | undefined,
): object[] | undefined {
  const active = PI_CUSTOM_TOOL_NAMES.filter(
    (name) => requestTools === undefined || requestTools.includes(name),
  );
  if (active.length === 0 && discuss === undefined) return undefined;
  const tools: object[] = [];

  if (discuss !== undefined) {
    tools.push({
      name: "discuss",
      label: "Discuss with supervisor",
      description: "Ask the supervisor one focused question. The answer is guidance, not approval; continue the task after receiving it.",
      parameters: {
        type: "object",
        required: ["question"],
        properties: {
          question: { type: "string", description: "One focused question for the supervisor." },
        },
      },
      async execute(
        _toolCallId: string,
        params: { question: string },
      ): Promise<{ type: "tool-result"; content: string }> {
        return { type: "tool-result", content: await discuss(params.question) };
      },
    });
  }

  if (active.includes("web_fetch")) {
    tools.push({
      name: "web_fetch",
      label: "Web Fetch",
      description: "Fetch a URL and return its text content. Use for reading documentation, APIs, or web pages.",
      parameters: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", description: "The URL to fetch." },
          timeout_ms: { type: "number", description: "Request timeout in milliseconds. Default: 15000." },
        },
      },
      async execute(
        _toolCallId: string,
        params: { url: string; timeout_ms?: number },
        signal: AbortSignal | undefined,
      ): Promise<{ type: "tool-result"; content: string }> {
        const timeoutMs = typeof params.timeout_ms === "number" && params.timeout_ms > 0
          ? params.timeout_ms
          : 15_000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const linked = (): void => controller.abort();
        signal?.addEventListener("abort", linked, { once: true });
        try {
          const response = await fetch(params.url, { signal: controller.signal });
          const contentType = response.headers.get("content-type") ?? "";
          const isText = /text|json|xml|javascript|yaml|markdown/i.test(contentType);
          if (!isText) {
            return { type: "tool-result", content: `HTTP ${response.status} — content-type: ${contentType} (binary or non-text; not returned)` };
          }
          const reader = response.body?.getReader();
          if (reader === undefined) {
            return { type: "tool-result", content: `HTTP ${response.status} — empty body` };
          }
          const chunks: Uint8Array[] = [];
          let total = 0;
          let truncated = false;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (total + value.byteLength > WEB_FETCH_MAX_BYTES) {
              chunks.push(value.slice(0, WEB_FETCH_MAX_BYTES - total));
              truncated = true;
              break;
            }
            chunks.push(value);
            total += value.byteLength;
          }
          reader.cancel().catch(() => undefined);
          const text = new TextDecoder().decode(
            chunks.reduce((a, b) => {
              const merged = new Uint8Array(a.byteLength + b.byteLength);
              merged.set(a);
              merged.set(b, a.byteLength);
              return merged;
            }, new Uint8Array(0)),
          );
          const header = `HTTP ${response.status} ${response.statusText} — ${params.url}\n\n`;
          const footer = truncated ? `\n\n[truncated at ${WEB_FETCH_MAX_BYTES} bytes]` : "";
          return { type: "tool-result", content: header + text + footer };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { type: "tool-result", content: `Error fetching ${params.url}: ${msg}` };
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener("abort", linked);
        }
      },
    });
  }
  return tools;
}

