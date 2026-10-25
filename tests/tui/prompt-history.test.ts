import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  appendPromptHistory,
  loadPromptHistory,
  PROMPT_HISTORY_MAX,
  promptHistoryPath,
} from "../../packages/cli/src/prompt-history.js";

const load = (root: string): Promise<string[]> => Effect.runPromise(loadPromptHistory(root));
const append = (root: string, text: string): Promise<void> => Effect.runPromise(appendPromptHistory(root, text));

describe("prompt-history", () => {
  // Isolated root per test so appends never touch the developer's real ~/.piano.
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "piano-hist-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("loadPromptHistory returns [] when no file exists", async () => {
    expect(await load(root)).toEqual([]);
  });

  it("append + load roundtrip returns entries oldest → newest", async () => {
    await append(root, "first");
    await append(root, "second");
    expect(await load(root)).toEqual(["first", "second"]);
  });

  it("consecutive duplicate append is a no-op", async () => {
    await append(root, "hello");
    await append(root, "hello");
    expect(await load(root)).toEqual(["hello"]);
  });

  it(`keeps only the last ${PROMPT_HISTORY_MAX} entries`, async () => {
    for (let i = 0; i < PROMPT_HISTORY_MAX + 5; i++) {
      await append(root, `entry ${i}`);
    }
    const entries = await load(root);
    expect(entries).toHaveLength(PROMPT_HISTORY_MAX);
    expect(entries[0]).toBe("entry 5");
    expect(entries[entries.length - 1]).toBe(`entry ${PROMPT_HISTORY_MAX + 4}`);
  });

  it("caps entries loaded from an oversized persisted file", async () => {
    writeFileSync(
      promptHistoryPath(root),
      Array.from({ length: PROMPT_HISTORY_MAX + 5 }, (_, index) => `entry ${index}`).join("\n"),
    );
    const entries = await load(root);
    expect(entries).toHaveLength(PROMPT_HISTORY_MAX);
    expect(entries[0]).toBe("entry 5");
    expect(entries.at(-1)).toBe(`entry ${PROMPT_HISTORY_MAX + 4}`);
  });

  it("sanitizes newlines into spaces", async () => {
    await append(root, "line1\nline2");
    expect(await load(root)).toEqual(["line1 line2"]);
  });

  it("empty or whitespace-only appends are not written", async () => {
    await append(root, "");
    await append(root, "   \n  ");
    expect(existsSync(promptHistoryPath(root))).toBe(false);
  });
});
