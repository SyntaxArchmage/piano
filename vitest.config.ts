import { defineConfig } from "vitest/config";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    // PTY startup is sensitive to the load created by the full suite. Keep
    // the tests' own bounded waits, but allow a busy CI worker to reach them.
    testTimeout: 15_000,
    // The cli/ and tui/ integration tests each use their own mkdtemp dirs so
    // they don't share disk state, but they drive full TUI+session loops and
    // are CPU-heavy under load. Without a cap the default thread count (= CPU
    // core count) causes waitFor timeouts when many loops compete for the
    // scheduler. Two threads is enough to keep the suite fast while
    // eliminating the load-induced flake.
    poolOptions: {
      threads: {
        maxThreads: 2,
      },
    },
    env: {
      // Piano generates its harness configuration home under ~/.piano/harness.
      // Any test that drives a real session would regenerate the developer's
      // own copy, so the whole suite is redirected to a scratch directory.
      PIANO_HARNESS_HOME_ROOT: join(tmpdir(), "piano-test-harness-home"),
    },
  },
});
