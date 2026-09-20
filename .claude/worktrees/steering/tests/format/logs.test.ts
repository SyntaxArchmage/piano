import { describe, expect, it } from "vitest";
import { formatLog, formatTrace } from "../../packages/cli/src/logs.js";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

describe("logs and trace formatting ", () => {
  it("renders a log record as a readable line", () => {
    const rendered = formatLog(JSON.stringify({
      timestamp: "2026-08-21T10:32:07.123Z",
      severity: "warn",
      stage: "model",
      event: "request.retry",
      outcome: "failure",
      message: "Retrying model request",
      attributes: { attempt: 2, reason: "timeout" },
    }));
    const clean = rendered.replace(ANSI, "");
    expect(clean).toMatch(/^\d{4}-\d{2}-\d{2}\x20\d{2}:32:07\.123\x20UTC[+-]\d{2}:\d{2}\x20WARN\x20{2}piano\x20request\.retry\x20—\x20Retrying model request\x20\[stage=model outcome=failure\]\x20attempt=2\x20reason=timeout$/);
  });

  it("renders trace records as an indented operation tree", () => {
    const rendered = formatTrace(JSON.stringify({
      timestamp: "2026-08-21T10:32:07.123Z",
      depth: 1,
      event: "exit",
      fn: "loadConfig",
      duration_ms: 12,
    }));
    expect(rendered.replace(ANSI, "")).toMatch(/^\x20{2}\d{4}-\d{2}-\d{2}\x20\d{2}:32:07\.123\x20UTC[+-]\d{2}:\d{2}\x20✓\x20loadConfig\x20\(12ms\)$/);
  });

  it("keeps malformed trace depths from breaking formatting", () => {
    const negative = formatTrace(JSON.stringify({
      timestamp: "2026-08-21T10:32:07.123Z",
      depth: -1,
      event: "enter",
      fn: "negativeDepth",
    })).replace(ANSI, "");
    const nonFinite = formatTrace('{"timestamp":"2026-08-21T10:32:07.123Z","depth":1e309,"event":"exit","fn":"infiniteDepth"}')
      .replace(ANSI, "");
    const fractional = formatTrace(JSON.stringify({
      timestamp: "2026-08-21T10:32:07.123Z",
      depth: 1.5,
      event: "exit",
      fn: "fractionalDepth",
    })).replace(ANSI, "");

    expect(negative).toMatch(/^\d{4}-\d{2}-\d{2}\x20/);
    expect(nonFinite).toMatch(/^\d{4}-\d{2}-\d{2}\x20/);
    expect(fractional).toMatch(/^\x20{2}\d{4}-\d{2}-\d{2}\x20/);
  });

  it("renders source location for logs and traces", () => {
    const log = formatLog(JSON.stringify({
      timestamp: "2026-08-21T10:32:07.123Z",
      module: "cli",
      file: "main.ts",
      function: "main",
      event: "cli.started",
    }));
    const trace = formatTrace(JSON.stringify({
      ts: "2026-08-21T10:32:07.123Z",
      module: "logging",
      file: "session.ts",
      depth: 0,
      event: "enter",
      fn: "createSession",
    }));
    expect(log.replace(ANSI, "")).toContain("cli/main.ts::main");
    expect(log.replace(ANSI, "")).toContain("cli.started");
    expect(trace.replace(ANSI, "")).toContain("logging/session.ts::createSession");
  });

  it("renders structured failures without dumping raw JSON", () => {
    const rendered = formatLog(JSON.stringify({
      timestamp: "2026-08-21T10:32:07.123Z",
      level: "error",
      event: "function.error",
      attributes: { error: { type: "AgentError", kind: "model-not-found", message: "model not found" } },
    }));
    expect(rendered.replace(ANSI, "")).toContain("error=AgentError[model-not-found]: model not found");
    expect(rendered.replace(ANSI, "")).not.toContain('"type":"AgentError"');
  });

  it("escapes payload newlines to keep log events on one line", () => {
    const rendered = formatLog(JSON.stringify({
      timestamp: "2026-08-21T10:32:07.123Z",
      severity: "error",
      event: "agent.turn.failed",
      message: "multi\nline\tmessage",
      attributes: { reason: "line1\nline2" },
    }));
    const clean = rendered.replace(ANSI, "");
    expect(clean).toContain("multi\\nline\\tmessage");
    expect(clean).toContain("reason=line1\\nline2");
    expect(clean.split("\n")).toHaveLength(1);
  });

  it("escapes control characters in attribute names", () => {
    const rendered = formatLog(JSON.stringify({
      timestamp: "2026-08-21T10:32:07.123Z",
      event: "agent.turn.failed",
      attributes: { "line\n\tkey": "value" },
    }));
    const clean = rendered.replace(ANSI, "");
    expect(clean).toContain("line\\n\\tkey=value");
    expect(clean.split("\n")).toHaveLength(1);
  });
});
