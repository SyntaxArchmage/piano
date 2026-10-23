import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bindEvents, cumulativeUsageFromTranscript } from "../../packages/harness/src/pi-session-events.js";
import type { AgentEvent } from "../../packages/harness/src/events.js";

function collector(): { accumulator: { text: string }; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  return { accumulator: { text: "" }, events };
}

describe("pi session usage snapshots", () => {
  it("emits server-side cumulative usage per message, not per-call values", () => {
    const { accumulator, events } = collector();
    const handler = bindEvents({ onEvent: (event: AgentEvent) => events.push(event) } as never, accumulator);
    handler({ type: "message_end", message: { role: "assistant", content: "", usage: { input: 10, output: 2 } } });
    handler({ type: "message_end", message: { role: "assistant", content: "", usage: { input: 5, output: 1 } } });
    expect(events.filter((event) => event.type === "usage").map((event) => event.usage)).toEqual([
      { input: 10, output: 2 },
      { input: 15, output: 3 },
    ]);
  });

  it("seeds from a prior session transcript so resumed turns stay cumulative", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-usage-"));
    try {
      const path = join(root, "session.jsonl");
      await writeFile(path, [
        JSON.stringify({ message: { role: "assistant", usage: { input: 4, output: 2, cacheRead: 3 } } }),
        JSON.stringify({ message: { role: "assistant", usage: { input: 1, output: 1, cacheWrite: 2 } } }),
      ].join("\n"), "utf8");
      expect(cumulativeUsageFromTranscript(path)).toMatchObject({
        input: 5,
        output: 3,
        cacheRead: 3,
        cacheWrite: 2,
      });
      expect(cumulativeUsageFromTranscript(join(root, "missing.jsonl"))).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
