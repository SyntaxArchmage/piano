/**
 * A local question bridge for harnesses that cannot mount an in-process tool.
 *
 * The harness runs our stdio MCP server as a child; that server forwards each
 * `discuss` tool call over a loopback TCP connection to this bridge. The
 * bridge is the only place that knows the request's `AgentRequest.discuss`
 * callback, so the TUI and headless channels stay exactly as they are.
 *
 * Loopback + a per-request token keep the channel private to this process.
 */
import { randomUUID } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { Effect, Fiber } from "effect";
import { errorMessage } from "@piano/base";
import { agentError, type AgentError } from "./errors.js";
import { asRecord, nonEmptyString } from "./json-narrowing.js";

export interface DiscussBridge {
  /** `tcp://127.0.0.1:<port>`; the MCP child reads this from its env. */
  readonly url: string;
  /** Per-request capability token. */
  readonly token: string;
  close(): Effect.Effect<void>;
}

/** Mirrored by `discuss-mcp.mjs`; the MCP server owns the user-facing message,
 * while this bound is the last defense at the local trust boundary. */
const MAX_QUESTION_CHARS = 16_000;

function writeLine(socket: Socket, value: unknown): void {
  if (socket.destroyed) return;
  socket.write(`${JSON.stringify(value)}\n`);
}

/** Start the per-request bridge. The listener never leaves loopback and the
 * returned `close` interrupts any in-flight handler, then closes every socket. */
export function startDiscussBridge(
  handler: (question: string) => Effect.Effect<string, unknown>,
): Effect.Effect<DiscussBridge, AgentError> {
  return Effect.tryPromise({
    try: () => new Promise<DiscussBridge>((resolve, reject) => {
      const token = randomUUID();
      const handlers = new Set<Fiber.RuntimeFiber<string, unknown>>();
      const sockets = new Set<Socket>();

      const handleLine = async (socket: Socket, line: string): Promise<void> => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          writeLine(socket, { error: "invalid request" });
          return;
        }
        const request = asRecord(parsed);
        if (nonEmptyString(request?.token) !== token) {
          writeLine(socket, { error: "invalid token" });
          return;
        }
        const question = nonEmptyString(request?.question);
        if (question === undefined || question.trim() === "") {
          writeLine(socket, { error: "question must be a non-empty string" });
          return;
        }
        if (question.length > MAX_QUESTION_CHARS) {
          writeLine(socket, { error: `question exceeds ${MAX_QUESTION_CHARS} characters` });
          return;
        }
        const fiber = Effect.runFork(handler(question));
        handlers.add(fiber);
        try {
          const answer = await Effect.runPromise(Fiber.join(fiber));
          writeLine(socket, { answer });
        } catch (cause) {
          writeLine(socket, { error: errorMessage(cause) });
        } finally {
          handlers.delete(fiber);
        }
      };

      const server = createServer((socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => sockets.delete(socket));
        const lines = createInterface({ input: socket, crlfDelay: Infinity });
        lines.on("line", (line) => {
          const trimmed = line.trim();
          if (trimmed !== "") void handleLine(socket, trimmed);
        });
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
          close: () => Effect.promise(() => new Promise<void>((closeResolve) => {
            for (const fiber of handlers) Effect.runFork(Fiber.interrupt(fiber));
            handlers.clear();
            for (const socket of sockets) socket.destroy();
            sockets.clear();
            server.close(() => closeResolve());
          })),
        });
      });
    }),
    catch: (cause) => agentError("session-artifact", cause),
  });
}
