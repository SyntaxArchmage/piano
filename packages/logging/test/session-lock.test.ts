// createSession is the single place a run is opened, so the cross-process
// writer guard lives there: a live foreign owner refuses the open, a dead one
// is reclaimed.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createSession } from "../src/index.js";

const lockName = ".piano-run.lock";

function open(root: string, runsRoot: string, id: string) {
  return createSession({ root, cwd: root, runsRoot, id }).pipe(Effect.provide(NodeFileSystem.layer));
}

describe("createSession run lock", () => {
  it("refuses a live owner from another pid and reclaims a dead one", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-lock-"));
    try {
      const runsRoot = join(root, "runs");
      const runDir = join(runsRoot, "locked");
      await writeFile(join(root, "sentinel"), "", "utf8").catch(() => undefined);
      // Create the directory the way a previous process would have.
      await Effect.runPromise(open(root, runsRoot, "locked"));
      await writeFile(join(runDir, lockName), JSON.stringify({ pid: 1, host: hostname(), token: "other" }), "utf8");

      const refused = await Effect.runPromise(Effect.flip(open(root, runsRoot, "locked")));
      expect(refused).toMatchObject({ _tag: "SessionCreateError", operation: "lock" });

      await writeFile(join(runDir, lockName), JSON.stringify({ pid: 999_999, host: hostname(), token: "dead" }), "utf8");
      await expect(Effect.runPromise(open(root, runsRoot, "locked"))).resolves.toMatchObject({ id: "locked" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
