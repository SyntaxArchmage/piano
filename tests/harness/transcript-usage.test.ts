import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { transcriptTokenUsage } from "../../packages/harness/src/canonical-transcript.js";

const usage = (path: string | undefined) => Effect.runPromise(transcriptTokenUsage(path));

describe("transcriptTokenUsage", () => {
  it("sums the canonical additive counters across every recorded call", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-transcript-usage-"));
    try {
      const path = join(root, "session.jsonl");
      await writeFile(path, [
        JSON.stringify({ message: { role: "assistant", usage: { input: 4, output: 2, cacheRead: 3 } } }),
        JSON.stringify({ message: { role: "assistant", usage: { input: 1, output: 1, cacheWrite: 2 } } }),
        JSON.stringify({ usage: { input: 2, output: 1 } }),
      ].join("\n"), "utf8");
      expect(await usage(path)).toEqual({
        input: 7,
        output: 4,
        cacheRead: 3,
        cacheWrite: 2,
        total: 16,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores a native total that disagrees with the counters", async () => {
    // dsh's `totalTokens` is session-cumulative while its input/output are per
    // call; pi's `totalTokens` is per call. Neither is the sum, so neither is
    // read — the four counters decide.
    const root = await mkdtemp(join(tmpdir(), "piano-transcript-usage-"));
    try {
      const path = join(root, "session.jsonl");
      await writeFile(path, [
        JSON.stringify({ message: { usage: { input: 5, output: 1, totalTokens: 900 } } }),
        JSON.stringify({ message: { usage: { input: 2, output: 1, totalTokens: 903 } } }),
      ].join("\n"), "utf8");
      expect(await usage(path)).toMatchObject({ input: 7, output: 2, total: 9 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not count a BOM-prefixed first record", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-transcript-usage-bom-"));
    try {
      const path = join(root, "bom.jsonl");
      await writeFile(path, `\uFEFF${JSON.stringify({ usage: { input: 5 } })}\n`, "utf8");
      // readFileSync("utf8") kept the BOM, so the first line never parsed.
      expect(await usage(path)).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("is undefined without a file or without any usage record", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-transcript-usage-"));
    try {
      const empty = join(root, "no-usage.jsonl");
      await writeFile(empty, JSON.stringify({ message: { role: "user", content: "go" } }), "utf8");
      expect(await usage(join(root, "missing.jsonl"))).toBeUndefined();
      expect(await usage(empty)).toBeUndefined();
      expect(await usage(undefined)).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});