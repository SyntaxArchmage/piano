import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionPicker } from "../../packages/cli/src/session-picker.js";

/** A run as the picker finds it: a trajectory to replay (which is what keeps the
 * run listed) and the state document its row is projected from. */
async function writeRun(root: string, runId: string, state?: Record<string, unknown>): Promise<void> {
  const runDir = join(root, runId);
  await mkdir(join(runDir, "system-log"), { recursive: true });
  if (state !== undefined) {
    await writeFile(
      join(runDir, "system-log", "trajectory.jsonl"),
      `${JSON.stringify({ version: 1, runId, timestamp: "2026-09-01T00:00:00.000Z", status: "completed", events: [] })}\n`,
      "utf8",
    );
    await writeFile(join(runDir, "status.json"), `${JSON.stringify(state)}\n`, "utf8");
  }
}

function state(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    updatedAt: "2026-09-01T00:00:00.000Z",
    status: "completed",
    ...fields,
  };
}

interface Harness {
  readonly picker: SessionPicker;
  /** Render until the picker stops re-rendering. Each lazy metadata read fires
   * one render when it lands, so a stable count means the drawn window is
   * fully loaded. */
  readonly settle: (width?: number) => Promise<string>;
  readonly chosen: () => string | undefined;
  readonly cancelled: () => boolean;
}

function openPicker(root: string, currentRunId?: string): Harness {
  let renders = 0;
  let chosen: string | undefined;
  let cancelled = false;
  const picker = new SessionPicker({
    runsRoot: root,
    ...(currentRunId === undefined ? {} : { currentRunId }),
    onChoose: (runId) => { chosen = runId; },
    onCancel: () => { cancelled = true; },
    onRender: () => { renders += 1; },
  });
  const settle = async (width = 120): Promise<string> => {
    let output = picker.render(width).join("\n");
    let stable = 0;
    for (let attempt = 0; attempt < 100 && stable < 2; attempt += 1) {
      const before = renders;
      await new Promise((resolve) => setTimeout(resolve, 5));
      output = picker.render(width).join("\n");
      stable = renders === before ? stable + 1 : 0;
    }
    return output;
  };
  return { picker, settle, chosen: () => chosen, cancelled: () => cancelled };
}

describe("SessionPicker", () => {
  it("lists runs newest first with their name, workflow, and first prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-picker-"));
    await writeRun(root, "20260901T070228-aaa111", state({
      name: "kernel tuning",
      workflowPath: "/repo/recipes/workflows/gpu-cuda-tuning.yaml",
      turns: [{ prompt: "tune the matmul", status: "completed", eventCount: 0 }],
    }));
    await writeRun(root, "20260830T101500-bbb222", state({
      workflowPath: "/repo/recipes/workflows/basic.yaml",
      turns: [{ prompt: "summarize the repo", status: "completed", eventCount: 0 }],
    }));

    const rows = (await openPicker(root).settle())
      .split("\n")
      .filter((line) => /\d{4}-\d{2}-\d{2}/.test(line));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("2026-09-01 07:02");
    expect(rows[0]).toContain("kernel tuning");
    expect(rows[0]).toContain("gpu-cuda-tuning");
    expect(rows[1]).toContain("2026-08-30 10:15");
    // No name recorded, so the row falls back to the run's first prompt.
    expect(rows[1]).toContain("summarize the repo");
  });

  it("marks the run the TUI is currently writing to", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-picker-"));
    await writeRun(root, "20260901T070228-aaa111", state({}));

    const output = await openPicker(root, "20260901T070228-aaa111").settle();

    expect(output).toContain("2026-09-01 07:02 (current)");
  });

  it("filters on the run id, name, workflow, and prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-picker-"));
    await writeRun(root, "20260901T070228-aaa111", state({ name: "kernel tuning" }));
    await writeRun(root, "20260830T101500-bbb222", state({
      turns: [{ prompt: "summarize the repo", status: "completed", eventCount: 0 }],
    }));

    const harness = openPicker(root);
    await harness.settle();
    for (const character of "summar") harness.picker.handleInput(character);
    const filtered = await harness.settle();

    expect(filtered).toContain("2026-08-30 10:15");
    expect(filtered).not.toContain("2026-09-01 07:02");
    expect(filtered).toContain("1/2 runs");
  });

  it("reads metadata only for the rows it draws and discloses the rest", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-picker-"));
    // More runs than fit the viewport, so some rows are never read and the
    // footer has to admit the filter cannot see them.
    for (let index = 0; index < 12; index += 1) {
      await writeRun(root, `20260901T0700${String(index).padStart(2, "0")}-run${index}`, state({
        name: `run ${index}`,
      }));
    }

    const output = await openPicker(root).settle(160);
    const named = output.split("\n").filter((line) => /run \d+/.test(line));

    expect(output).toContain("12/12 runs");
    expect(output).toContain("4 not yet read");
    // 8 visible rows carry a name; the 4 unread rows cannot.
    expect(named).toHaveLength(8);
    expect(output).toContain("↓ more");
  });

  it("returns the selected run id on Enter and cancels on Escape", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-picker-"));
    await writeRun(root, "20260901T070228-aaa111", state({}));
    await writeRun(root, "20260830T101500-bbb222", state({}));

    const chooser = openPicker(root);
    await chooser.settle();
    chooser.picker.handleInput("\x1b[B");
    chooser.picker.handleInput("\r");
    expect(chooser.chosen()).toBe("20260830T101500-bbb222");

    const canceller = openPicker(root);
    await canceller.settle();
    canceller.picker.handleInput("\x1b");
    expect(canceller.cancelled()).toBe(true);
  });

  it("drops a run whose trajectory is absent and lists a malformed one", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-picker-"));
    // No trajectory: nothing to replay, so the takeover could only fail. Such a
    // directory is a run that was opened and left without a prompt.
    await writeRun(root, "20260901T070228-bare");
    // Present but unparseable: still listed, without metadata, so a run the
    // user is looking for is never hidden.
    await mkdir(join(root, "20260830T101500-bad", "system-log"), { recursive: true });
    await writeFile(join(root, "20260830T101500-bad", "system-log", "trajectory.jsonl"), "{not json\n", "utf8");

    const output = await openPicker(root).settle();

    expect(output).not.toContain("2026-09-01 07:02");
    expect(output).toContain("2026-08-30 10:15");
    expect(output).toContain("1/1 runs");
    expect(output).not.toContain("not yet read");
  });

  it("says so when the runs root holds nothing", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-picker-"));

    expect(await openPicker(root).settle()).toContain("no runs found");
  });

  it("treats a missing runs root as an empty list rather than an error", async () => {
    const root = join(await mkdtemp(join(tmpdir(), "piano-session-picker-")), "absent");

    const output = await openPicker(root).settle();

    expect(output).toContain("no runs found");
    expect(output).not.toContain("ENOENT");
  });
});
