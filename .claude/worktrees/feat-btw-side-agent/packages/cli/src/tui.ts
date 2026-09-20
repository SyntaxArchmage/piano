import { Duration, Effect, Fiber } from "effect";
import { stdin, stdout } from "node:process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  Container,
  CombinedAutocompleteProvider,
  Editor,
  ProcessTerminal,
  Text,
  TUI,
  visibleWidth,
  type Component,
  type EditorTheme,
  type Terminal,
} from "@earendil-works/pi-tui";
import { type AgentEvent, type SteerDelivery } from "@piano/harness";
import { failureDetails, isCancellation, type FailureDetails } from "@piano/logging";
import {
  WorkflowError,
  type WorkflowSignoffDecision,
  type WorkflowSignoffRequest,
} from "@piano/orchestrator";
import { TranscriptView } from "./chat-render.js";
import { TuiError } from "./errors.js";
import { AskQuestion, type AskQuestionAnswer, type AskQuestionSpec, type AskQuestionStyles } from "./ask-question.js";
import { runSignoffDialog, signoffDecisionText } from "./signoff.js";
import { buildFacePage, setTheme } from "./tui-face.js";
import { detectTheme, RST, type PianoTheme } from "./theme.js";
import { TrajectoryPanel } from "./trajectory-panel.js";
import { renderStatusPanel } from "./status-panel.js";
import {
  parseWorkflowGraphSnapshot,
  WorkflowGraph,
  type WorkflowGraphDefinition,
  type WorkflowGraphSnapshot,
} from "./workflow-graph.js";
import { DEFAULT_SPLIT_RATIO, emptySplitDrag, isWithinRightPane, parseSgrMouse, rightColumns, stepSplitDrag } from "./split-drag.js";
import { SideBySide } from "./tui-face.js";
import { COPY_MODE_KEYS, ERROR_EXPAND_KEYS, TOOL_EXPAND_KEYS, dispatchShortcut, getScrollKeyBindings, matchShortcut, matchesKeyPress } from "./shortcuts.js";
import { appendPromptHistory, loadPromptHistory } from "./prompt-history.js";
import { WorkspacePicker } from "./workspace-picker.js";
import { WorkflowPicker } from "./workflow-picker.js";
import { SessionPicker } from "./session-picker.js";
import { slashCommandsForAutocomplete } from "./tui-commands.js";
import { applyRunStat, emptyRunStats, markTerminal, type RunStats } from "./run-stats.js";

export interface TuiPromptResult {
  readonly text: string;
  readonly sessionId?: string;
  readonly transcriptPath?: string;
  readonly trajectoryPath?: string;
  readonly progressPath?: string;
  readonly progressSnapshotPath?: string;
  readonly error?: FailureDetails;
}

/** How this TUI runs one accepted prompt. Both the mission workflow and
 * `/btw`'s side agent are handed to the TUI in this shape, so the prompt path
 * (steering, queueing, interrupts, outcome reporting) is written once. */
export type TuiPromptRunner = (
  prompt: string,
  onEvent: (event: AgentEvent) => void,
  /** Sign-off channel backed by this TUI: the engine blocks on it while a
   * review question is mounted as the last block of the chat area (right
   * above the prompt), so the human answers on the live UI. */
  signoff?: (request: WorkflowSignoffRequest) => Effect.Effect<WorkflowSignoffDecision, WorkflowError>,
) => Effect.Effect<string | TuiPromptResult, unknown>;

export interface TuiOptions {
  readonly terminal?: Terminal;
  readonly onInterrupt?: Effect.Effect<void, never>;
  readonly onTaskEvent?: (event: TuiTaskEvent) => void;
  /** Root dir for persistent prompt history (~/.piano by default); best-effort. */
  readonly historyRoot?: string;
  readonly runPrompt?: TuiPromptRunner;
  /** `/btw`'s side agent: one direct agent call per prompt, no workflow. It
   * takes the same runner shape as `runPrompt` so both share this TUI's single
   * prompt path (steering, queueing, interrupt, task events). The sign-off
   * argument is passed but unused — a lone agent call has no workflow gate. */
  readonly runSideAgent?: TuiPromptRunner;
  /** Deliver a mid-turn steering message to the live prompt's session. The
   * channel answers per capability ("delivered" / "no-active-turn"); the TUI
   * never learns which harness is running. Absent in tests without steering. */
  readonly steerActive?: (text: string) => Promise<SteerDelivery>;
  /** Persist a user-assigned name for the current run via `/rename <name>`.
   * The effect carries no service requirements (the caller provides its own). */
  readonly onRename?: (name: string) => Effect.Effect<void, unknown>;
  readonly workspaceCwd?: string;
  readonly onWorkspaceChange?: (cwd: string) => Effect.Effect<void, unknown>;
  readonly onWorkflowChange?: (workflowPath: string, builtinName?: string) => Effect.Effect<WorkflowGraphDefinition, unknown>;
  /** Runs root the `/resume` picker enumerates. `/resume` needs both this and
   * `onResume`; without them the command reports that it is unavailable. */
  readonly runsRoot?: string;
  /** Run this TUI is currently writing to, marked in the picker. */
  readonly currentRunId?: string;
  /** Hand this TUI over to another run: the caller reopens that run's session
   * and returns what the chat must replay plus the paths the footer reads.
   * Takeover is in place — the process and the terminal are not restarted. */
  readonly onResume?: (runId: string) => Effect.Effect<TuiResumeResult, unknown>;
  /** Take this run over as soon as the TUI opens (`piano resume <run-id>`). */
  readonly resumeRunId?: string;
  /** Open the resume picker as soon as the TUI opens (`piano resume`). */
  readonly resumePicker?: boolean;
  /** Optional compiled workflow graph and run snapshot for the read-only
   * status footer. The snapshot is never read from inside render(). */
  readonly workflowGraph?: WorkflowGraphDefinition;
  readonly progressSnapshotPath?: string;
  /** Override how Ctrl+Z suspends the process. Tests inject a stub — the real
   * SIGTSTP would stop the test runner along with the TUI. */
  readonly suspendProcess?: () => void;
}

/**
 * How long `/exit` (or Ctrl+C) waits for an interrupted prompt to drain its
 * finalizers before closing anyway.
 *
 * Draining matters — finalizers still log and render — but it cannot be
 * unbounded: finalizers run uninterruptibly, so one that never settles used to
 * keep the TUI mounted in raw mode with the exit keys latched off for good.
 */
const EXIT_DRAIN_TIMEOUT_MS = 2000;

/** Ctrl+Z's default: stop ourselves the way the tty driver would have, putting
 * Piano in the shell's job table (`fg` resumes it). */
function suspendThisProcess(): void {
  process.kill(process.pid, "SIGTSTP");
}

/** One prompt from a resumed run, replayed into the chat in its original order. */
export interface TuiReplayTurn {
  readonly prompt: string;
  readonly events: readonly AgentEvent[];
  /** Terminal state the turn reached. An interrupted turn is `cancelled` and
   * must replay as "interrupted", not as a failed run. */
  readonly status?: "completed" | "failed" | "cancelled";
  /** Failure recorded for this turn, replayed as the same error box the live
   * run showed. */
  readonly error?: FailureDetails;
}

/** What a takeover changes about the running TUI. */
export interface TuiResumeResult {
  readonly runId: string;
  readonly turns: readonly TuiReplayTurn[];
  readonly workspaceCwd?: string;
  readonly workflowGraph?: WorkflowGraphDefinition;
  readonly progressSnapshotPath?: string;
}

export type TuiTaskEvent =
  | { readonly type: "input.accepted"; readonly prompt: string }
  | { readonly type: "agentic.task.started"; readonly prompt: string }
  | { readonly type: "agentic.task.completed"; readonly prompt: string; readonly textLength: number; readonly sessionId?: string; readonly transcriptPath?: string }
  | { readonly type: "agentic.task.failed"; readonly prompt: string; readonly error: unknown }
  | { readonly type: "agentic.task.cancelled"; readonly prompt: string; readonly error: unknown };

interface PromptState {
  fiber?: Fiber.RuntimeFiber<unknown, unknown>;
  cancelled: boolean;
  outcomeReported: boolean;
}

interface ResizeHandlerRef {
  current: () => void;
}

/** Let the shell observe the resize callback that pi-tui passes to Terminal.
 * This keeps injected terminals on the same path as ProcessTerminal without
 * changing pi-tui's Terminal API. */
function withResizeHandler(terminal: Terminal, handler: ResizeHandlerRef): Terminal {
  return new Proxy(terminal, {
    get(target, property) {
      if (property === "start") {
        return (onInput: (data: string) => void, onResize: () => void): void => {
          target.start(onInput, () => {
            onResize();
            handler.current();
          });
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export interface TuiResult {
  readonly type: "closed";
  /** True when `/exit` (or Ctrl+C) closed the TUI while the interrupted
   * prompt's finalizers were still wedged past the drain budget. The session
   * layer turns this verdict into a stalled-exit guard: something is still
   * holding the process, and the shell must not wait on it. */
  readonly stalled?: boolean;
}

/** Empty-transcript greeting: renders the face page recentred to the current
 * chat width, so collapsing the trajectory sidebar widens and recentres it. */
class FacePage {
  render(width: number): string[] {
    return buildFacePage(Math.max(1, Math.floor(width))).split("\n");
  }
  invalidate(): void {}
}

/** Paint one rendered row over a background strip `width` cells wide. The
 * row's own color codes end in RESETs that would otherwise drop the
 * background mid-row, so the strip background is re-asserted after every
 * RESET, and the remainder of the row is padded with painted spaces to reach
 * the full width. Used for the fill inside the sign-off panel only. */
function paintBlockRow(line: string, width: number, bg: string): string {
  const body = `${bg}${line.replaceAll(RST, `${RST}${bg}`)}`;
  const padding = Math.max(0, width - visibleWidth(line));
  return `${body}${" ".repeat(padding)}${RST}`;
}

/** Question-row palette for a review mounted inside the sign-off panel. */
export function signoffStyles(theme: PianoTheme): AskQuestionStyles {
  return {
    title: theme.signoffTitle,
    caret: theme.signoffText,
    muted: theme.signoffMuted,
    option: theme.signoffText,
    selectedBg: theme.signoffSelectedBg,
    selectedFg: theme.signoffSelectedFg,
  };
}

/** One row of the sign-off panel: a vertical border glyph at each edge and a
 * very dark purple fill (theme signoff roles) in between. The fill is painted
 * first so the row's own RESETs cannot leak the terminal background into the
 * panel, and the trailing border is re-coloured after the fill's final RESET. */
function signoffPanelRow(line: string, width: number, theme: PianoTheme): string {
  const edge = `${theme.signoffBorder}│${RST}`;
  return `${edge}${paintBlockRow(line, Math.max(0, width - 2), theme.signoffBg)}${edge}`;
}

/** Horizontal border (top or bottom) of the sign-off panel: only the
 * box-drawing outline is painted — the row itself never carries the fill. */
function signoffPanelEdge(left: string, right: string, width: number, theme: PianoTheme): string {
  return `${theme.signoffBorder}${left}${"─".repeat(Math.max(0, width - 2))}${right}${RST}`;
}

/** Sign-off review question mounted as the newest chat block, drawn as a
 * bordered panel: the box outline is the only full-width colour (theme
 * signoffBorder) and the interior carries a very dark purple fill
 * (signoffBg). The panel's vertical footprint is exactly the question's own
 * rows plus the two border rows, so it sits as compactly above the prompt as
 * the previous strip. The AskQuestion child keeps the keyboard; this wrapper
 * is pure presentation. Exported for tests. */
export class SignoffBlock implements Component {
  constructor(
    private readonly question: AskQuestion,
    private readonly theme: PianoTheme,
  ) {}

  invalidate(): void {
    this.question.invalidate();
  }

  render(width: number): string[] {
    const rows: string[] = [signoffPanelEdge("┌", "┐", width, this.theme)];
    // One leading space between the left border and the question text keeps the
    // title at column 2; the text zone spans width - 3 cells.
    for (const line of this.question.render(Math.max(1, width - 3))) {
      rows.push(signoffPanelRow(` ${line}`, width, this.theme));
    }
    rows.push(signoffPanelEdge("└", "┘", width, this.theme));
    return rows;
  }
}

/** Keep the conversation in a fixed viewport so the prompt and footer stay
 * anchored while the mouse wheel moves through older chat content.
 *
 * Exported for tests: `scrollEnd` is the re-pin path that expand/collapse
 * toggles depend on, and a regression there strands the viewport in the middle
 * of the conversation with no keyboard route back to the newest message. */
export class ScrollableChatArea implements Component {
  private pinned = true;
  private scrollTop = 0;
  private contentRows = 0;
  private visibleRows = 1;

  constructor(
    private readonly content: Component,
    private readonly viewportRows: () => number,
  ) {}

  invalidate(): void {
    this.content.invalidate();
  }

  isWithin(row: number): boolean {
    return Number.isSafeInteger(row) && row >= 1 && row <= this.visibleRows;
  }

  scrollBy(delta: number): boolean {
    const max = Math.max(0, this.contentRows - this.visibleRows);
    const current = this.pinned ? max : this.scrollTop;
    const next = Math.min(max, Math.max(0, current + delta));
    if (this.pinned && next === current) return false;
    // The wheel is also the way back into follow mode: scrolling down to the
    // newest row re-pins, so auto-scroll resumes without needing a shortcut.
    this.pinned = next === max;
    this.scrollTop = next;
    return next !== current;
  }

  /**
   * Re-pin the viewport to the newest message.
   *
   * Toggling tool-box or error-detail expansion reflows the transcript by an
   * unbounded number of rows, so a `scrollTop` captured before the toggle points
   * at unrelated content afterwards. Pinning (rather than assigning `scrollTop`)
   * defers the offset to the next `render`, which is the only place the new
   * content height is known.
   */
  scrollEnd(): void {
    this.pinned = true;
  }

  /** Jump to the oldest content: unpin at the top of the transcript. */
  scrollHome(): void {
    this.pinned = false;
    this.scrollTop = 0;
  }

  /** True while the viewport follows the newest message. */
  get isPinned(): boolean {
    return this.pinned;
  }

  render(width: number): string[] {
    this.visibleRows = Math.max(1, Math.floor(this.viewportRows()));
    const lines = this.content.render(width);
    this.contentRows = lines.length;
    const max = Math.max(0, this.contentRows - this.visibleRows);
    if (this.pinned) this.scrollTop = max;
    else this.scrollTop = Math.min(max, Math.max(0, this.scrollTop));
    const visible = lines.slice(this.scrollTop, this.scrollTop + this.visibleRows);
    while (visible.length < this.visibleRows) visible.push("");
    return visible;
  }
}

/** Holds whichever conversation is in front of the chat pane.
 *
 * `/btw` brings the side agent's own container forward and puts the mission's
 * behind it — neither is torn down by the visit, so leaving the side agent
 * restores the mission chat exactly as it was left. The indirection exists
 * because the scroll viewport binds its content once, at construction. */
export class ChatSurface implements Component {
  constructor(private front: Component) {}

  setFront(front: Component): void {
    this.front = front;
  }

  render(width: number): string[] {
    return this.front.render(width);
  }

  invalidate(): void {
    this.front.invalidate();
  }
}

function editorTheme(theme: PianoTheme): EditorTheme {
  return {
    borderColor: (value) => `${theme.accent}${value}${RST}`,
    selectList: {
      selectedPrefix: (value) => `${theme.accent}${value}${RST}`,
      selectedText: (value) => `${theme.accent}${value}${RST}`,
      description: (value) => `${theme.dim}${value}${RST}`,
      scrollInfo: (value) => `${theme.dim}${value}${RST}`,
      noMatch: (value) => `${theme.dim}${value}${RST}`,
    },
  };
}

async function readWorkflowSnapshot(path: string): Promise<WorkflowGraphSnapshot | undefined> {
  try {
    return parseWorkflowGraphSnapshot(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch {
    // The snapshot is a convenience view. Missing, malformed, or concurrently
    // replaced files must not interrupt the interactive session.
    return undefined;
  }
}

/** Generic Piano shell: presentation and terminal input only. */
export function runTui(
  deps: TuiOptions = {},
): Effect.Effect<TuiResult, TuiError> {
  if (deps.terminal === undefined && (!stdin.isTTY || !stdout.isTTY)) {
    return Effect.fail(new TuiError({ operation: "terminal", message: "an interactive terminal is required" }));
  }
  return Effect.try({
    try: () => {
      const theme = detectTheme();
      setTheme(theme);
      const terminal = deps.terminal ?? new ProcessTerminal();
      const terminalResize: ResizeHandlerRef = { current: () => {} };
      const tui = new TUI(withResizeHandler(terminal, terminalResize));
      const editor = new Editor(tui, editorTheme(theme));
      editor.setAutocompleteProvider(new CombinedAutocompleteProvider(
        slashCommandsForAutocomplete(),
        process.cwd(),
        null,
      ));
      const footer = new Text("", 0, 0);
      const scrollKeys = getScrollKeyBindings();
      const split = emptySplitDrag(DEFAULT_SPLIT_RATIO);
      const divider = { color: theme.dim };
      const trajectory = new TrajectoryPanel(
        theme,
        () => Math.max(1, terminal.rows - editor.render(terminal.columns).length - footer.render(terminal.columns).length),
        scrollKeys.modifier,
      );
      const chatArea = new Container();
      // The face page serves as the empty transcript greeting; the transcript
      // appends conversation + tools below it. It re-centres to the current chat
      // width when the trajectory sidebar is toggled.
      chatArea.addChild(new FacePage());
      const transcript = new TranscriptView(chatArea, theme);
      // `/btw` swaps what this pane shows; the viewport keeps scrolling
      // whichever conversation is in front.
      const chatSurface = new ChatSurface(chatArea);
      const chatViewport = new ScrollableChatArea(
        chatSurface,
        () => Math.max(1, terminal.rows - editor.render(terminal.columns).length - footer.render(terminal.columns).length),
      );
      const historyRoot = deps.historyRoot ?? join(homedir(), ".piano");
      // Seed the editor's in-memory history from the persisted prompt history.
      for (const entry of loadPromptHistory(historyRoot)) {
        editor.addToHistory(entry);
      }
      tui.addChild(new SideBySide(chatViewport, { render: () => [], invalidate: () => {} }, split, divider));
      const trajectoryOverlay = tui.showOverlay(trajectory, {
        anchor: "top-right",
        width: rightColumns(split.ratio, terminal.columns),
        maxHeight: "100%",
        nonCapturing: true,
      });
      tui.addChild(editor);
      tui.addChild(footer);
      tui.setFocus(editor);
      return { terminal, terminalResize, tui, editor, footer, theme, split, trajectory, chatArea, chatSurface, chatViewport, transcript, trajectoryOverlay, historyRoot, scrollKeys };
    },
    catch: (cause) => new TuiError({ operation: "create", message: String(cause) }),
  }).pipe(
    Effect.flatMap(({ terminal, terminalResize, tui, editor, footer, theme, split, trajectory, chatArea: missionChatArea, chatSurface, chatViewport, transcript: missionTranscript, trajectoryOverlay: trajectoryOverlayInitial, historyRoot, scrollKeys }) => {
      // The chat the developer is looking at. `/btw` reassigns both to the side
      // agent's own pair and back, so every call site below keeps addressing
      // "the conversation in front" without knowing which one that is.
      let chatArea = missionChatArea;
      let transcript = missionTranscript;
      let graph: WorkflowGraph | undefined;
      let stats: RunStats = emptyRunStats();
      let runStartTime = Date.now();
      // Reassignable because `/resume` takes this TUI over to another run
      // directory, and the workflow graph polls the snapshot of whichever run is
      // now current.
      let progressSnapshotPath = deps.progressSnapshotPath;
      // Copy mode releases the mouse to the terminal so its native selection can
      // reach the transcript. Declared here, beside the other footer inputs,
      // because the footer is the only indicator that the wheel has changed hands.
      let copyMode = false;
      let exitTimer: ReturnType<typeof setInterval> | undefined;
      /** Footer status line while `/exit` drains an in-flight worker. Its
       * presence (and 250ms repaint) makes a wedged exit read as
       * exit-in-progress instead of a dead key. */
      let exitDrainMsg: string | undefined;
      /** Footer status line while `/btw`'s side agent owns the chat, so it is
       * always visible that input goes to the side agent, not to the mission. */
      let sideAgentMsg: string | undefined;
      const refreshFooter = (): void => {
        const currentStats = { ...stats, elapsedMs: Date.now() - runStartTime };
        const panel = renderStatusPanel(theme, terminal.columns, graph, currentStats, copyMode, scrollKeys.modifier).join("\n");
        const notices = [exitDrainMsg, sideAgentMsg].filter((line): line is string => line !== undefined);
        footer.setText([...notices, panel].join("\n"));
      };
      /** Create the workflow graph, or point the existing one at a new
       * definition. Shared by `/workflow` and `/resume`, which both change what
       * the footer should be tracking. */
      const bindGraph = (definition: WorkflowGraphDefinition): void => {
        if (graph === undefined) {
          if (progressSnapshotPath === undefined) return;
          graph = new WorkflowGraph(
            definition,
            () => readWorkflowSnapshot(progressSnapshotPath!),
            theme,
            () => {
              refreshFooter();
              tui.requestRender();
            },
          );
          void graph.refresh();
          return;
        }
        graph.setDefinition(definition);
      };
      if (deps.workflowGraph !== undefined) bindGraph(deps.workflowGraph);
      refreshFooter();
      let dispose = (): void => {};
      const effect = Effect.async<TuiResult, TuiError>((resume) => {
        let finished = false;
        let disposed = false;
        /** True from the moment Ctrl+Z hands the terminal back until SIGCONT
         * re-arms it, so a stray render cannot write to a released terminal. */
        let suspended = false;
        let promptRunning = false;
        let resumeRunning = false;
        let activePrompt: PromptState | undefined;
        let pendingPrompt: string | undefined;
        let activeRunId: string | undefined = deps.currentRunId;
        let blinkTimer: ReturnType<typeof setInterval> | undefined;
        let removeInput: () => void = () => {};
        let workspaceOverlay: { hide: () => void } | undefined;
        let workflowOverlay: { hide: () => void } | undefined;
        let sessionOverlay: { hide: () => void } | undefined;
        /** True while a sign-off question is mounted as the last block of the
         * chat area. It owns the keyboard while open, so Escape must reach the
         * question (cancelling the review) instead of interrupting the agent,
         * and trajectory rebuilds defer like they do for the modal pickers. */
        let signoffOpen = false;
        /** True while a modal picker owns the keyboard. Escape and the trajectory
         * overlay resize both have to defer to it. */
        const pickerOpen = (): boolean =>
          workspaceOverlay !== undefined || workflowOverlay !== undefined || sessionOverlay !== undefined
          || signoffOpen;
        let trajectoryOverlayResizePending = false;
        // Reassignable overlay handle: drag-resize recreates the trajectory
        // overlay because OverlayHandle has no setWidth (decision 0024).
        let trajectoryOverlay = trajectoryOverlayInitial;
        /** Re-arm after Ctrl+Z: the shell restored the tty to cooked mode while
         * we were stopped, so raw mode, the mouse and the whole frame have to be
         * re-established. A repaint is forced because the screen below us moved. */
        const onContinue = (): void => {
          if (!suspended || disposed || finished) return;
          suspended = false;
          tui.start();
          if (!copyMode) terminal.write("\x1b[?1002;1006h");
          tui.requestRender(true);
        };
        process.on("SIGCONT", onContinue);
        dispose = (): void => {
          if (disposed) return;
          disposed = true;
          if (blinkTimer !== undefined) clearInterval(blinkTimer);
          if (exitTimer !== undefined) clearInterval(exitTimer);
          graph?.dispose();
          removeInput();
          if (activePrompt !== undefined && !activePrompt.outcomeReported) {
            activePrompt.cancelled = true;
          }
          if (activePrompt?.fiber !== undefined) Effect.runFork(Fiber.interrupt(activePrompt.fiber));
          trajectoryOverlay.hide();
          workspaceOverlay?.hide();
          workflowOverlay?.hide();
          sessionOverlay?.hide();
          terminal.write("\x1b[?1002;1006l");
          tui.stop();
          process.off("SIGCONT", onContinue);
        };
        /** Release the TUI. Idempotent: Effect.async ignores a repeat resume, so
         * the escalation path can call this while the first exit still drains.
         * Carries the stall verdict: true when the interrupted prompt was still
         * wedged past its drain budget, so the session layer arms the exit guard. */
        let exitStalled = false;
        const closeNow = Effect.sync(() => {
          if (exitTimer !== undefined) clearInterval(exitTimer);
          // The drain verdict, if any, must be in the output stream BEFORE the
          // TUI stops. Diff renders are scheduled (nextTick/timer) and tests
          // drive the close with fake timers, so nothing here may await a
          // paint: write the final line directly.
          if (exitDrainMsg !== undefined) {
            terminal.write(`\x1b[0m\n${exitDrainMsg}\n`);
          }
          resume(Effect.succeed({ type: "closed", ...(exitStalled ? { stalled: true } : {}) }));
        });
        /** Cancel the in-flight run (the caller's AbortController). */
        const abortRun = deps.onInterrupt ?? Effect.void;
        const finish = (): Effect.Effect<void, never> => {
          // A repeat exit while the first one is still draining closes right
          // away instead of returning a silent no-op: cleanup that outlasts the
          // timeout below must never make Ctrl+C look dead, because raw mode
          // clears ISIG and leaves the user no signal-based way out. A first
          // exit that has not finished by the second press is, by definition,
          // still draining — the escalation marks the run stalled.
          if (finished) {
            exitStalled = true;
            exitDrainMsg = "exited with stalled worker(s) (finalizers wedged)";
            return closeNow;
          }
          finished = true;
          const prompt = activePrompt;
          if (prompt !== undefined && !prompt.outcomeReported) prompt.cancelled = true;
          if (prompt?.fiber !== undefined) {
            // The blink timer dies with the prompt; without this line and its
            // repaint the drain window is visually identical to a hang.
            exitDrainMsg = `exiting — waiting up to ${EXIT_DRAIN_TIMEOUT_MS / 1000}s for worker(s)`;
            refreshFooter();
            tui.requestRender();
            exitTimer = setInterval(() => {
              refreshFooter();
              tui.requestRender();
            }, 250);
          }
          // Abort the in-flight run before interrupting its fiber. Subprocess
          // harnesses spawn detached in their own process group, so an
          // un-aborted child outlives the TUI and its open stdio pipes keep the
          // process alive long after the terminal was handed back — the run
          // looks exited but the shell never gets its prompt.
          const abort = prompt === undefined ? Effect.void : abortRun;
          // Interrupt the active prompt fiber AND await it draining its finalizers
          // (ensuring blocks: trajectory.complete, log flush, promptRunning reset)
          // before resolving, so /exit never tears down the TUI while the prompt's
          // cleanup still calls render/log on a closed terminal. Bounded, because
          // finalizers run uninterruptibly: one that never settles (an SDK abort
          // awaiting a dead socket, a stuck workspace cleanup) would otherwise
          // strand the TUI mounted in raw mode with every exit key latched off.
          // A timeout is the stall verdict carried in TuiResult.
          const drain = prompt?.fiber === undefined
            ? Effect.void
            : Fiber.interruptFork(prompt.fiber).pipe(
              Effect.andThen(Fiber.await(prompt.fiber).pipe(
                Effect.timeoutOption(Duration.millis(EXIT_DRAIN_TIMEOUT_MS)),
                Effect.tap((drained) => drained._tag === "None"
                  ? Effect.sync(() => {
                    exitStalled = true;
                    // Stays until closeNow so the last rendered frame and the
                    // pty scrollback carry the stall verdict.
                    exitDrainMsg = "exited with stalled worker(s) (finalizers wedged)";
                    refreshFooter();
                    tui.requestRender();
                  })
                  : Effect.sync(() => {
                    // Clean drain: restore the ordinary footer before closeNow's paint.
                    exitDrainMsg = undefined;
                    refreshFooter();
                  })),
                Effect.catchAll(() => Effect.void),
              )),
            );
          return abort.pipe(
            Effect.andThen(drain),
            Effect.andThen(Effect.sync(() => {
              if (activePrompt === prompt) activePrompt = undefined;
            })),
            Effect.andThen(closeNow),
          );
        };
        /** Ctrl+Z: hand the terminal back, raise SIGTSTP, re-arm on SIGCONT.
         * The TUI has to do this itself — see SUSPEND_KEYS. */
        const suspend = Effect.sync(() => {
          if (finished || disposed) return;
          suspended = true;
          terminal.write("\x1b[?1002;1006l");
          tui.stop();
          (deps.suspendProcess ?? suspendThisProcess)();
        });
        const shortcutEffects = {
          interrupt: abortRun,
          exit: Effect.suspend(finish),
          suspend,
        };
        const toggleSide = (): void => {
          split.visible = !split.visible;
          trajectoryOverlay.setHidden(!split.visible);
          tui.requestRender();
        };
        const recreateTrajectoryOverlay = (): void => {
          if (pickerOpen()) {
            trajectoryOverlayResizePending = true;
            return;
          }
          trajectoryOverlayResizePending = false;
          const visible = split.visible;
          trajectoryOverlay.hide();
          trajectoryOverlay = tui.showOverlay(trajectory, {
            anchor: "top-right",
            width: rightColumns(split.ratio, terminal.columns),
            maxHeight: "100%",
            nonCapturing: true,
          });
          if (!visible) trajectoryOverlay.setHidden(true);
        };
        const recreatePendingTrajectoryOverlay = (): void => {
          if (trajectoryOverlayResizePending) recreateTrajectoryOverlay();
        };
        let workspaceCwd = deps.workspaceCwd ?? process.cwd();
        const openWorkspacePicker = (): void => {
          if (workspaceOverlay !== undefined) return;
          const picker = new WorkspacePicker({
            cwd: workspaceCwd,
            onRender: () => tui.requestRender(),
            theme,
            onCancel: () => {
              workspaceOverlay?.hide();
              workspaceOverlay = undefined;
              recreatePendingTrajectoryOverlay();
              tui.setFocus(editor);
              tui.requestRender();
            },
            onChoose: (cwd) => {
              const previous = workspaceCwd;
              const finish = (): void => {
                workspaceCwd = cwd;
                workspaceOverlay?.hide();
                workspaceOverlay = undefined;
                recreatePendingTrajectoryOverlay();
                tui.setFocus(editor);
                transcript.appendText(`  ${theme.dim}workspace: ${cwd}${RST}`);
                // The side agent's footer notice names the tree it can write
                // to, so a workspace change has to rewrite it.
                if (sideAgent !== undefined) showChat(sideAgent);
                tui.requestRender();
              };
              if (deps.onWorkspaceChange === undefined) {
                finish();
                return;
              }
              Effect.runFork(deps.onWorkspaceChange(cwd).pipe(
                Effect.tap(() => Effect.sync(finish)),
                Effect.tapError((error) => Effect.sync(() => {
                  transcript.appendText(`  ${theme.error}✗ workspace change failed${RST} ${theme.error}${error instanceof Error ? error.message : String(error)}${RST}`);
                  workspaceCwd = previous;
                  tui.requestRender();
                })),
                Effect.catchAll(() => Effect.void),
              ));
            },
          });
          workspaceOverlay = tui.showOverlay(picker, {
            anchor: "center",
            width: "70%",
            maxHeight: "70%",
          });
          tui.setFocus(picker);
          tui.requestRender();
        };
        const openWorkflowPicker = (): void => {
          if (workflowOverlay !== undefined || deps.onWorkflowChange === undefined) return;
          const picker = new WorkflowPicker({
            cwd: workspaceCwd,
            onRender: () => tui.requestRender(),
            theme,
            onCancel: () => {
              workflowOverlay?.hide();
              workflowOverlay = undefined;
              recreatePendingTrajectoryOverlay();
              tui.setFocus(editor);
              tui.requestRender();
            },
            onChoose: (workflowPath, builtinName) => {
              Effect.runFork(deps.onWorkflowChange!(workflowPath, builtinName).pipe(
                Effect.tap((definition) => Effect.sync(() => {
                  bindGraph(definition);
                  workflowOverlay?.hide();
                  workflowOverlay = undefined;
                  recreatePendingTrajectoryOverlay();
                  tui.setFocus(editor);
                  transcript.appendText(`  ${theme.dim}workflow: ${definition.name ?? workflowPath}${theme.dim} · ${definition.path ?? workflowPath}${RST}`);
                  refreshFooter();
                  tui.requestRender();
                })),
                Effect.tapError((error) => Effect.sync(() => {
                  transcript.appendText(`  ${theme.error}✗ workflow change failed${RST} ${theme.error}${error instanceof Error ? error.message : String(error)}${RST}`);
                  tui.requestRender();
                })),
                Effect.catchAll(() => Effect.void),
              ));
            },
          });
          workflowOverlay = tui.showOverlay(picker, { anchor: "center", width: "70%", maxHeight: "70%" });
          tui.setFocus(picker);
          tui.requestRender();
        };
        /** Replace the chat with a resumed run's conversation, so the TUI reads
         * as if this session had never been interrupted. */
        const replayResume = (result: TuiResumeResult): void => {
          transcript.reset();
          if (result.turns.length === 0) {
            // Nothing to replay (a run that recorded no accepted prompt). Restore
            // the greeting rather than leaving an empty canvas.
            chatArea.addChild(new FacePage());
          }
          for (const turn of result.turns) {
            transcript.renderUserMessage(turn.prompt);
            for (const event of turn.events) transcript.renderEvent(event);
            if (turn.error !== undefined) {
              transcript.appendError(turn.status === "cancelled" ? "interrupted" : "run failed", turn.error);
            }
            editor.addToHistory(turn.prompt);
          }
          // The trajectory panel is per-prompt, so it carries the last turn only
          // — the same thing it showed when that run stopped.
          const last = result.turns.at(-1);
          if (last !== undefined) {
            trajectory.start(last.prompt);
            for (const event of last.events) trajectory.record(event);
            trajectory.complete({
              status: last.status ?? (last.error === undefined ? "completed" : "failed"),
              ...(last.error === undefined ? {} : { error: last.error }),
            });
          }
          if (result.workspaceCwd !== undefined) workspaceCwd = result.workspaceCwd;
          if (result.progressSnapshotPath !== undefined) progressSnapshotPath = result.progressSnapshotPath;
          if (result.workflowGraph !== undefined) bindGraph(result.workflowGraph);
          activeRunId = result.runId;
          // The footer counts the live run's work; the resumed run's totals are
          // already spent, so start the next prompt from zero.
          stats = emptyRunStats();
          runStartTime = Date.now();
          transcript.appendText(`  ${theme.dim}resumed ${result.runId}${RST}`);
          chatViewport.scrollEnd();
          refreshFooter();
          tui.requestRender();
        };
        /** Run a takeover and report its outcome in the chat. */
        const startResume = (runId: string): void => {
          if (deps.onResume === undefined || resumeRunning) return;
          resumeRunning = true;
          Effect.runFork(deps.onResume(runId).pipe(
            Effect.tap((result) => Effect.sync(() => replayResume(result))),
            Effect.tapError((error) => Effect.sync(() => {
              transcript.appendText(`  ${theme.error}✗ resume failed${RST} ${theme.error}${error instanceof Error ? error.message : String(error)}${RST}`);
              tui.requestRender();
            })),
            Effect.catchAll(() => Effect.void),
            Effect.ensuring(Effect.sync(() => { resumeRunning = false; })),
          ));
        };
        const openSessionPicker = (): void => {
          if (sessionOverlay !== undefined || deps.runsRoot === undefined || deps.onResume === undefined) return;
          const closePicker = (): void => {
            sessionOverlay?.hide();
            sessionOverlay = undefined;
            recreatePendingTrajectoryOverlay();
            tui.setFocus(editor);
          };
          const picker = new SessionPicker({
            runsRoot: deps.runsRoot,
            ...(activeRunId === undefined ? {} : { currentRunId: activeRunId }),
            onRender: () => tui.requestRender(),
            theme,
            onCancel: () => {
              closePicker();
              tui.requestRender();
            },
            onChoose: (runId) => {
              // Close first: the takeover rewrites the chat, and a still-focused
              // overlay would sit on top of the replay.
              closePicker();
              tui.requestRender();
              startResume(runId);
            },
          });
          sessionOverlay = tui.showOverlay(picker, { anchor: "center", width: "70%", maxHeight: "70%" });
          tui.setFocus(picker);
          tui.requestRender();
        };
        /** Mount one sign-off question as the newest block of the chat area,
         * drawn as a bordered panel — purple outline over a very dark purple
         * fill: it shows pinned right above the prompt editor, as the last part
         * of the conversation, instead of a floating window over it. Driven by
         * the engine's blocking hook (from inside a running prompt), not a
         * slash command. Answering or cancelling removes the block and the
         * chat area returns to its normal transcript. */
        const askSignoffPanel = (spec: AskQuestionSpec): Effect.Effect<AskQuestionAnswer | undefined> =>
          Effect.async<AskQuestionAnswer | undefined>((resolve) => {
            // Text typed while the review owns the keyboard is not an answer
            // to the gate: keep it and run it as the next prompt once the
            // review is answered. (The review decision itself is still made
            // only by the gate's own keys.)
            let typedDuringReview = "";
            const question = new AskQuestion(
              spec.allowText === undefined
                ? {
                  ...spec,
                  onForeignText: (data) => {
                    typedDuringReview += data;
                  },
                }
                : spec,
              signoffStyles(theme),
            );
            const panel = new SignoffBlock(question, theme);
            const close = (): void => {
              if (!signoffOpen) return;
              signoffOpen = false;
              // The mission's container, never whichever chat is in front: a
              // sign-off belongs to the workflow that raised it, and removing
              // it from the wrong container would leave the block mounted.
              missionChatArea.removeChild(panel);
              chatViewport.scrollEnd();
              recreatePendingTrajectoryOverlay();
              tui.setFocus(editor);
              tui.requestRender();
            };
            question.onAnswer = (answer) => {
              close();
              if (typedDuringReview.trim() !== "") submitPrompt(typedDuringReview.trim());
              typedDuringReview = "";
              resolve(Effect.succeed(answer));
            };
            question.onCancel = () => {
              close();
              if (typedDuringReview !== "") editor.setText(typedDuringReview);
              typedDuringReview = "";
              resolve(Effect.succeed(undefined));
            };
            signoffOpen = true;
            missionChatArea.addChild(panel);
            chatViewport.scrollEnd();
            tui.setFocus(question);
            tui.requestRender();
            // Interrupt safety: a killed prompt must not leave the question up.
            return Effect.sync(close);
          });
        const signoffChannel = (
          request: WorkflowSignoffRequest,
        ): Effect.Effect<WorkflowSignoffDecision, WorkflowError> =>
          runSignoffDialog(request, askSignoffPanel).pipe(
            // Echo the finished review into the conversation as a user message
            // — the decision and the reviewer's typed reason, verbatim — so the
            // human's words stay visible in the transcript instead of vanishing
            // with the panel. A cancelled review never reaches this point.
            Effect.tap((decision) => Effect.sync(() => {
              transcript.renderUserMessage(signoffDecisionText(request, decision));
              chatViewport.scrollEnd();
              tui.requestRender();
            })),
          );
        /** The side agent's conversation while it is in front of the chat pane;
         * `undefined` while the mission chat is. */
        let sideAgent: { readonly area: Container; readonly transcript: TranscriptView } | undefined;
        /** Built on the first `/btw` and kept for the rest of the session, so
         * leaving and re-entering returns to the same side conversation. */
        let sideAgentChat: { readonly area: Container; readonly transcript: TranscriptView } | undefined;
        /** Bring one conversation to the front of the chat pane. Nothing is
         * destroyed: the pane is cleared of the other conversation, which waits
         * intact behind it. */
        const showChat = (next: { readonly area: Container; readonly transcript: TranscriptView } | undefined): void => {
          sideAgent = next;
          chatArea = next?.area ?? missionChatArea;
          transcript = next?.transcript ?? missionTranscript;
          chatSurface.setFront(chatArea);
          sideAgentMsg = next === undefined
            ? undefined
            : `${theme.accent}⌥ side agent${RST}${theme.dim} · edit + bash in ${workspaceCwd} · /btw returns to the run${RST}`;
          chatViewport.scrollEnd();
          refreshFooter();
          tui.requestRender();
        };
        /** `/btw` — hand the screen to a side agent that can edit files and run
         * commands, then hand it back. The mission conversation is not restarted
         * or replayed: it is put aside and restored as it was, which is what
         * makes this a side agent rather than a second run.
         *
         * A bare `/btw` toggles; `/btw <prompt>` enters (or stays) and runs that
         * prompt straight away. Switching is refused while a prompt is in
         * flight, exactly as `/resume` is: one live turn per TUI, so the
         * trajectory panel, footer counters and interrupt key stay unambiguous. */
        const toggleSideAgent = (prompt: string): void => {
          if (deps.runSideAgent === undefined) {
            transcript.appendText(`  ${theme.dim}the side agent is not available in this session${RST}`);
            chatViewport.scrollEnd();
            tui.requestRender();
            return;
          }
          if (promptRunning) {
            transcript.appendText(`  ${theme.dim}finish or interrupt the current prompt before switching to the side agent${RST}`);
            chatViewport.scrollEnd();
            tui.requestRender();
            return;
          }
          if (sideAgent !== undefined && prompt === "") {
            showChat(undefined);
            return;
          }
          if (sideAgent === undefined) {
            if (sideAgentChat === undefined) {
              const area = new Container();
              const view = new TranscriptView(area, theme);
              sideAgentChat = { area, transcript: view };
              view.appendText(`  ${theme.accent}⌥ btw${RST}${theme.dim} — a side agent with read, edit, write and bash in ${workspaceCwd}${RST}`);
              view.appendText(`  ${theme.dim}the run is waiting where you left it; /btw goes back${RST}`);
            }
            showChat(sideAgentChat);
          }
          if (prompt !== "") submitPrompt(prompt);
        };
        const submitPrompt = (prompt: string): void => {
          // `/btw` swaps the runner, not the prompt path: steering, queueing,
          // interrupts, task events and the trajectory panel are identical for
          // the mission workflow and the side agent.
          const runner = sideAgent === undefined ? deps.runPrompt : deps.runSideAgent;
          if (runner === undefined) return;
          if (promptRunning) {
            // Mid-turn input goes to the live session's steering channel
            // first; only what no session takes becomes the queued next turn.
            // The branch is capability-shaped (the channel's answer), never a
            // harness-name check. A run that finishes during the await takes
            // the text as a fresh next prompt instead of losing it to the
            // queue no one will drain.
            const attempt: Promise<SteerDelivery> = deps.steerActive === undefined
              ? Promise.resolve("no-active-turn")
              : deps.steerActive(prompt);
            attempt.then(
              (delivery) => {
                if (delivery === "delivered") {
                  transcript.appendText(`  ${theme.accent}⚑ steered — ${prompt}${RST}`);
                } else if (promptRunning) {
                  // Held as the queued next turn: at terminal state the ensuring
                  // hook resubmits it through the one runPrompt path, which
                  // continues the same execution (never a fresh one); an
                  // interrupted run hands it back to the editor instead.
                  pendingPrompt = prompt;
                  transcript.appendText(`  ${theme.dim}queued — runs as the next prompt when this ${sideAgent === undefined ? "workflow" : "turn"} finishes${RST}`);
                } else {
                  submitPrompt(prompt);
                  return;
                }
                chatViewport.scrollEnd();
                tui.requestRender();
              },
              () => {
                // A live session refused the text (its SDK rejected steer).
                // Surface the refusal and keep queue semantics for the input.
                if (!promptRunning) {
                  // The run settled during the refusal await — run the text as
                  // a fresh next prompt instead of stranding it in the queue.
                  submitPrompt(prompt);
                  return;
                }
                pendingPrompt = prompt;
                transcript.appendText(`  ${theme.dim}queued — steering refused${RST}`);
                chatViewport.scrollEnd();
                tui.requestRender();
              },
            );
            return;
          }
          promptRunning = true;
          deps.onTaskEvent?.({ type: "input.accepted", prompt });
          deps.onTaskEvent?.({ type: "agentic.task.started", prompt });
          let outcome: "completed" | "failed" | "cancelled" = "completed";
          let completion: TuiPromptResult | undefined;
          let failure: FailureDetails | undefined;
          transcript.renderUserMessage(prompt);
          trajectory.start(prompt);
          stats = emptyRunStats();
          runStartTime = Date.now();
          if (graph !== undefined && sideAgent === undefined) {
            graph.setBlink(true);
            if (blinkTimer !== undefined) clearInterval(blinkTimer);
            blinkTimer = setInterval(() => {
              graph?.toggleBlink();
              void graph?.refresh();
              refreshFooter();
              tui.requestRender();
            }, 500);
            void graph.refresh();
          }
          refreshFooter();
          tui.requestRender();
          const promptState: PromptState = { cancelled: false, outcomeReported: false };
          activePrompt = promptState;
          const promptEffect = runner(prompt, (event) => {
            transcript.route(event);
            trajectory.record(event);
            const nextStats = applyRunStat(stats, event);
            if (nextStats !== stats) {
              stats = nextStats;
              refreshFooter();
            }
            tui.requestRender();
          }, signoffChannel).pipe(
            Effect.tap((result) => Effect.sync(() => {
              promptState.outcomeReported = true;
              completion = typeof result === "string" ? { text: result } : result;
              stats = markTerminal(stats, "completed");
              deps.onTaskEvent?.({
                type: "agentic.task.completed",
                prompt,
                textLength: completion.text.length,
                ...(completion.sessionId === undefined ? {} : { sessionId: completion.sessionId }),
                ...(completion.transcriptPath === undefined ? {} : { transcriptPath: completion.transcriptPath }),
              });
            })),
            Effect.tapError((error) => Effect.sync(() => {
              promptState.outcomeReported = true;
              failure = failureDetails(error);
              const cancelled = isCancellation(error);
              outcome = cancelled ? "cancelled" : "failed";
              stats = markTerminal(stats, cancelled ? "cancelled" : "failed");
              transcript.appendError(cancelled ? "interrupted" : sideAgent === undefined ? "workflow failed" : "side agent failed", failure);
              deps.onTaskEvent?.({
                type: cancelled ? "agentic.task.cancelled" : "agentic.task.failed",
                prompt,
                error,
              });
            })),
            // The TUI is an adapter boundary: injected runners may expose
            // native errors as well as domain errors. tapError above has
            // already normalized and displayed every failure, so keep the
            // live session open for all error shapes.
            Effect.catchAll(() => Effect.succeed("")),
            Effect.ensuring(Effect.sync(() => {
              promptRunning = false;
              if (activePrompt === promptState) activePrompt = undefined;
              if (promptState.cancelled && !promptState.outcomeReported) {
                promptState.outcomeReported = true;
                stats = markTerminal(stats, "cancelled");
                deps.onTaskEvent?.({
                  type: "agentic.task.cancelled",
                  prompt,
                  error: new Error("agentic task cancelled by /exit"),
                });
              }
              trajectory.complete({
                status: promptState.cancelled ? "cancelled" : outcome,
                ...(completion?.sessionId === undefined ? {} : { sessionId: completion.sessionId }),
                ...(completion?.transcriptPath === undefined ? {} : { transcriptPath: completion.transcriptPath }),
                ...(failure === undefined ? {} : { error: failure }),
              });
              if (blinkTimer !== undefined) {
                clearInterval(blinkTimer);
                blinkTimer = undefined;
              }
              // The run reached its terminal state: the queued next-turn prompt
              // continues this run's workflow execution through the same
              // get-or-create runPrompt path as any later prompt (the /resume
              // path proves it). A human-interrupted run is not auto-continued —
              // hand the text back to the editor.
              if (pendingPrompt !== undefined) {
                const queued = pendingPrompt;
                pendingPrompt = undefined;
                if (promptState.cancelled || outcome === "cancelled") {
                  editor.setText(queued);
                } else {
                  submitPrompt(queued);
                }
              }
              void graph?.refresh();
              refreshFooter();
              tui.requestRender();
            })),
          );
          promptState.fiber = Effect.runFork(promptEffect);
        };
        editor.onSubmit = (value) => {
          const command = value.trim();
          if (command === "/exit" || command === "/quit") {
            Effect.runFork(finish());
            return;
          }
          if (command === "/btw" || command.startsWith("/btw ")) {
            editor.setText("");
            const task = command.slice("/btw".length).trim();
            if (task !== "") {
              editor.addToHistory(task);
              appendPromptHistory(historyRoot, task);
            }
            toggleSideAgent(task);
            return;
          }
          if (command === "/side") {
            toggleSide();
            editor.setText("");
            return;
          }
          if (command === "/workspace") {
            editor.setText("");
            openWorkspacePicker();
            return;
          }
          if (command === "/workflow") {
            editor.setText("");
            openWorkflowPicker();
            return;
          }
          if (command === "/resume") {
            editor.setText("");
            if (promptRunning) {
              transcript.appendText(`  ${theme.dim}finish or interrupt the current prompt before resuming${RST}`);
              tui.requestRender();
            } else if (deps.runsRoot === undefined || deps.onResume === undefined) {
              transcript.appendText(`  ${theme.dim}resuming is not available in this session${RST}`);
              tui.requestRender();
            } else {
              openSessionPicker();
            }
            return;
          }
          if (command.startsWith("/rename")) {
            const name = command.slice("/rename".length).trim();
            if (name === "") {
              transcript.appendText(`  ${theme.dim}Usage: /rename <name>${RST}`);
            } else if (deps.onRename === undefined) {
              transcript.appendText(`  ${theme.dim}renaming is not available in this session${RST}`);
            } else {
              Effect.runFork(
                deps.onRename(name).pipe(
                  Effect.tap(() => Effect.sync(() => {
                    transcript.appendText(`  ${theme.dim}renamed run to "…${name}"${RST}`);
                    tui.requestRender();
                  })),
                  Effect.tapError((error) => Effect.sync(() => {
                    const message = error instanceof Error ? error.message : String(error);
                    transcript.appendText(`  ${theme.error}✗ rename failed${RST} ${theme.error}${message}${RST}`);
                    tui.requestRender();
                  })),
                  Effect.catchAll(() => Effect.void),
                ),
              );
            }
            editor.setText("");
            return;
          }
          if (command !== "") {
            editor.addToHistory(command);
            appendPromptHistory(historyRoot, command);
            submitPrompt(command);
          }
          refreshFooter();
          editor.setText("");
          tui.requestRender();
        };
        removeInput = tui.addInputListener((data) => {
          // A capturing picker owns Escape. The global interrupt shortcut must
          // not consume it before the focused overlay sees it.
          const shortcut = matchShortcut(data);
          if (pickerOpen() && shortcut === "interrupt") return undefined;
          /** Shared tail of every shortcut that reflows or re-targets the
           * transcript: re-pin to the newest message, then repaint. */
          const repinAndRender = (): { consume: true } => {
            chatViewport.scrollEnd();
            tui.requestRender();
            return { consume: true };
          };
          // Both expansion toggles reflow the transcript height, so re-pin to
          // the newest message: without this the viewport keeps a pre-toggle
          // scrollTop that now points at unrelated older content, and the wheel
          // is the only way back.
          if (matchesKeyPress(data, TOOL_EXPAND_KEYS)) {
            transcript.toggleExpanded();
            return repinAndRender();
          }
          if (matchesKeyPress(data, ERROR_EXPAND_KEYS) && transcript.toggleLatestError()) {
            return repinAndRender();
          }
          // Ctrl+Home / Ctrl+End move BOTH panes to the oldest / newest
          // content. The wheel stays pane-local (whichever pane the cursor is
          // over scrolls alone), but the jump shortcuts are deliberately
          // linked: one action, one mental model, no hidden pane state.
          if (matchesKeyPress(data, scrollKeys.endKeys)) {
            chatViewport.scrollEnd();
            trajectory.scrollEnd();
            tui.requestRender();
            return { consume: true };
          }
          if (matchesKeyPress(data, scrollKeys.homeKeys)) {
            chatViewport.scrollHome();
            trajectory.scrollHome();
            tui.requestRender();
            return { consume: true };
          }
          // Mouse reporting is a DEC private mode, so handing the mouse back to
          // the terminal — and taking it again — is one write in each direction.
          // While released, the terminal's own selection (drag, double-click word,
          // triple-click line, copy-on-select) works over the transcript and lands
          // in the system clipboard; native paste writes stdin, which only the
          // focused editor reads, so the chat area stays unwritable either way.
          if (matchesKeyPress(data, COPY_MODE_KEYS)) {
            copyMode = !copyMode;
            terminal.write(copyMode ? "\x1b[?1002;1006l" : "\x1b[?1002;1006h");
            refreshFooter();
            tui.requestRender();
            return { consume: true };
          }
          if (shortcut === undefined) return undefined;
          Effect.runFork(dispatchShortcut(data, shortcutEffects));
          return { consume: true };
        });
        refreshFooter();
        // Drag listener: parse SGR mouse sequences and step the shared split
        // state, then recreate the trajectory overlay at the new width (the
        // renderer reads split.ratio live, so the divider reflows on the same
        // render (decision 0024).
        tui.addInputListener((data) => {
          const ev = parseSgrMouse(data);
          if (!ev) return undefined;
          // In copy mode the mouse belongs to the terminal, but pi-tui's stdin
          // buffer can still surface a report that arrived just before the
          // handover. Consume it rather than fall through: acting on it would
          // scroll or resize a pane mid-selection, and an unconsumed report
          // reaches the focused editor, which types the raw escape sequence into
          // the prompt. Parsing first keeps keystrokes on their normal path.
          if (copyMode) return { consume: true };
          if (ev.kind === "wheel") {
            if (split.visible && isWithinRightPane(ev.col, split.ratio, terminal.columns) && trajectory.isWithin(ev.row)) {
              const wheelButton = ev.button & 3;
              const delta = wheelButton === 0 ? -1 : wheelButton === 1 ? 1 : 0;
              if (delta !== 0) {
                if (trajectory.scrollBy(delta)) tui.requestRender();
              }
            } else {
              const chatWidth = split.visible
                ? terminal.columns - rightColumns(split.ratio, terminal.columns)
                : terminal.columns;
              const inChat = Number.isSafeInteger(ev.col) && ev.col >= 1 && ev.col <= chatWidth && chatViewport.isWithin(ev.row);
              if (inChat) {
                const wheelButton = ev.button & 3;
                const delta = wheelButton === 0 ? -1 : wheelButton === 1 ? 1 : 0;
                if (delta !== 0) {
                  if (chatViewport.scrollBy(delta)) tui.requestRender();
                }
              }
            }
            return { consume: true };
          }
          if (!split.visible) return { consume: true };
          const next = stepSplitDrag(split, ev, terminal.columns);
          const ratioChanged = next.ratio !== split.ratio;
          split.dragging = next.dragging;
          split.ratio = next.ratio;
          if (ratioChanged) {
            recreateTrajectoryOverlay();
            tui.requestRender();
          }
          return { consume: true };
        });
        terminal.write("\x1b[?1002;1006h");
        let previousColumns = terminal.columns;
        let previousRows = terminal.rows;
        terminalResize.current = (): void => {
          const columns = terminal.columns;
          const rows = terminal.rows;
          if (columns === previousColumns && rows === previousRows) return;
          previousColumns = columns;
          previousRows = rows;
          recreateTrajectoryOverlay();
          refreshFooter();
          tui.requestRender();
        };
        tui.start();
        // Deferred to after start so the resume runs against a live terminal and
        // its replay lands in a rendered chat. Both branches go through exactly
        // the same code as the `/resume` command.
        if (deps.resumeRunId !== undefined) {
          startResume(deps.resumeRunId);
        } else if (deps.resumePicker === true) {
          openSessionPicker();
        }
        return Effect.sync(() => dispose());
      });
      return effect.pipe(Effect.ensuring(Effect.sync(() => dispose())));
    }),
  );
}
