import {
  spawn,
  type ChildProcessByStdio
} from "node:child_process";
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { Cause, Context, Data, Effect, Exit, Fiber, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

class ExpectedFailure extends Data.TaggedError("ExpectedFailure")<{
  readonly detail: string;
}> {}

class FirstSiblingFailure extends Data.TaggedError("FirstSiblingFailure")<Record<never, never>> {}

class SecondSiblingFailure extends Data.TaggedError("SecondSiblingFailure")<Record<never, never>> {}

class PrimaryFailure extends Data.TaggedError("PrimaryFailure")<Record<never, never>> {}

class FinalizerFailure extends Data.TaggedError("FinalizerFailure")<Record<never, never>> {}

class ChildFailure extends Data.TaggedError("ChildFailure")<{
  readonly message: string;
}> {}

class Probe extends Context.Tag("EffectV3SpikeProbe")<
  Probe,
  { readonly value: number }
>() {}

type ChildObservation = {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
};

type ChildHandle = {
  readonly effect: Effect.Effect<ChildObservation, ChildFailure>;
  readonly process: ChildProcessByStdio<null, Readable, Readable>;
  readonly started: Promise<void>;
  readonly closed: Promise<void>;
  readonly isClosed: () => boolean;
};

type ChildOptions = {
  readonly executable?: string;
  readonly env?: NodeJS.ProcessEnv;
};

function assertFailure<E>(exit: Exit.Exit<unknown, E>): Cause.Cause<E> {
  assert.equal(Exit.isFailure(exit), true);
  if (!Exit.isFailure(exit)) {
    throw new Error("expected a failure Exit");
  }
  return exit.cause;
}

function childEffect(
  script: string,
  args: readonly string[] = ["-e", script],
  options: ChildOptions = {}
): ChildHandle {
  let resolveStarted!: () => void;
  let resolveClosed!: () => void;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  let resolveStdoutEnded!: () => void;
  let resolveStderrEnded!: () => void;
  const stdoutEnded = new Promise<void>((resolve) => {
    resolveStdoutEnded = resolve;
  });
  const stderrEnded = new Promise<void>((resolve) => {
    resolveStderrEnded = resolve;
  });
  let closedObserved = false;
  let child!: ChildProcessByStdio<null, Readable, Readable>;

  const effect = Effect.async<ChildObservation, ChildFailure>((resume) => {
    child = spawn(options.executable ?? process.execPath, args, {
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdout.once("end", resolveStdoutEnded);
    child.stderr.once("end", resolveStderrEnded);
    child.once("spawn", resolveStarted);
    child.once("error", (error) => {
      closedObserved = true;
      resolveClosed();
      resume(Effect.fail(new ChildFailure({ message: error.message })));
    });
    child.once("close", async (code, signal) => {
      await Promise.all([stdoutEnded, stderrEnded]);
      closedObserved = true;
      resolveClosed();
      resume(Effect.succeed({ code, signal, stdout, stderr }));
    });

    return Effect.sync(() => {
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGTERM");
      }
    }).pipe(Effect.andThen(Effect.promise(() => closed)));
  });

  return {
    effect,
    get process() {
      return child;
    },
    started,
    closed,
    isClosed: () => closedObserved
  };
}

describe("Effect v3 repository spike", () => {
  it("keeps expected failures, defects, and interruption distinct in Exit/Cause", async () => {
    const expected = await Effect.runPromiseExit(
      Effect.fail(new ExpectedFailure({ detail: "caller can recover" }))
    );
    const expectedCause = assertFailure(expected);
    const expectedFailure = Cause.failureOption(expectedCause);
    expect(Option.isSome(expectedFailure)).toBe(true);
    if (Option.isSome(expectedFailure)) {
      expect(expectedFailure.value).toBeInstanceOf(ExpectedFailure);
      expect(expectedFailure.value.detail).toBe("caller can recover");
    }

    const defect = await Effect.runPromiseExit(Effect.die("invariant broke"));
    const defectCause = assertFailure(defect);
    expect(Option.isSome(Cause.dieOption(defectCause))).toBe(true);

    const interrupted = await Effect.runPromiseExit(Effect.interrupt);
    const interruptCause = assertFailure(interrupted);
    expect(Cause.isInterrupted(interruptCause)).toBe(true);
  });

  it("bridges an external AbortSignal to an interrupted Effect", async () => {
    const controller = new AbortController();
    const pending = Effect.runPromiseExit(Effect.never, {
      signal: controller.signal
    });
    controller.abort();
    const exit = await pending;
    const cause = assertFailure(exit);
    expect(Cause.isInterrupted(cause)).toBe(true);
  });

  it("turns a rejected Promise into a typed failure with tryPromise", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.tryPromise({
        try: async () => {
          throw new Error("upstream unavailable");
        },
        catch: (error) =>
          new ChildFailure({
            message: error instanceof Error ? error.message : String(error)
          })
      })
    );
    const cause = assertFailure(exit);
    const failure = Cause.failureOption(cause);
    expect(Option.isSome(failure)).toBe(true);
    if (Option.isSome(failure)) {
      expect(failure.value).toBeInstanceOf(ChildFailure);
      expect(failure.value.message).toBe("upstream unavailable");
    }
  });

  it("uses Context and Layer without requiring a platform package", async () => {
    const layer = Layer.succeed(Probe, { value: 42 });
    const program = Effect.gen(function* () {
      const probe = yield* Probe;
      return probe.value;
    }).pipe(Effect.provide(layer));

    await expect(Effect.runPromise(program)).resolves.toBe(42);
  });

  it("runs acquire/release resources and reports finalizer failures", async () => {
    let acquired = 0;
    let released = 0;
    const resource = Effect.acquireRelease(
      Effect.sync(() => {
        acquired += 1;
        return "resource";
      }),
      () =>
        Effect.sync(() => {
          released += 1;
        })
    );
    const use = Effect.scoped(Effect.flatMap(resource, () => Effect.succeed("done")));

    await expect(Effect.runPromise(use)).resolves.toBe("done");
    expect(acquired).toBe(1);
    expect(released).toBe(1);

    let layerReleased = 0;
    const scopedLayer = Layer.scoped(
      Probe,
      Effect.acquireRelease(
        Effect.succeed({ value: 7 }),
        () =>
          Effect.sync(() => {
            layerReleased += 1;
          })
      )
    );
    const scopedLayerProgram = Effect.scoped(
      Effect.gen(function* () {
        const probe = yield* Probe;
        return probe.value;
      }).pipe(Effect.provide(scopedLayer))
    );
    await expect(Effect.runPromise(scopedLayerProgram)).resolves.toBe(7);
    expect(layerReleased).toBe(1);

    const primaryAndFinalizer = Effect.scoped(
      Effect.flatMap(
        Effect.acquireRelease(
          Effect.succeed("resource"),
          () => Effect.die(new FinalizerFailure())
        ),
        () => Effect.fail(new PrimaryFailure())
      )
    );
    const exit = await Effect.runPromiseExit(primaryAndFinalizer);
    const cause = assertFailure(exit);
    const renderedCause = Cause.pretty(cause);
    expect(renderedCause).toContain("PrimaryFailure");
    expect(renderedCause).toContain("FinalizerFailure");
  });

  it("keeps both parallel sibling failures observable", async () => {
    type SiblingFailure = FirstSiblingFailure | SecondSiblingFailure;
    let active = 0;
    let peak = 0;
    const failSibling = (error: SiblingFailure): Effect.Effect<never, SiblingFailure> =>
      Effect.fail(error);
    const concurrentFailure = (error: SiblingFailure) =>
      Effect.sync(() => {
        active += 1;
        peak = Math.max(peak, active);
      }).pipe(
        Effect.andThen(Effect.sleep("10 millis")),
        Effect.andThen(failSibling(error)),
        Effect.ensuring(
          Effect.sync(() => {
            active -= 1;
          })
        )
      );

    const aggregatedExit = await Effect.runPromiseExit(
      Effect.validateAll(
        [new FirstSiblingFailure(), new SecondSiblingFailure()],
        (failure) => concurrentFailure(failure),
        { concurrency: "unbounded" }
      )
    );
    expect(peak).toBe(2);
    const aggregateCause = assertFailure(aggregatedExit);
    const aggregate = Cause.failureOption(aggregateCause);
    expect(Option.isSome(aggregate)).toBe(true);
    if (Option.isSome(aggregate)) {
      expect(aggregate.value).toHaveLength(2);
    }

    const [firstExit, secondExit] = await Effect.runPromise(
      Effect.all(
        [Effect.fork(failSibling(new FirstSiblingFailure())), Effect.fork(failSibling(new SecondSiblingFailure()))],
        { concurrency: "unbounded" }
      ).pipe(
        Effect.flatMap(([firstFiber, secondFiber]) =>
          Effect.all([Fiber.await(firstFiber), Fiber.await(secondFiber)], {
            concurrency: "unbounded"
          })
        )
      )
    );
    const combinedCause = Cause.parallel(
      assertFailure(firstExit),
      assertFailure(secondExit)
    );
    expect(Cause.isParallelType(combinedCause)).toBe(true);
    expect(Cause.pretty(combinedCause)).toContain("FirstSiblingFailure");
    expect(Cause.pretty(combinedCause)).toContain("SecondSiblingFailure");
  });

  it("reports timeout as a typed failure instead of an unhandled rejection", async () => {
    const timed = await Effect.runPromiseExit(Effect.timeout(Effect.never, "5 millis"));
    const cause = assertFailure(timed);
    expect(Cause.pretty(cause)).toContain("TimeoutException");
  });

  it("drains a real Node child process before close", async () => {
    const child = childEffect(
      "",
      ["-c", "printf stdout-ok; printf stderr-ok >&2"],
      { executable: "/bin/sh" }
    );
    const observation = await Effect.runPromise(child.effect);

    expect(observation).toEqual({
      code: 0,
      signal: null,
      stdout: "stdout-ok",
      stderr: "stderr-ok"
    });
    expect(child.isClosed()).toBe(true);
    await child.closed;
    expect(child.process.exitCode).toBe(0);
    expect(child.process.stdout.destroyed).toBe(true);
    expect(child.process.stderr.destroyed).toBe(true);
  });

  it("interrupts and cleans up a running child process", async () => {
    const child = childEffect("setTimeout(() => {}, 10_000)");
    const controller = new AbortController();
    const run = Effect.runPromiseExit(child.effect, {
      signal: controller.signal
    });
    await child.started;
    controller.abort();

    const exit = await run;
    const cause = assertFailure(exit);
    expect(Cause.isInterrupted(cause)).toBe(true);
    expect(child.isClosed()).toBe(true);
    await child.closed;
    expect(child.process.killed).toBe(true);
    expect(child.process.signalCode).toBe("SIGTERM");
    expect(child.process.stdout.destroyed).toBe(true);
    expect(child.process.stderr.destroyed).toBe(true);
  });

  it("executes a real ESM import under the NodeNext-shaped runtime", async () => {
    const directory = mkdtempSync(join(tmpdir(), "effect-v3-esm-"));
    const marker = join(directory, "import-marker.txt");
    try {
      const child = childEffect(
        "",
        [
          "--input-type=module",
          "-e",
          "import { writeFileSync } from 'node:fs'; import { Effect } from 'effect'; writeFileSync(process.env.PIANO_EFFECT_SPIKE_MARKER, typeof Effect.succeed)"
        ],
        { env: { PIANO_EFFECT_SPIKE_MARKER: marker } }
      );
      const observation = await Effect.runPromise(child.effect);
      await child.closed;
      expect(observation.code).toBe(0);
      expect(readFileSync(marker, "utf8")).toBe("function");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
