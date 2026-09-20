import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startTui, type TuiSession } from "./pty.js";
import { DEFAULT_SPLIT_RATIO, rightColumns } from "../../packages/cli/src/split-drag.js";

/** Face-page headline used as the "shell is up" marker. Kept in one place so a
 * copy change touches one line instead of every test that waits for the face. */
const FACE_SLOGAN = "Piano: A Programmable Agent Workflow System.";

async function waitFor(session: TuiSession, text: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && session.stillRunning()) {
    if (session.capture().includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${JSON.stringify(text)} in the Piano TUI`);
}

async function waitForScreen(session: TuiSession, predicate: (screen: string) => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && session.stillRunning()) {
    const screen = session.capture();
    if (predicate(screen)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${description} in the Piano TUI`);
}

describe("Piano TUI over a real PTY", () => {
  let sessions: TuiSession[] = [];

  afterEach(() => {
    for (const session of sessions) session.close();
    sessions = [];
  });

  it("opens the generic Piano shell and keeps Escape as interrupt", async () => {
    const session = startTui();
    sessions.push(session);
    await waitFor(session, FACE_SLOGAN);
    await waitFor(session, "COMMANDS");
    const initialPane = session.capture().split("\n");
    const trajectoryRow = initialPane.findIndex((row) => row.includes("trajectory"));
    const footerRow = initialPane.findIndex((row) => row.includes("COMMANDS"));
    const leftWidth = 120 - rightColumns(DEFAULT_SPLIT_RATIO, 120);
    const expectedFaceOffset = Math.floor((leftWidth - 64) / 2);
    const faceBottom = initialPane.find((row) => row.includes("╰") && row.includes("╯") && row.indexOf("╰") === expectedFaceOffset);
    const dividerRow = initialPane.find((row) => row[83] === "│");
    expect(trajectoryRow).toBeGreaterThanOrEqual(0);
    expect(trajectoryRow).toBeLessThan(footerRow);
    expect(faceBottom).toBeDefined();
    expect(faceBottom?.indexOf("╰")).toBe(expectedFaceOffset);
    expect(faceBottom?.lastIndexOf("╯")).toBe(expectedFaceOffset + 63);
    expect(dividerRow).toBeDefined();
    expect(session.capture()).toContain("WORKFLOW");
    expect(session.capture()).not.toContain("STATUS");
    expect(session.capture()).not.toContain("TRAJECTORY");
    expect(session.capture()).not.toContain("approve");
    session.key("Escape");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(session.stillRunning()).toBe(true);
    session.key("/exit");
    session.key("Enter");
    const deadline = Date.now() + 5000;
    while (session.stillRunning() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(session.stillRunning()).toBe(false);
  });

  it("keeps the footer visible for Ctrl+Home and Ctrl+End", async () => {
    const session = startTui();
    sessions.push(session);
    await waitFor(session, "COMMANDS");

    session.key("\x1b[7^");
    session.key("\x1b[8^");
    session.key("\x1b[1;5H");
    session.key("\x1b[1;5F");
    await waitForScreen(
      session,
      (screen) => screen.includes("COMMANDS") && screen.includes("SHORTCUTS"),
      "footer after Ctrl+Home/End",
    );

    expect(session.capture()).toContain("WORKFLOW");
    session.key("/exit");
    session.key("Enter");
    const deadline = Date.now() + 5000;
    while (session.stillRunning() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(session.stillRunning()).toBe(false);
  });

  it("exits through the shell /exit command", async () => {
    const session = startTui();
    sessions.push(session);
    await waitFor(session, FACE_SLOGAN);
    session.key("/exit");
    session.key("Enter");
    const deadline = Date.now() + 5000;
    while (session.stillRunning() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(session.stillRunning()).toBe(false);
  });

  it("toggles the trajectory panel and divider through /side", async () => {
    const session = startTui();
    sessions.push(session);
    await waitFor(session, "trajectory");
    session.key("/side");
    session.key("Enter");
    await new Promise((resolve) => setTimeout(resolve, 300));
    const expandedPane = session.capture().split("\n");
    const expandedFaceBottom = expandedPane.find((row) => row.includes("╰") && row.includes("╯") && row.indexOf("╰") === Math.floor((120 - 64) / 2));
    expect(expandedFaceBottom?.indexOf("╰")).toBe(Math.floor((120 - 64) / 2));
    session.key("/side");
    session.key("Enter");
    await waitForScreen(
      session,
      (screen) => screen.split("\n").some((row) => row[83] === "│"),
      "trajectory pane divider",
    );
    expect(session.capture().split("\n").find((row) => row[83] === "│")).toBeDefined();
  });

  it("exits through Ctrl+C", async () => {
    const session = startTui();
    sessions.push(session);
    await waitFor(session, FACE_SLOGAN);
    session.key("C-c");
    const deadline = Date.now() + 5000;
    while (session.stillRunning() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(session.stillRunning()).toBe(false);
  });

  it("opens the same Piano shell when an explicit workflow is selected", async () => {
    const session = startTui(undefined, ["--workflow", join(process.cwd(), "recipes/workflows/coding-pi.yml")]);
    sessions.push(session);
    await waitFor(session, FACE_SLOGAN);
    expect(session.capture()).toContain("trajectory");
    session.key("/exit");
    session.key("Enter");
    const deadline = Date.now() + 5000;
    while (session.stillRunning() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(session.stillRunning()).toBe(false);
  });

  it("updates the rendered face after a real PTY resize", async () => {
    const session = startTui();
    sessions.push(session);
    await waitFor(session, FACE_SLOGAN);
    const trajectoryStart = (screen: string): number => {
      const row = screen.split("\n").find((line) => line.includes("▐ trajectory"));
      return row?.indexOf("▐ trajectory") ?? -1;
    };
    expect(trajectoryStart(session.capture())).toBe(
      120 - rightColumns(DEFAULT_SPLIT_RATIO, 120),
    );
    session.resize(100, 40);
    const leftWidth = 100 - rightColumns(DEFAULT_SPLIT_RATIO, 100);
    await waitForScreen(session, (screen) => {
      const title = screen.split("\n").find((row) => row.includes(FACE_SLOGAN));
      return title !== undefined &&
        title[leftWidth - 1] === "│" &&
        trajectoryStart(screen) === 100 - rightColumns(DEFAULT_SPLIT_RATIO, 100);
    }, "the resized face page and trajectory overlay");
  });

  it("keeps a picker above the trajectory overlay during resize", async () => {
    const session = startTui();
    sessions.push(session);
    await waitFor(session, FACE_SLOGAN);
    session.key("/workspace");
    session.key("Enter");
    await waitFor(session, "Workspace:");
    session.resize(80, 20);
    await waitForScreen(
      session,
      (screen) => screen.includes("Enter: open · Alt+Enter: choose · Esc: cancel"),
      "the workspace picker after resize",
    );
    session.key("Escape");
    await waitForScreen(session, (screen) => !screen.includes("Workspace:"), "the picker to close");
  });

});
