import { Effect } from "effect";
import { isKittyProtocolActive, setKittyProtocolActive } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import {
  COPY_MODE_KEYS,
  ERROR_EXPAND_KEYS,
  getScrollKeyBindings,
  SCROLL_END_KEYS,
  SCROLL_HOME_KEYS,
  TOOL_EXPAND_KEYS,
  dispatchShortcut,
  matchShortcut,
  matchesKeyPress,
} from "../../packages/cli/src/shortcuts.js";

// setKittyProtocolActive is process-global (ProcessTerminal sets it after
// negotiation), so restore it after every test or the next file in this worker
// decodes keys against the wrong protocol.
const kittyWasActive = isKittyProtocolActive();
afterEach(() => {
  setKittyProtocolActive(kittyWasActive);
});

describe(" shortcut effects", () => {
  it("decodes interrupt and exit independently", () => {
    expect(matchShortcut("\x1b")).toBe("interrupt");
    expect(matchShortcut("\x03")).toBe("exit");
    expect(matchShortcut("plain input")).toBeUndefined();
  });

  // Raw mode clears ISIG, so Ctrl+Z arrives as input instead of SIGTSTP: unless
  // the TUI decodes it, suspend is silently swallowed and the user has no escape
  // hatch left when exit is blocked.
  it.each([
    ["legacy control byte", "\x1a"],
    ["Kitty CSI-u", "\x1b[122;5u"],
    ["xterm modifyOtherKeys", "\x1b[27;5;122~"],
  ])("decodes Ctrl+Z encoded as %s as suspend", (_label, data) => {
    expect(matchShortcut(data)).toBe("suspend");
  });

  // Kitty disambiguation reshapes both keys, and a raw comparison left the agent
  // uninterruptible on such a terminal.
  it.each([
    ["Kitty CSI-u", "\x1b[27u"],
    ["Kitty CSI-u with modifier", "\x1b[27;1u"],
    ["xterm modifyOtherKeys", "\x1b[27;1;27~"],
  ])("decodes Escape encoded as %s as interrupt", (_label, data) => {
    expect(matchShortcut(data)).toBe("interrupt");
  });

  it.each([
    ["Kitty CSI-u", "\x1b[99;5u"],
    ["xterm modifyOtherKeys", "\x1b[27;5;99~"],
  ])("decodes Ctrl+C encoded as %s as exit", (_label, data) => {
    expect(matchShortcut(data)).toBe("exit");
  });

  it("ignores key releases so one press dispatches once", () => {
    expect(matchShortcut("\x1b[27;1:3u")).toBeUndefined();
    expect(matchShortcut("\x1b[99;5:3u")).toBeUndefined();
  });

  it("does not mistake other escape sequences for Escape", () => {
    expect(matchShortcut("\x1bo")).toBeUndefined();
    expect(matchShortcut("\x1b[A")).toBeUndefined();
    expect(matchShortcut("\x1b[111;5u")).toBeUndefined();
  });

  it("runs the selected side effect through Effect", async () => {
    const events: string[] = [];
    const effects = {
      interrupt: Effect.sync(() => { events.push("interrupt"); }),
      exit: Effect.sync(() => { events.push("exit"); }),
      suspend: Effect.sync(() => { events.push("suspend"); }),
    };
    await Effect.runPromise(dispatchShortcut("\x1b", effects));
    await Effect.runPromise(dispatchShortcut("\x03", effects));
    await Effect.runPromise(dispatchShortcut("\x1a", effects));
    expect(events).toEqual(["interrupt", "exit", "suspend"]);
  });

  it("dispatches the Kitty encodings through the same effects", async () => {
    const events: string[] = [];
    const effects = {
      interrupt: Effect.sync(() => { events.push("interrupt"); }),
      exit: Effect.sync(() => { events.push("exit"); }),
      suspend: Effect.sync(() => { events.push("suspend"); }),
    };
    await Effect.runPromise(dispatchShortcut("\x1b[27u", effects));
    await Effect.runPromise(dispatchShortcut("\x1b[99;5u", effects));
    await Effect.runPromise(dispatchShortcut("\x1b[27;1:3u", effects));
    await Effect.runPromise(dispatchShortcut("\x1b[122;5u", effects));
    expect(events).toEqual(["interrupt", "exit", "suspend"]);
  });
});

describe("matchesKeyPress", () => {
  // pi-tui negotiates the Kitty keyboard protocol (or xterm modifyOtherKeys), so
  // a modified key does not always arrive as its legacy control byte. All three
  // encodings must toggle, or the shortcut silently dies on such a terminal.
  it.each([
    ["legacy control byte", "\x0f"],
    ["Kitty CSI-u", "\x1b[111;5u"],
    ["Kitty CSI-u with alternate keys", "\x1b[111::111;5u"],
    ["xterm modifyOtherKeys", "\x1b[27;5;111~"],
  ])("matches the Ctrl+O tool toggle encoded as %s", (_label, data) => {
    expect(matchesKeyPress(data, TOOL_EXPAND_KEYS)).toBe(true);
  });

  it("ignores a Kitty key release so one press toggles exactly once", () => {
    expect(matchesKeyPress("\x1b[111;5:3u", TOOL_EXPAND_KEYS)).toBe(false);
  });

  it("matches the Ctrl+E error toggle across encodings", () => {
    expect(matchesKeyPress("\x05", ERROR_EXPAND_KEYS)).toBe(true);
    expect(matchesKeyPress("\x1b[101;5u", ERROR_EXPAND_KEYS)).toBe(true);
  });

  it("leaves plain text alone", () => {
    expect(matchesKeyPress("o", TOOL_EXPAND_KEYS)).toBe(false);
    expect(matchesKeyPress("hello", TOOL_EXPAND_KEYS)).toBe(false);
  });
});

describe("terminal-specific scroll bindings", () => {
  it("uses Alt in VS Code and Ctrl elsewhere", () => {
    expect(getScrollKeyBindings({ TERM_PROGRAM: "vscode" }).modifier).toBe("Alt");
    expect(getScrollKeyBindings({ TERM_PROGRAM: "MobaXterm" }).modifier).toBe("Ctrl");
    expect(getScrollKeyBindings({}).modifier).toBe("Ctrl");
  });

  it("returns matching Home/End key ids for the selected terminal", () => {
    const vscode = getScrollKeyBindings({ TERM_PROGRAM: "vscode" });
    const other = getScrollKeyBindings({ TERM_PROGRAM: "xterm-256color" });
    expect(vscode.homeKeys).toEqual(["alt+home"]);
    expect(vscode.endKeys).toEqual(["alt+end"]);
    expect(other.homeKeys).toEqual(["ctrl+home"]);
    expect(other.endKeys).toEqual(["ctrl+end"]);
  });
});

describe("copy mode binding", () => {
  // The escape-prefixed encodings are the ones that make Alt risky: under Kitty
  // disambiguation Alt+C is a CSI-u sequence, and only without it does the
  // terminal send the bare "ESC c". Both terminals must toggle copy mode.
  it.each([
    ["Kitty CSI-u", "\x1b[99;3u"],
    ["Kitty CSI-u with event type", "\x1b[99;3:1u"],
    ["xterm modifyOtherKeys", "\x1b[27;3;99~"],
  ])("matches Alt+C encoded as %s under either protocol state", (_label, data) => {
    for (const active of [false, true]) {
      setKittyProtocolActive(active);
      expect(matchesKeyPress(data, COPY_MODE_KEYS), `kitty=${active}`).toBe(true);
    }
  });

  it("matches the legacy ESC-prefixed Alt+C when Kitty is not negotiated", () => {
    setKittyProtocolActive(false);
    expect(matchesKeyPress("\x1bc", COPY_MODE_KEYS)).toBe(true);
  });

  it("ignores a Kitty key release so one press toggles exactly once", () => {
    setKittyProtocolActive(true);
    expect(matchesKeyPress("\x1b[99;3:3u", COPY_MODE_KEYS)).toBe(false);
  });

  // Copy mode shares the keyboard listener with the interrupt/exit shortcuts and
  // both expansion toggles. An overlap would make one of them unreachable.
  it("does not collide with the other global bindings", () => {
    setKittyProtocolActive(true);
    expect(matchShortcut("\x1b[99;3u")).toBeUndefined();
    expect(matchesKeyPress("\x1b[99;3u", TOOL_EXPAND_KEYS)).toBe(false);
    expect(matchesKeyPress("\x1b[99;3u", ERROR_EXPAND_KEYS)).toBe(false);
    // Ctrl+C exits; it must not read as Alt+C.
    expect(matchesKeyPress("\x1b[99;5u", COPY_MODE_KEYS)).toBe(false);
    expect(matchesKeyPress("\x03", COPY_MODE_KEYS)).toBe(false);
    // A plain "c" belongs to the editor.
    expect(matchesKeyPress("c", COPY_MODE_KEYS)).toBe(false);
  });
});

describe("scroll-end binding", () => {
  // Ctrl+End is the keyboard route back to follow mode after the wheel scrolled
  // away from the newest message. Both terminal encodings must reach it.
  it.each([
    ["legacy modifier sequence", "\x1b[8^"],
    ["CSI modifier sequence", "\x1b[1;5F"],
    ["Kitty CSI-u", "\x1b[57424;5u"],
  ])("matches Ctrl+End encoded as %s", (_label, data) => {
    for (const active of [false, true]) {
      setKittyProtocolActive(active);
      expect(matchesKeyPress(data, SCROLL_END_KEYS), `kitty=${active}`).toBe(true);
    }
  });

  it("ignores a Kitty key release so one press re-pins exactly once", () => {
    setKittyProtocolActive(true);
    expect(matchesKeyPress("\x1b[57424;5:3u", SCROLL_END_KEYS)).toBe(false);
  });

  // The editor owns bare End (cursorLineEnd); only the Ctrl-modified form may
  // re-pin the chat viewport.
  it("does not claim bare End", () => {
    setKittyProtocolActive(false);
    expect(matchesKeyPress("\x1b[F", SCROLL_END_KEYS)).toBe(false);
    expect(matchesKeyPress("\x1bOF", SCROLL_END_KEYS)).toBe(false);
  });

  // Ctrl+E toggles error detail; it must not read as Ctrl+End.
  it("does not collide with Ctrl+E or the other global bindings", () => {
    setKittyProtocolActive(true);
    expect(matchesKeyPress("\x1b[1;5F", ERROR_EXPAND_KEYS)).toBe(false);
    expect(matchesKeyPress("\x05", SCROLL_END_KEYS)).toBe(false);
    expect(matchesKeyPress("\x1b[1;5F", TOOL_EXPAND_KEYS)).toBe(false);
    expect(matchesKeyPress("\x1b[1;5F", COPY_MODE_KEYS)).toBe(false);
  });
});

describe("scroll-home binding", () => {
  // Ctrl+Home jumps both panes to their oldest content. All supported terminal
  // encodings must reach it.
  it.each([
    ["legacy modifier sequence", "\x1b[7^"],
    ["CSI modifier sequence", "\x1b[1;5H"],
    ["Kitty CSI-u", "\x1b[57423;5u"],
  ])("matches Ctrl+Home encoded as %s", (_label, data) => {
    for (const active of [false, true]) {
      setKittyProtocolActive(active);
      expect(matchesKeyPress(data, SCROLL_HOME_KEYS), `kitty=${active}`).toBe(true);
    }
  });

  it("ignores a Kitty key release so one press jumps exactly once", () => {
    setKittyProtocolActive(true);
    expect(matchesKeyPress("\x1b[57423;5:3u", SCROLL_HOME_KEYS)).toBe(false);
  });

  // The editor owns bare Home (cursorLineStart); only the Ctrl-modified form
  // may jump the panes.
  it("does not claim bare Home", () => {
    setKittyProtocolActive(false);
    expect(matchesKeyPress("\x1b[H", SCROLL_HOME_KEYS)).toBe(false);
    expect(matchesKeyPress("\x1bOH", SCROLL_HOME_KEYS)).toBe(false);
  });

  // Ctrl+A moves the editor cursor to line start; it must not read as Ctrl+Home.
  it("does not collide with Ctrl+A or the other global bindings", () => {
    setKittyProtocolActive(true);
    expect(matchesKeyPress("\x01", SCROLL_HOME_KEYS)).toBe(false);
    expect(matchesKeyPress("\x1b[1;5H", ERROR_EXPAND_KEYS)).toBe(false);
    expect(matchesKeyPress("\x1b[1;5H", TOOL_EXPAND_KEYS)).toBe(false);
    expect(matchesKeyPress("\x1b[1;5H", COPY_MODE_KEYS)).toBe(false);
    expect(matchesKeyPress("\x1b[1;5H", SCROLL_END_KEYS)).toBe(false);
  });
});

