// One writer per run across processes: a live foreign owner refuses, a dead
// owner is reclaimed, and a same-process reopen (resume) is allowed.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { acquireRunLock } from "../src/index.js";

const lockName = ".piano-run.lock";

async function runDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "piano-run-lock-"));
}

function lockBody(owner: { pid?: number; host?: string; token?: string; startedAt?: string }): string {
  return JSON.stringify({ token: "other", startedAt: new Date().toISOString(), ...owner });
}

describe("acquireRunLock", () => {
  it("lets the same process reopen a run and releases its own lock", async () => {
    const dir = await runDir();
    try {
      const first = await Effect.runPromise(acquireRunLock(dir));
      const second = await Effect.runPromise(acquireRunLock(dir));
      expect(second.path).toBe(first.path);
      await Effect.runPromise(second.release);
      const third = await Effect.runPromise(acquireRunLock(dir));
      await Effect.runPromise(third.release);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a live owner from another pid on this host", async () => {
    const dir = await runDir();
    try {
      // pid 1 is alive on every supported host; EPERM still means alive.
      await writeFile(join(dir, lockName), lockBody({ pid: 1, host: hostname() }), "utf8");
      const failure = await Effect.runPromise(Effect.flip(acquireRunLock(dir)));
      expect(failure).toMatchObject({ _tag: "RunLockedError", ownerPid: 1 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reclaims a dead pid and a stale foreign host", async () => {
    const dir = await runDir();
    try {
      await writeFile(join(dir, lockName), lockBody({ pid: 999_999, host: hostname() }), "utf8");
      const reclaimed = await Effect.runPromise(acquireRunLock(dir));
      await Effect.runPromise(reclaimed.release);

      const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      await writeFile(join(dir, lockName), lockBody({ pid: 1, host: "other-host", startedAt: old }), "utf8");
      const foreign = await Effect.runPromise(acquireRunLock(dir));
      await Effect.runPromise(foreign.release);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a fresh lock from another host", async () => {
    const dir = await runDir();
    try {
      await writeFile(join(dir, lockName), lockBody({ pid: 1, host: "other-host" }), "utf8");
      const failure = await Effect.runPromise(Effect.flip(acquireRunLock(dir)));
      expect(failure).toMatchObject({ _tag: "RunLockedError", ownerHost: "other-host" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
