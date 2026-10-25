import { Effect } from "effect";
import { io } from "@piano/base";
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

/** Fetch one URL and render it as the tool's text result. The body is streamed
 * with a byte cap so a huge page cannot flood the model's context. */
function fetchWebPage(
  url: string,
  signal: AbortSignal,
): Effect.Effect<{ readonly type: "tool-result"; readonly content: string }, Error> {
  return Effect.gen(function* () {
    const response = yield* io.fetchCappedText(url, { signal }, WEB_FETCH_MAX_BYTES);
    const contentType = response.contentType;
    const isText = /text|json|xml|javascript|yaml|markdown/i.test(contentType);
    if (!isText) {
      return { type: "tool-result" as const, content: `HTTP ${response.status} — content-type: ${contentType} (binary or non-text; not returned)` };
    }
    if (response.text === "" && !response.truncated) {
      return { type: "tool-result" as const, content: `HTTP ${response.status} — empty body` };
    }
    // io's capped response carries no reason phrase; the status code is the
    // stable part of the header (statusText is empty under HTTP/2 anyway).
    const header = `HTTP ${response.status} — ${url}\n\n`;
    const footer = response.truncated ? `\n\n[truncated at ${WEB_FETCH_MAX_BYTES} bytes]` : "";
    return { type: "tool-result" as const, content: header + response.text + footer };
  });
}

/** Build the customTools array for tools in request.tools that are piano-owned
 * (not built into the Pi SDK). Returns undefined when no custom tools are
 * needed so the caller can skip the option entirely. */
export function buildCustomTools(
  requestTools: readonly string[] | undefined,
  discuss: ((question: string) => Effect.Effect<string, unknown>) | undefined,
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
      execute(
        _toolCallId: string,
        params: { question: string },
      ): Promise<{ type: "tool-result"; content: string }> {
        // The SDK's tool contract is a Promise; the supervisor call itself is
        // Effect-native.
        return Effect.runPromise(Effect.suspend(() => discuss(params.question)).pipe(
          Effect.map((content) => ({ type: "tool-result" as const, content })),
        ));
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
      execute(
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
        // The SDK's tool contract is a Promise; the fetch itself is Effect-native.
        return Effect.runPromise(fetchWebPage(params.url, controller.signal).pipe(
          Effect.catchAll((cause) => Effect.succeed({
            type: "tool-result" as const,
            content: `Error fetching ${params.url}: ${cause instanceof Error ? cause.message : String(cause)}`,
          })),
          Effect.ensuring(Effect.sync(() => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", linked);
          })),
        ));
      },
    });
  }
  return tools;
}

