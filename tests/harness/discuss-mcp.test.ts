import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { startDiscussBridge } from "../../packages/harness/src/discuss-bridge.js";
import { discussMcpServerPath } from "../../packages/harness/src/discuss-mcp-path.js";

interface JsonRpc {
  readonly id?: number;
  readonly result?: {
    readonly protocolVersion?: string;
    readonly tools?: readonly { readonly name?: string }[];
    readonly content?: readonly { readonly text?: string }[];
    readonly isError?: boolean;
  };
  readonly error?: { readonly message?: string };
}

function startMcp(bridge: { readonly url: string; readonly token: string }): {
  readonly child: ChildProcess;
  readonly next: () => Promise<JsonRpc>;
  readonly send: (message: unknown) => void;
} {
  const child = spawn(process.execPath, [discussMcpServerPath()], {
    env: {
      ...process.env,
      PIANO_DISCUSS_URL: bridge.url,
      PIANO_DISCUSS_TOKEN: bridge.token,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = child.stdout;
  if (stdout === null) throw new Error("MCP child has no stdout");
  const lines = createInterface({ input: stdout, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  return {
    child,
    next: async () => {
      const next = await iterator.next();
      if (next.done) throw new Error("MCP child closed before replying");
      return JSON.parse(next.value) as JsonRpc;
    },
    send: (message) => {
      if (child.stdin === null) throw new Error("MCP child has no stdin");
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
  };
}

describe("discuss MCP bridge", () => {
  it("serves one discuss tool and round-trips the supervisor answer", async () => {
    const bridge = await Effect.runPromise(startDiscussBridge((question) => Effect.succeed(`answer: ${question}`)));
    const mcp = startMcp(bridge);
    try {
      mcp.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
      });
      expect((await mcp.next()).result?.protocolVersion).toBe("2025-06-18");

      mcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      expect((await mcp.next()).result?.tools?.map((tool) => tool.name)).toEqual(["discuss"]);

      mcp.send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "discuss", arguments: { question: "Which path?" } },
      });
      const answer = await mcp.next();
      expect(answer.result?.content?.[0]?.text).toBe("answer: Which path?");
      expect(answer.result?.isError).toBeUndefined();
    } finally {
      mcp.child.kill();
      await Effect.runPromise(bridge.close());
    }
  }, 30_000);

  it("rejects a request with the wrong capability token", async () => {
    const bridge = await Effect.runPromise(startDiscussBridge(() => Effect.succeed("not reached")));
    const target = /^tcp:\/\/([^:]+):(\d+)$/u.exec(bridge.url);
    if (target === null) throw new Error(`unexpected bridge URL: ${bridge.url}`);
    try {
      const socket = createConnection({ host: target[1], port: Number(target[2]) });
      const line = await new Promise<string>((resolve, reject) => {
        let buffer = "";
        socket.setEncoding("utf8");
        socket.on("connect", () => socket.write(`${JSON.stringify({ token: "wrong", question: "hello" })}\n`));
        socket.on("data", (chunk) => {
          buffer += chunk;
          if (buffer.includes("\n")) resolve(buffer.trim());
        });
        socket.on("error", reject);
      });
      expect(JSON.parse(line)).toEqual({ error: "invalid token" });
      socket.destroy();
    } finally {
      await Effect.runPromise(bridge.close());
    }
  }, 30_000);
});
