import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";

vi.mock("@piano/logging", async (importOriginal) => ({
  ...(await importOriginal()),
  createSession: vi.fn(),
  createStagingSession: vi.fn(),
}));

vi.mock("../../packages/cli/src/session-run.js", () => ({
  runSession: vi.fn(() => Effect.void),
}));

import { createSession, createStagingSession } from "@piano/logging";
import { resumeCommand } from "../../packages/cli/src/resume.js";
import { runSession } from "../../packages/cli/src/session-run.js";

const session = {
  id: "resume-test",
  root: "/tmp/piano",
  runDir: "/tmp/piano/.piano.runs/resume-test",
  cwd: "/tmp/piano/project",
  log: { append: vi.fn(() => Effect.void), flush: vi.fn(() => Effect.void) },
  trace: {
    enter: vi.fn(() => Effect.succeed({ spanId: "test", parentId: null, depth: 0, fn: "test", startedAt: 0 })),
    currentSpan: vi.fn(() => Effect.succeed(undefined)),
    exit: vi.fn(() => Effect.void),
    error: vi.fn(() => Effect.void),
    flush: vi.fn(() => Effect.void),
  },
  trajectory: {
    path: "/tmp/piano/.piano.runs/resume-test/trajectory.json",
    write: vi.fn(() => Effect.void),
    flush: vi.fn(() => Effect.void),
  },
} as never;

describe("piano resume command ", () => {
  let root: string;
  const runId = "20260821T120000-abc123";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "piano-resume-command-"));
    const runDir = join(root, runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "trajectory.jsonl"), JSON.stringify({
      version: 1,
      runId,
      updatedAt: "2026-08-21T12:00:00.000Z",
      status: "completed",
      promptLength: 12,
      events: [
        { type: "message_start", message: { role: "user", content: [{ type: "text", text: "what is 2+2?" }] } },
      ],
    }) + "\n", "utf8");
    vi.mocked(createSession).mockReset().mockReturnValue(Effect.succeed(session));
    vi.mocked(createStagingSession).mockReset().mockReturnValue(session);
    vi.mocked(runSession).mockClear();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("resumes a specific run by reusing its run directory", async () => {
    vi.mocked(createSession).mockImplementation((opts) => {
      expect(opts).toEqual({ cwd: process.cwd(), runsRoot: root, id: runId });
      return Effect.succeed(session);
    });

    await Effect.runPromise(resumeCommand([runId], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));

    expect(createSession).toHaveBeenCalledWith({ cwd: process.cwd(), runsRoot: root, id: runId });
    expect(runSession).toHaveBeenCalledWith(session, { resumeRunId: runId });
  });

  it("opens the picker over a staging session when no run id is supplied", async () => {
    await Effect.runPromise(resumeCommand([], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));

    // No `id`: nothing is written to disk until the first prompt is submitted,
    // so cancelling the picker strands no empty run directory.
    expect(createStagingSession).toHaveBeenCalledWith({ cwd: process.cwd(), runsRoot: root });
    expect(createSession).not.toHaveBeenCalled();
    expect(runSession).toHaveBeenCalledWith(session, { resumePicker: true });
  });

  it("rejects an unknown run id before opening a session on it", async () => {
    const exit = await Effect.runPromiseExit(
      resumeCommand(["20260821T120000-nosuch"], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      expect(exit.cause.error).toMatchObject({
        _tag: "LogsStorageError",
        operation: "list-runs",
        path: join(root, "20260821T120000-nosuch"),
      });
    }
    // `createSession` would have created the directory, stranding an empty run.
    expect(createSession).not.toHaveBeenCalled();
    expect(runSession).not.toHaveBeenCalled();
  });

  it("lists run ids on --list without opening a session", async () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await Effect.runPromise(resumeCommand(["--list"], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
      expect(out).toHaveBeenCalledWith(expect.stringContaining(runId));
    } finally {
      out.mockRestore();
    }
    expect(createSession).not.toHaveBeenCalled();
  });

  it("rejects a positional run id combined with --list", async () => {
    const exit = await Effect.runPromiseExit(resumeCommand([runId, "--list"], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      expect(exit.cause.error._tag).toBe("CliArgumentError");
    }
  });
});
