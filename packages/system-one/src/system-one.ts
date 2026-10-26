/**
 * The neutral System One decision interface.
 *
 * A System One model answers typed questions about a state in one forward
 * pass: it returns a probability for every permitted choice instead of
 * generating text. Provider adapters (Laya, decider, Julia, ...) own the
 * transport; the engine owns this shape and the audit record around it.
 */
import { io } from "@piano/base";
import { Data, Effect } from "effect";

export type SystemOneState = string | Readonly<Record<string, unknown>> | readonly string[];

/** The only question shape the profiling decision needs today. Choice keeps
 * the answer space closed and the probabilities directly comparable. */
export interface SystemOneChoiceQuestion {
  readonly type: "choice";
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
}

export interface SystemOneRequest {
  readonly state: SystemOneState;
  readonly questions: Readonly<Record<string, SystemOneChoiceQuestion>>;
}

export interface SystemOneChoiceAnswer {
  readonly type: "choice";
  readonly choice: string;
  /** One probability per criterion id. A complete distribution sums to 1. */
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence?: number;
}

export interface SystemOneResponse {
  readonly answers: Readonly<Record<string, SystemOneChoiceAnswer>>;
}

export class SystemOneError extends Data.TaggedError("SystemOneError")<{
  readonly model: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** One local decision model. Implementations are local services or in-process
 * adapters; the engine never talks to a provider-specific protocol directly. */
export interface SystemOneProvider {
  /** Stable id the workflow DSL selects, e.g. `laya` or `decider`. */
  readonly model: string;
  decide(request: SystemOneRequest): Effect.Effect<SystemOneResponse, SystemOneError>;
}

/** A local `/v1/systemone` server (Laya, decider, or a compatible service).
 * The endpoint is transport only; the request/response contract stays neutral. */
export class HttpSystemOneProvider implements SystemOneProvider {
  constructor(
    readonly model: string,
    private readonly endpoint: string,
  ) {}

  decide(request: SystemOneRequest): Effect.Effect<SystemOneResponse, SystemOneError> {
    const url = `${this.endpoint.replace(/\/+$/u, "")}/v1/systemone`;
    return io.fetchJson(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        state: request.state,
        questions: request.questions,
      }),
    }).pipe(
      Effect.mapError((cause) => new SystemOneError({
        model: this.model,
        message: `System One request to ${url} failed: ${cause.message}`,
        cause,
      })),
      Effect.flatMap((response) => parseHttpResponse(this.model, request, response)),
    );
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseHttpResponse(
  model: string,
  request: SystemOneRequest,
  response: io.JsonResponse,
): Effect.Effect<SystemOneResponse, SystemOneError> {
  if (!response.ok) {
    return Effect.fail(new SystemOneError({
      model,
      message: `System One endpoint returned HTTP ${response.status}`,
    }));
  }
  const body = record(response.json);
  const rawAnswers = body === undefined ? undefined : record(body.answers);
  if (rawAnswers === undefined) {
    return Effect.fail(new SystemOneError({
      model,
      message: "System One endpoint returned no answers object",
    }));
  }
  const answers: Record<string, SystemOneChoiceAnswer> = {};
  for (const [name, question] of Object.entries(request.questions)) {
    const answer = record(rawAnswers[name]);
    if (answer === undefined ||
      (answer.type !== undefined && answer.type !== "choice") ||
      typeof answer.choice !== "string") {
      return Effect.fail(new SystemOneError({
        model,
        message: `System One endpoint returned no valid choice answer for "${name}"`,
      }));
    }
    if (!Object.hasOwn(question.criteria, answer.choice)) {
      return Effect.fail(new SystemOneError({
        model,
        message: `System One endpoint chose unknown criterion "${answer.choice}" for "${name}"`,
      }));
    }
    const rawProbabilities = record(answer.probabilities) ?? {};
    const probabilities: Record<string, number> = {};
    for (const [criterion, value] of Object.entries(rawProbabilities)) {
      if (!Object.hasOwn(question.criteria, criterion) || typeof value !== "number" || !Number.isFinite(value)) {
        return Effect.fail(new SystemOneError({
          model,
          message: `System One endpoint returned an invalid probability for "${name}"`,
        }));
      }
      probabilities[criterion] = value;
    }
    const confidence = typeof answer.confidence === "number" && Number.isFinite(answer.confidence)
      ? answer.confidence
      : undefined;
    answers[name] = {
      type: "choice",
      choice: answer.choice,
      probabilities,
      ...(confidence === undefined ? {} : { confidence }),
    };
  }
  return Effect.succeed({ answers });
}

/** Deterministic provider for tests and for wiring the engine before a real
 * model is installed. `choices` maps each question id to its chosen criterion. */
export class FakeSystemOneProvider implements SystemOneProvider {
  readonly model = "fake";

  constructor(private readonly choices: Readonly<Record<string, string>>) {}

  decide(request: SystemOneRequest): Effect.Effect<SystemOneResponse, SystemOneError> {
    const answers: Record<string, SystemOneChoiceAnswer> = {};
    for (const [name, question] of Object.entries(request.questions)) {
      const choice = this.choices[name];
      if (choice === undefined || !Object.hasOwn(question.criteria, choice)) {
        return Effect.fail(new SystemOneError({
          model: this.model,
          message: choice === undefined
            ? `fake provider has no answer for question "${name}"`
            : `fake provider chose unknown criterion "${choice}" for question "${name}"`,
        }));
      }
      answers[name] = {
        type: "choice",
        choice,
        probabilities: Object.fromEntries(
          Object.keys(question.criteria).map((criterion) => [criterion, criterion === choice ? 1 : 0]),
        ),
        confidence: 1,
      };
    }
    return Effect.succeed({ answers });
  }
}
