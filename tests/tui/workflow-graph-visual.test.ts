import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetCapabilitiesCache,
  setCapabilities,
  type Terminal,
} from "@earendil-works/pi-tui";
import { runTui } from "../../packages/cli/src/tui.js";

class FakeTerminal implements Terminal {
  columns = 100;
  rows = 40;
  onInput?: (data: string) => void;
  output = "";

  start(onInput: (data: string) => void): void { this.onInput = onInput; }
  stop(): void {}
  drainInput(): Promise<void> { return Promise.resolve(); }
  get kittyProtocolActive(): boolean { return false; }
  setTitle(): void {}
  setProgress(): void {}
  write(data: string): void { this.output += data; }
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
}

// eslint-disable-next-line no-control-regex -- test helper strips terminal SGR codes
const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-9;]*m/g, "");
const KITTY_IMAGE_PREFIX = `${String.fromCharCode(27)}_Ga=T,`;

function kittyImageIds(output: string): string[] {
  return output.split(KITTY_IMAGE_PREFIX).slice(1).flatMap((frame) => {
    const parameters = frame.slice(0, frame.indexOf(";"));
    const imageId = /\bi=(\d+)/.exec(parameters)?.[1];
    return imageId === undefined ? [] : [imageId];
  });
}

const runningSnapshot = {
  plannedStages: 1,
  completedStages: 0,
  status: "running" as const,
  current: { stageId: "respond", status: "running" as const },
  stageCounts: { respond: { planned: 1, completed: 0 } },
};

const completedSnapshot = {
  plannedStages: 1,
  completedStages: 1,
  status: "completed" as const,
  current: { stageId: "respond", status: "accepted" as const },
  stageCounts: { respond: { planned: 1, completed: 1 } },
};

async function advanceTui(milliseconds: number): Promise<void> {
  const drainAsyncWork = async (): Promise<void> => {
    // fs/promises callbacks use the real libuv loop while the TUI heartbeat
    // and pi-tui redraws use fake timers. A few real turns make that boundary
    // deterministic without sleeping in the test.
    for (let turn = 0; turn < 4; turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      await Promise.resolve();
    }
  };
  await drainAsyncWork();
  await vi.advanceTimersByTimeAsync(milliseconds);
  await drainAsyncWork();
  await vi.advanceTimersByTimeAsync(20);
  await drainAsyncWork();
  // The heartbeat schedules an async file read and pi-tui schedules its
  // differential render on the next turn. Drain both before inspecting output.
  await Promise.resolve();
  await Promise.resolve();
}

describe(" TUI workflow graph visual effect", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetCapabilitiesCache();
  });

  it("streams animated Kitty frames and updates the WORKFLOW summary from the run's state document", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date", "performance"] });
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    const root = await mkdtemp(join(tmpdir(), "piano-graph-visual-"));
    const statusPath = join(root, "status.json");
    const terminal = new FakeTerminal();
    let resolvePrompt: ((effect: Effect.Effect<string, never>) => void) | undefined;
    let session: Promise<{ readonly type: "closed" }> | undefined;

    try {
      await writeFile(statusPath, `${JSON.stringify(runningSnapshot)}\n`, "utf8");
      session = Effect.runPromise(runTui({
        terminal,
        historyRoot: root,
        workflowGraph: { name: "basic", path: "/tmp/basic.yml", stages: [{ id: "respond", dependsOn: [] }] },
        progressSnapshotPath: statusPath,
        runPrompt: () => Effect.async<string, never>((resume) => {
          resolvePrompt = resume;
        }),
      }));

      await advanceTui(20);
      expect(stripAnsi(terminal.output)).toContain("basic /tmp/basic.yml");
      expect(terminal.output).toContain(KITTY_IMAGE_PREFIX);

      terminal.onInput?.("run");
      terminal.onInput?.("\r");
      await advanceTui(20);
      const transmissionsBeforePulse = kittyImageIds(terminal.output).length;
      const firstImageId = kittyImageIds(terminal.output)[0];

      await advanceTui(500);
      const imageIds = kittyImageIds(terminal.output);
      const transmissionsAfterPulse = imageIds.length;
      expect(transmissionsAfterPulse).toBeGreaterThan(transmissionsBeforePulse);
      expect(firstImageId).toBeDefined();
      expect(imageIds.every((imageId) => imageId === firstImageId)).toBe(true);

      await writeFile(statusPath, `${JSON.stringify(completedSnapshot)}\n`, "utf8");
      // A heartbeat may still be completing the read that started before this
      // write. Advance through the following heartbeat as well so the test
      // observes the eventual completed snapshot, not a stale cached frame.
      await advanceTui(500);
      await advanceTui(500);
      expect(stripAnsi(terminal.output)).toContain("basic /tmp/basic.yml");
      resolvePrompt?.(Effect.succeed("done"));
      await advanceTui(20);
      terminal.onInput?.("/exit");
      terminal.onInput?.("\r");
      await expect(session).resolves.toEqual({ type: "closed" });
    } finally {
      if (session !== undefined) {
        terminal.onInput?.("/exit");
        terminal.onInput?.("\r");
        await advanceTui(20).catch(() => undefined);
        await session.catch(() => undefined);
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});
