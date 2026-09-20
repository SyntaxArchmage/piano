import { afterEach, describe, expect, it } from "vitest";
import { startTui, type TuiSession } from "./pty.js";

async function waitFor(session: TuiSession, predicate: (screen: string) => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && session.stillRunning()) {
    if (predicate(session.capture())) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out; screen:\n${session.capture()}`);
}

describe("workspace picker PTY", () => {
  let session: TuiSession | undefined;

  afterEach(() => {
    session?.close();
    session = undefined;
  });

  it("routes Escape to the focused picker instead of the global interrupt", async () => {
    session = startTui();
    await waitFor(session, (screen) => screen.includes("trajectory"));
    session.key("/workspace");
    session.key("Enter");
    await waitFor(session, (screen) => screen.includes("Workspace:"));
    session.key("Escape");
    await waitFor(session, (screen) => !screen.includes("Workspace:"));
    expect(session.stillRunning()).toBe(true);
  });

  it("shows slash commands and accepts a command with Tab", async () => {
    session = startTui();
    await waitFor(session, (screen) => screen.includes("trajectory"));
    session.key("/");
    await waitFor(session, (screen) => screen.includes("→ exit"));
    session.key("wor");
    await waitFor(session, (screen) => screen.includes("→ workspace"));
    session.key("\t");
    await waitFor(session, (screen) => screen.includes("/workspace "));
    expect(session.stillRunning()).toBe(true);
  }, 15_000);
});
