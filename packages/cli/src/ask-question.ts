import { Effect } from "effect";
import { Key, matchesKey, ProcessTerminal, TUI, type Component, type Terminal } from "@earendil-works/pi-tui";
import { interactiveTerminalRequired, TuiError } from "./errors.js";
import { visibleWidth } from "./text.js";
import { RST } from "./theme.js";

export interface AskQuestionOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export interface AskQuestionSpec {
  readonly title: string;
  readonly message?: string;
  /** Extra dim context lines between the message and the options (e.g. the
   * evidence a sign-off reviewer should know about). */
  readonly details?: readonly string[];
  readonly options: readonly AskQuestionOption[];
  readonly allowText?: boolean;
  readonly placeholder?: string;
  /** Called with printable text when a choices-only question (allowText unset)
   * receives it. Such text is not an answer to the gate; without a host that
   * keeps it, it would vanish. The interactive TUI uses this to queue the
   * reviewer's next prompt instead of dropping it. */
  readonly onForeignText?: (data: string) => void;
}

export type AskQuestionAnswer =
  | { readonly type: "option"; readonly id: string }
  | { readonly type: "text"; readonly value: string };

/** Per-surface colors for the question rows; each entry is a raw SGR prefix.
 * The defaults are the standalone-terminal dialog palette; the interactive TUI
 * swaps in the sign-off panel palette when the question is mounted inside the
 * bordered chat block (dark purple fill, light lavender text). */
export interface AskQuestionStyles {
  /** question title */
  readonly title: string;
  /** free-text entry caret */
  readonly caret: string;
  /** message, details, option descriptions and the placeholder */
  readonly muted: string;
  /** unselected option label */
  readonly option: string;
  /** selected option row background */
  readonly selectedBg: string;
  /** selected option row foreground */
  readonly selectedFg: string;
}

const DEFAULT_STYLES: AskQuestionStyles = {
  title: "\x1b[38;2;90;190;255m",
  caret: "\x1b[38;2;90;190;255m",
  muted: "\x1b[2m",
  option: "",
  selectedBg: "\x1b[48;2;38;55;78m",
  selectedFg: "\x1b[38;2;255;255;255m",
};

export interface AskQuestionDeps {
  readonly terminal?: Terminal;
}

const ESC = String.fromCharCode(27);
const ANSI_SGR = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
const MOUSE_SEQUENCE = new RegExp(`^${ESC}\\[<(\\d+);(\\d+);(\\d+)[Mm]$`);

function fit(value: string, width: number): string {
  const limit = Math.max(0, width);
  if (visibleWidth(value) <= limit) return value;
  return [...value.replace(ANSI_SGR, "")].slice(0, Math.max(0, limit - 1)).join("") + "…";
}

function mouse(value: string): { readonly row: number } | undefined {
  const match = MOUSE_SEQUENCE.exec(value);
  if (!match || Number(match[1]) !== 0) return undefined;
  return { row: Number(match[3]) };
}

/** A reusable single-choice or free-text question component. */
export class AskQuestion implements Component {
  private selectedIndex = 0;
  private text = "";
  private textMode = false;

  onAnswer?: (answer: AskQuestionAnswer) => void;
  onCancel?: () => void;

  constructor(readonly spec: AskQuestionSpec, readonly styles: AskQuestionStyles = DEFAULT_STYLES) {}

  get selectedOption(): AskQuestionOption | undefined {
    return this.spec.options[this.selectedIndex];
  }

  get textValue(): string {
    return this.text;
  }

  render(width: number): string[] {
    const styles = this.styles;
    const rows = [
      `${styles.title}${fit(this.spec.title, width)}${RST}`,
    ];
    if (this.spec.message) rows.push(`${styles.muted}${fit(this.spec.message, width)}${RST}`);
    for (const detail of this.spec.details ?? []) {
      rows.push(`${styles.muted}${fit(detail, width)}${RST}`);
    }
    this.spec.options.forEach((option, index) => {
      const selected = !this.textMode && index === this.selectedIndex;
      const prefix = selected ? "❯ " : "  ";
      const description = option.description ? ` ${styles.muted}${option.description}${RST}` : "";
      const content = `${prefix}${option.label}${description}`;
      rows.push(selected
        ? `${styles.selectedBg}${styles.selectedFg}${fit(content, width)}${RST}`
        : styles.option === ""
          ? fit(content, width)
          : `${styles.option}${fit(content, width)}${RST}`);
    });
    if (this.spec.allowText) {
      const value = this.text || `${styles.muted}${this.spec.placeholder ?? "Type a custom answer"}${RST}`;
      const prefix = this.textMode ? `${styles.caret}❯ ${RST}` : "  ";
      rows.push(`${prefix}${fit(value, Math.max(0, width - 2))}`);
    }
    return rows;
  }

  handleInput(data: string): void {
    const clicked = mouse(data);
    if (clicked) {
      const first = 2
        + (this.spec.message !== undefined ? 1 : 0)
        + (this.spec.details?.length ?? 0);
      const index = clicked.row - first;
      if (index >= 0 && index < this.spec.options.length) {
        this.selectedIndex = index;
        this.textMode = false;
      }
      return;
    }
    // Matched through matchesKey rather than by byte: pi-tui negotiates the
    // Kitty keyboard protocol (falling back to xterm modifyOtherKeys) at
    // startup, so on a terminal that answers either query these keys no longer
    // arrive as their legacy bytes — Escape is "\x1b[27u", backspace
    // "\x1b[127u". The legacy bytes still match. "\n" and "\b" are kept
    // explicitly so nothing narrows: matchesKey rejects "\n" once Kitty is
    // active (there it means Ctrl+J) and reads "\b" as Ctrl+Backspace on
    // Windows Terminal.
    if (matchesKey(data, Key.escape)) {
      this.onCancel?.();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.textMode = false;
      this.selectedIndex = this.spec.options.length === 0
        ? 0
        : (this.selectedIndex + this.spec.options.length - 1) % this.spec.options.length;
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.textMode = false;
      this.selectedIndex = this.spec.options.length === 0
        ? 0
        : (this.selectedIndex + 1) % this.spec.options.length;
      return;
    }
    if (matchesKey(data, Key.enter) || data === "\n") {
      if (this.textMode && this.text.trim()) {
        this.onAnswer?.({ type: "text", value: this.text });
      } else if (this.selectedOption) {
        this.onAnswer?.({ type: "option", id: this.selectedOption.id });
      }
      return;
    }
    if (!this.spec.allowText) {
      // Printable text is not one of the gate's keys; hand it to the host so
      // the reviewer's typing survives the review instead of vanishing.
      if (data.length > 0 && !data.startsWith("\x1b")) this.spec.onForeignText?.(data);
      return;
    }
    if (matchesKey(data, Key.backspace) || data === "\b") {
      this.text = this.text.slice(0, -1);
      this.textMode = true;
      return;
    }
    if (data.length > 0 && !data.startsWith("\x1b")) {
      this.text += data;
      this.textMode = true;
    }
  }

  invalidate(): void {}
}

/** Run one question at the terminal boundary; the component itself stays pure. */
export function askQuestion(
  spec: AskQuestionSpec,
  deps: AskQuestionDeps = {},
): Effect.Effect<AskQuestionAnswer | undefined, TuiError> {
  if (deps.terminal === undefined && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    return Effect.fail(interactiveTerminalRequired());
  }
  return Effect.try({
    try: () => {
      const terminal = deps.terminal ?? new ProcessTerminal();
      const tui = new TUI(terminal);
      const question = new AskQuestion(spec);
      tui.addChild(question);
      tui.setFocus(question);
      return { terminal, tui, question };
    },
    catch: (cause) => new TuiError({ operation: "create", message: String(cause) }),
  }).pipe(
    Effect.flatMap(({ terminal, tui, question }) => {
      let dispose = (): void => {};
      const effect = Effect.async<AskQuestionAnswer | undefined, TuiError>((resume) => {
        let finished = false;
        let disposed = false;
        let removeInput: () => void = () => {};
        dispose = (): void => {
          if (disposed) return;
          disposed = true;
          removeInput();
          terminal.write("\x1b[?1000;1006l");
          tui.stop();
        };
        const finish = (answer: AskQuestionAnswer | undefined): void => {
          if (finished) return;
          finished = true;
          resume(Effect.succeed(answer));
        };
        question.onAnswer = finish;
        question.onCancel = () => finish(undefined);
        removeInput = tui.addInputListener((data) => {
          if (matchesKey(data, Key.ctrl("c")) || data === "\x03") {
            finish(undefined);
            return { consume: true };
          }
          return undefined;
        });
        terminal.write("\x1b[?1000;1006h");
        tui.start();
        return Effect.sync(() => dispose());
      });
      return effect.pipe(Effect.ensuring(Effect.sync(() => dispose())));
    }),
  );
}
