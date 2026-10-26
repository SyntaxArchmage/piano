import { createServer } from "node:http";
import { once } from "node:events";
import { Either, Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  compileWorkflow,
  decideProfilingSkip,
  FakeSystemOneProvider,
  HttpSystemOneProvider,
  parseWorkflow,
  type ProfilingSkipState,
  type SystemOneProvider,
  type SystemOneRequest,
} from "../../packages/orchestrator/src/index.js";

const SOURCE = "/tmp/system-one.yaml";

const LOOP_WITH_DECISION = `version: 3
workflow:
  name: system-one-loop
  nodes:
    - loop:
        name: tune
        from: []
        entry: profile
        exit: measure
        iterations: 1
        nodes:
          - stage:
              name: profile
              worker: basic
              from: []
              skippable: true
              decision:
                model: fake
                timeout: 5
          - stage:
              name: measure
              worker: basic
              from: [profile]
`;

const TOP_LEVEL_DECISION = `version: 3
workflow:
  name: system-one-root
  nodes:
    - stage:
        name: profile
        worker: basic
        from: []
        skippable: true
`;

const REQUEST: SystemOneRequest = {
  state: { iteration: 2, queueDepth: 1 },
  questions: {
    action: {
      type: "choice",
      instructions: "What should the profiler stage do?",
      criteria: {
        run: "profile now",
        skip: "skip this round",
        async: "queue and join later",
      },
    },
  },
};

const SKIP_STATE: ProfilingSkipState = {
  stage: "profile",
  iteration: 2,
  previousRound: {
    iteration: 1,
    decision: "DISCARD",
    metric: { name: "tflops", unit: "TFLOP/s", direction: "higher", best: 10 },
  },
  previousProfileAvailable: true,
  profilerInstructions: "Profile the promoted current-best kernel.",
};

describe("System One provider contract", () => {
  it("returns a complete choice distribution from the fake provider", async () => {
    const provider = new FakeSystemOneProvider({ action: "async" });
    const response = await Effect.runPromise(provider.decide(REQUEST));
    expect(response.answers.action).toEqual({
      type: "choice",
      choice: "async",
      probabilities: { run: 0, skip: 0, async: 1 },
      confidence: 1,
    });
  });

  it("fails closed when the fake has no valid answer", async () => {
    const provider = new FakeSystemOneProvider({ action: "unknown" });
    const result = await Effect.runPromise(Effect.either(provider.decide(REQUEST)));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left.message).toContain("unknown criterion");
  });

  it("parses and compiles decision selection on a loop stage", async () => {
    const parsed = await Effect.runPromise(parseWorkflow(LOOP_WITH_DECISION, SOURCE));
    const compiled = await Effect.runPromise(compileWorkflow(parsed, SOURCE));
    expect(compiled.stages[0]?.stage.decision).toEqual({
      model: "fake",
      timeout: 5,
    });
    expect(compiled.stages[0]?.stage.skippable).toBe(true);
  });

  it("defaults decision selection to Laya", async () => {
    const parsed = await Effect.runPromise(parseWorkflow(
      LOOP_WITH_DECISION.replace("                model: fake\n", ""),
      SOURCE,
    ));
    const compiled = await Effect.runPromise(compileWorkflow(parsed, SOURCE));
    expect(compiled.stages[0]?.stage.decision).toEqual({
      model: "laya",
      timeout: 5,
    });
  });

  it("rejects decision selection without skippable", async () => {
    const result = await Effect.runPromise(Effect.either(parseWorkflow(
      LOOP_WITH_DECISION.replace("              skippable: true\n", ""),
      SOURCE,
    )));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left.message).toContain("skippable: true");
  });

  it("rejects skippable outside a loop at compile time", async () => {
    const parsed = await Effect.runPromise(parseWorkflow(TOP_LEVEL_DECISION, SOURCE));
    const result = await Effect.runPromise(Effect.either(compileWorkflow(parsed, SOURCE)));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left.message).toContain("not inside a loop");
  });

  it("rejects malformed decision selectors at parse time", async () => {
    const unknown = await Effect.runPromise(Effect.either(parseWorkflow(
      LOOP_WITH_DECISION.replace("model: fake", "model: fake\n                provider: system-one"),
      SOURCE,
    )));
    expect(Either.isLeft(unknown)).toBe(true);
    if (Either.isLeft(unknown)) expect(unknown.left.message).toContain("unknown");
  });

  it("uses the model's choice even when it reports low confidence", async () => {
    const unsure: SystemOneProvider = {
      model: "fake",
      decide: () => Effect.succeed({
        answers: {
          action: {
            type: "choice",
            choice: "skip",
            probabilities: { run: 0.4, skip: 0.6 },
            confidence: 0.2,
          },
        },
      }),
    };
    const decision = await Effect.runPromise(decideProfilingSkip(unsure, SKIP_STATE, 5));
    expect(decision).toEqual({ skip: true, choice: "skip", confidence: 0.6 });
  });

  it("speaks the local /v1/systemone wire format", async () => {
    let received: unknown;
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += String(chunk); });
      request.on("end", () => {
        received = JSON.parse(body);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          answers: {
            action: {
              type: "choice",
              choice: "run",
              probabilities: { run: 0.8, skip: 0.2 },
              confidence: 0.8,
            },
          },
        }));
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("missing server port");
      const provider = new HttpSystemOneProvider("laya", `http://127.0.0.1:${address.port}`);
      const response = await Effect.runPromise(provider.decide(REQUEST));
      expect(received).toMatchObject({
        model: "laya",
        state: REQUEST.state,
        questions: REQUEST.questions,
      });
      expect(response.answers.action).toEqual({
        type: "choice",
        choice: "run",
        probabilities: { run: 0.8, skip: 0.2 },
        confidence: 0.8,
      });
    } finally {
      server.close();
    }
  });
});
