// The interruption finalizer must not settle before the detached harness tree
// is gone: the CLI runtime exits as soon as the effect settles, so returning
// immediately would leave the child (and its tools) as an orphan.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { runChild } from "../../packages/harness/src/child-process.js";

const exec = promisify(execFile);

describe("runChild interruption", () => {
  it("waits for a TERM-ignoring child to die before the effect settles", async () => {
    const marker = `piano-child-interrupt-${process.pid}-${Date.now()}`;
    const request = {
      cwd: process.cwd(),
      signal: new AbortController().signal,
      prompt: "",
      tools: [],
    } as unknown as Parameters<typeof runChild>[2];
    const fiber = Effect.runFork(runChild(
      "bash",
      ["-lc", `trap '' TERM; exec -a ${marker} sleep 30`],
      request,
      () => {},
      process.env,
    ));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const started = Date.now();
    await Effect.runPromise(Fiber.interrupt(fiber));
    const elapsed = Date.now() - started;
    // TERM is ignored, so the bounded SIGKILL path runs before settling.
    expect(elapsed).toBeGreaterThanOrEqual(1_900);
    await expect(exec("pgrep", ["-f", marker])).rejects.toBeDefined();
  }, 10_000);
});
