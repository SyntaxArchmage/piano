// The local service is started once on demand, and the provider speaks
// /v1/systemone only after /health is up. The launcher here is a real detached
// Node process so the test covers spawn, health polling, and the HTTP client.
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  LayaProvider,
  ensureLayaEndpoint,
  type SystemOneRequest,
} from "../src/index.js";

const saved = {
  url: process.env.PIANO_LAYA_URL,
  bin: process.env.PIANO_LAYA_BIN,
  pidFile: process.env.FAKE_LAYA_PID_FILE,
};

afterEach(() => {
  if (saved.url === undefined) delete process.env.PIANO_LAYA_URL;
  else process.env.PIANO_LAYA_URL = saved.url;
  if (saved.bin === undefined) delete process.env.PIANO_LAYA_BIN;
  else process.env.PIANO_LAYA_BIN = saved.bin;
  if (saved.pidFile === undefined) delete process.env.FAKE_LAYA_PID_FILE;
  else process.env.FAKE_LAYA_PID_FILE = saved.pidFile;
});

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing test port");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const LAUNCHER = `#!/usr/bin/env node
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
if (process.env.FAKE_LAYA_PID_FILE) writeFileSync(process.env.FAKE_LAYA_PID_FILE, String(process.pid));
createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (request.url === "/v1/systemone") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      answers: {
        action: {
          type: "choice",
          choice: "skip",
          probabilities: { run: 0.1, skip: 0.9 },
          confidence: 0.9,
        },
      },
    }));
    return;
  }
  response.writeHead(404);
  response.end();
}).listen(Number(process.env.LAYA_PORT), process.env.LAYA_HOST);
`;

const REQUEST: SystemOneRequest = {
  state: { stage: "profile" },
  questions: {
    action: {
      type: "choice",
      instructions: "Run or skip?",
      criteria: { run: "run", skip: "skip" },
    },
  },
};

describe("Laya local service", () => {
  it("starts the launcher, waits for health, and serves a decision", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-laya-"));
    const launcher = join(root, "fake-laya.mjs");
    const pidFile = join(root, "pid");
    const port = await freePort();
    const endpoint = `http://127.0.0.1:${port}`;
    await writeFile(launcher, LAUNCHER);
    await chmod(launcher, 0o755);
    process.env.PIANO_LAYA_URL = endpoint;
    process.env.PIANO_LAYA_BIN = launcher;
    process.env.FAKE_LAYA_PID_FILE = pidFile;
    let pid: number | undefined;
    try {
      await expect(Effect.runPromise(ensureLayaEndpoint(endpoint))).resolves.toBe(endpoint);
      const response = await Effect.runPromise(new LayaProvider(endpoint).decide(REQUEST));
      expect(response.answers.action?.choice).toBe("skip");
      pid = Number(await readFile(pidFile, "utf8"));
      expect(pid).toBeGreaterThan(0);
    } finally {
      if (pid !== undefined) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // The child already exited.
        }
      }
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
