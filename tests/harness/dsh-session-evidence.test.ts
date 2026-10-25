// The dsh evidence boundary is an Effect that never fails: a missing home and
// an unreadable artifact both mean "no evidence", so an interrupted turn keeps
// the records it tailed itself.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { readDshSessionEvidence } from "../../packages/harness/src/dsh-session-storage.js";

describe("readDshSessionEvidence", () => {
  it("treats a missing storage home as absent evidence", async () => {
    const home = join(tmpdir(), `piano-dsh-missing-${Date.now()}`);
    await expect(Effect.runPromise(readDshSessionEvidence(home, "/tmp", Date.now()))).resolves.toBeUndefined();
  });
});
