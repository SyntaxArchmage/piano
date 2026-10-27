/**
 * A local question bridge for harnesses that cannot mount an in-process tool.
 *
 * The harness runs our stdio MCP server as a child; that server forwards each
 * `discuss` tool call over a loopback TCP connection to this bridge. The
 * bridge is the only place that knows the attempt's `AgentRequest.discuss`
 * callback, so the TUI and headless channels stay exactly as they are.
 *
 * Loopback + a per-attempt token keep the channel private to this process.
 */
import { randomUUID } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { Effect } from "effect";
import { agentError, type AgentError } from "./errors.js";

export interface DiscussBridge {
  /** `tcp://127.0.0.1:<port>`; the MCP child reads this from its env. */
  readonly url: string;
  /** Per-attempt capability token. */
  readonly token: string;
  close(): Effect.Effect<void, AgentError>;
}

const MAX_QUESTION_CHARS = 16_000;

interface WireRequest {
  readonly token?: unknown;
  readonly question?: unknown;
}

function writeLine(socket: Socket, value: unknown): void {
  if (socket.destroyed) return;
  socket.write(`${JSON.stringify(value)}\n`);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Start the per-attempt bridge. The listener never leaves loopback and the
 * returned `close` destroys every pending socket before closing the server. */
export function startDiscussBridge(
  handler: (question: string) => Effect.Effect<string, unknown>,
): Effect.Effect<DiscussBridge, AgentError> {
  return Effect.tryPromise({
    try: () => new Promise<DiscussBridge>((resolve, reject) => {
      const token = randomUUID();
      const sockets = new Set<Socket>();

      const handleLine = async (socket: Socket, line: string): Promise<void> => {
        let request: WireRequest;
        try {
          request = JSON.parse(line) as WireRequest;
        } catch {
          writeLine(socket, { error: "invalid request" });
          return;
        }
        if (request.token !== token) {
          writeLine(socket, { error: "invalid token" });
          return;
        }
        if (typeof request.question !== "string" || request.question.trim() === "") {
          writeLine(socket, { error: "question must be a non-empty string" });
          return;
        }
        if (request.question.length > MAX_QUESTION_CHARS) {
          writeLine(socket, { error: `question exceeds ${MAX_QUESTION_CHARS} characters` });
          return;
        }
        try {
          const answer = await Effect.runPromise(handler(request.question));
          writeLine(socket, { answer });
        } catch (cause) {
          writeLine(socket, { error: errorMessage(cause) });
        }
      };

      const server = createServer((socket) => {
        sockets.add(socket);
        let buffer = "";
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => {
          buffer += chunk;
          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line !== "") void handleLine(socket, line);
            newline = buffer.indexOf("\n");
          }
        });
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => sockets.delete(socket));
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (typeof address !== "object" || address === null) {
          server.close();
          reject(new Error("discuss bridge did not get a loopback port"));
          return;
        }
        resolve({
          url: `tcp://127.0.0.1:${address.port}`,
          token,
          close: () => Effect.tryPromise({
            try: () => new Promise<void>((closeResolve, closeReject) => {
              for (const socket of sockets) socket.destroy();
              sockets.clear();
              server.close((error) => {
                if (error === undefined) closeResolve();
                else closeReject(error);
              });
            }),
            catch: (cause) => agentError("session-artifact", cause),
          }),
        });
      });
    }),
    catch: (cause) => agentError("session-artifact", cause),
  });
}
