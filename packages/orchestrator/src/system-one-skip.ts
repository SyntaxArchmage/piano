/**
 * The narrow System One use case the tuning loop needs now: decide whether an
 * expensive profiling stage can be skipped after a round that did not improve
 * the key metric.
 *
 * The model gets only bounded, auditable context: the previous round's outcome
 * and metric, the profiler's own instructions, and the stage identity. It never
 * gets the whole transcript or arbitrary workspace files.
 */
import { Duration, Effect } from "effect";
import {
  SystemOneError,
  type SystemOneProvider,
  type SystemOneRequest,
  type SystemOneState,
} from "@piano/system-one";

export interface ProfilingMetricContext {
  readonly name: string;
  readonly unit: string;
  readonly direction: "higher" | "lower";
  readonly best: number;
  readonly median?: number;
}

export interface ProfilingRoundContext {
  readonly iteration: number;
  readonly decision: string;
  readonly metric?: ProfilingMetricContext;
}

export interface ProfilingSkipState {
  readonly stage: string;
  readonly iteration: number;
  /** Absent on the first iteration; the model still gets the question and can
   * decide to run. */
  readonly previousRound?: ProfilingRoundContext;
  /** False when no earlier accepted profile can be reused. */
  readonly previousProfileAvailable: boolean;
  readonly profilerInstructions: string;
}

export interface ProfilingSkipChoice {
  readonly skip: boolean;
  readonly choice: "run" | "skip";
  readonly confidence: number;
}

/** One request shape shared by every provider; the provider only owns
 * transport. The state stays JSON so it can be recorded verbatim in evidence. */
export function profilingSkipRequest(state: ProfilingSkipState): SystemOneRequest {
  return {
    state: state as unknown as SystemOneState,
    questions: {
      action: {
        type: "choice",
        instructions:
          "Decide whether this tuning iteration should run the profiling stage again. " +
          "Use the previous round and the profiler instructions; skip only when the previous profile is still usable and a new profile is unlikely to change the next optimization idea.",
        criteria: {
          run: "run the profiler now because fresh evidence is likely to change the next step",
          skip: "skip the profiler this iteration and reuse the previous accepted profile",
        },
      },
    },
  };
}

/** Ask the provider. Its choice is authoritative; confidence is recorded for
 * audit, not used as an engine-side veto. A provider error or timeout is the
 * caller's signal to run the stage, never to fail the workflow. */
export function decideProfilingSkip(
  provider: SystemOneProvider,
  state: ProfilingSkipState,
  timeoutSeconds: number,
): Effect.Effect<ProfilingSkipChoice, SystemOneError> {
  return Effect.gen(function* () {
    const response = yield* provider.decide(profilingSkipRequest(state)).pipe(
      Effect.timeoutFail({
        duration: Duration.seconds(timeoutSeconds),
        onTimeout: () => new SystemOneError({
          model: provider.model,
          message: `profiling skip decision timed out after ${timeoutSeconds}s`,
        }),
      }),
    );
    const answer = response.answers.action;
    if (answer === undefined) {
      return yield* Effect.fail(new SystemOneError({
        model: provider.model,
        message: "profiling skip decision returned no action answer",
      }));
    }
    const confidence = answer.probabilities.skip ?? answer.confidence ?? 0;
    const skip = answer.choice === "skip";
    return {
      skip,
      choice: skip ? "skip" : "run",
      confidence,
    };
  });
}
