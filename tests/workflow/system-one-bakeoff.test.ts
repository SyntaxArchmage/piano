import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  FakeSystemOneProvider,
  type SystemOneChoiceQuestion,
  type SystemOneRequest,
} from "../../packages/orchestrator/src/index.js";

interface ProfilingCase {
  readonly id: string;
  readonly state: Readonly<Record<string, unknown>>;
  readonly expected: string;
}

interface ProfilingFixture {
  readonly question: Readonly<Record<string, SystemOneChoiceQuestion>>;
  readonly cases: readonly ProfilingCase[];
}

const fixtureUrl = new URL("../fixtures/system-one/profiling-cases.json", import.meta.url);

describe("System One profiling bake-off fixture", () => {
  it("keeps every case answerable by the neutral choice contract", async () => {
    const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as ProfilingFixture;
    expect(fixture.cases.length).toBeGreaterThan(0);
    for (const entry of fixture.cases) {
      expect(entry.id).not.toBe("");
      expect(Object.hasOwn(fixture.question.action?.criteria ?? {}, entry.expected)).toBe(true);
      const provider = new FakeSystemOneProvider({ action: entry.expected });
      const response = await Effect.runPromise(provider.decide({
        state: entry.state,
        questions: fixture.question,
      } satisfies SystemOneRequest));
      expect(response.answers.action?.choice, entry.id).toBe(entry.expected);
      expect(response.answers.action?.probabilities[entry.expected], entry.id).toBe(1);
    }
  });
});
