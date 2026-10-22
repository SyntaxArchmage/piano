import { Effect } from "effect";
import { Key, isKeyRelease, matchesKey, type KeyId } from "@earendil-works/pi-tui";

type Shortcut = "interrupt" | "exit" | "suspend";

/**
 * Ctrl+O: toggle tool-box expansion. One binding on every terminal — the hint
 * chat-render prints in the box title says Ctrl+O, so nothing else may claim it.
 */
export const TOOL_EXPAND_KEYS: readonly KeyId[] = [Key.ctrl("o")];

/** Ctrl+E: toggle the latest error detail. */
export const ERROR_EXPAND_KEYS: readonly KeyId[] = [Key.ctrl("e")];

/**
 * Alt+C: toggle copy mode, which hands the mouse back to the terminal so its
 * own selection (drag, double-click word, triple-click line, copy-on-select)
 * reaches the transcript. Alt is the only free modifier here — the editor owns
 * alt+left/right, alt+b/f, alt+d, alt+y, alt+backspace and alt+delete but not
 * alt+c. Ctrl+S would risk XOFF flow control freezing the terminal, and Ctrl+V
 * collides with the paste muscle memory copy mode exists to serve.
 */
export const COPY_MODE_KEYS: readonly KeyId[] = [Key.alt("c")];

/** Ctrl+End: re-pin the chat viewport and trajectory panel to newest content. */
export const SCROLL_END_KEYS: readonly KeyId[] = [Key.ctrl("end")];

/** Ctrl+Home: move the chat viewport and trajectory panel to oldest content. */
export const SCROLL_HOME_KEYS: readonly KeyId[] = [Key.ctrl("home")];

export type ScrollModifier = "Ctrl" | "Alt";

interface ScrollKeyBindings {
  readonly modifier: ScrollModifier;
  readonly homeKeys: readonly KeyId[];
  readonly endKeys: readonly KeyId[];
}

/** Select the modifier the terminal is least likely to consume locally. */
export function getScrollKeyBindings(env: NodeJS.ProcessEnv = process.env): ScrollKeyBindings {
  const program = env.TERM_PROGRAM?.toLowerCase();
  const modifier: ScrollModifier = program === "vscode" ? "Alt" : "Ctrl";
  return modifier === "Alt"
    ? { modifier, homeKeys: [Key.alt("home")], endKeys: [Key.alt("end")] }
    : { modifier, homeKeys: [Key.ctrl("home")], endKeys: [Key.ctrl("end")] };
}

/**
 * True when `data` is a *press* of one of `keys`.
 *
 * Comparing raw control bytes does not work: pi-tui negotiates the Kitty
 * keyboard protocol (falling back to xterm modifyOtherKeys) at startup, so on a
 * terminal that answers either query a modified key no longer arrives as its
 * legacy byte — Ctrl+O is "\x1b[111;5u", not "\x0f". matchesKey understands
 * every encoding. Kitty flag 2 also reports key releases, and TUI only filters
 * those for the focused component, so an unguarded match would fire twice per
 * press and appear to do nothing.
 */
export function matchesKeyPress(data: string, keys: readonly KeyId[]): boolean {
  if (isKeyRelease(data)) return false;
  return keys.some((key) => matchesKey(data, key));
}

interface ShortcutEffects {
  readonly interrupt: Effect.Effect<void, never>;
  readonly exit: Effect.Effect<void, never>;
  readonly suspend: Effect.Effect<void, never>;
}

/** Escape: interrupt the running agent. */
const INTERRUPT_KEYS: readonly KeyId[] = [Key.escape];
/** Ctrl+C: leave Piano. */
const EXIT_KEYS: readonly KeyId[] = [Key.ctrl("c")];
/**
 * Ctrl+Z: suspend Piano to the shell's job table.
 *
 * Raw mode clears ISIG, so the byte never reaches the tty driver as SIGTSTP and
 * the shell's own job control cannot see the key — the TUI has to raise the
 * signal itself. Without this binding Ctrl+Z is swallowed, which leaves no way
 * out at all whenever exit is otherwise blocked.
 */
const SUSPEND_KEYS: readonly KeyId[] = [Key.ctrl("z")];

/**
 * Decode one terminal input packet without performing a side effect.
 *
 * Matched through matchesKeyPress rather than by byte: under Kitty
 * disambiguation Escape arrives as "\x1b[27u", so a raw comparison left the
 * agent uninterruptible on such a terminal. The legacy bytes "\x1b" and "\x03"
 * are still matched — matchesKey covers them too.
 */
export function matchShortcut(data: string): Shortcut | undefined {
  if (matchesKeyPress(data, INTERRUPT_KEYS)) return "interrupt";
  if (matchesKeyPress(data, EXIT_KEYS)) return "exit";
  if (matchesKeyPress(data, SUSPEND_KEYS)) return "suspend";
  return undefined;
}

/** Dispatch a decoded shortcut through the Effect-owned side effect. */
export function dispatchShortcut(
  data: string,
  effects: ShortcutEffects,
): Effect.Effect<Shortcut | undefined, never> {
  const shortcut = matchShortcut(data);
  return shortcut === undefined
    ? Effect.succeed(undefined)
    : effects[shortcut].pipe(Effect.as(shortcut));
}
