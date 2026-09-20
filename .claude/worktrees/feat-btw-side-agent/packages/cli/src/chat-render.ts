// Chat-area transcript renderer for Piano (decision 0022). Renders AgentEvent
// events and user messages as pi-tui
// components (Box/Markdown) instead of flat Text, so the main canvas carries the
// full conversation — user echo, Markdown agent messages, and expandable tool
// boxes — while the trajectory panel remains the timestamped event ledger.
import { messageText, textDelta, type AgentEvent } from "@piano/harness";
import { Container, Markdown, Text, type MarkdownTheme } from "@earendil-works/pi-tui";
import { RST, type PianoTheme } from "./theme.js";
import { loopIteration } from "./trajectory.js";
import type { FailureDetails } from "@piano/logging";

export function buildMarkdownTheme(th: PianoTheme): MarkdownTheme {
  return {
    heading: (s) => th.mdHeading + s + RST,
    link: (s) => th.mdLink + s + RST,
    linkUrl: (s) => th.dim + s + RST,
    code: (s) => th.mdCode + s + RST,
    codeBlock: (s) => th.mdCodeBlock + s + RST,
    codeBlockBorder: (s) => th.mdCodeBlockBorder + s + RST,
    quote: (s) => th.mdQuote + s + RST,
    quoteBorder: (s) => th.mdQuoteBorder + s + RST,
    hr: (s) => th.mdHr + s + RST,
    listBullet: (s) => th.mdListBullet + s + RST,
    bold: (s) => th.bold + s + RST,
    italic: (s) => "\x1b[3m" + s + RST,
    strikethrough: (s) => "\x1b[9m" + s + RST,
    underline: (s) => "\x1b[4m" + s + RST,
  };
}

/** Stable per-stage tag hues for workflow `spawn` lines. Each stage-worker
 * keeps one color for the whole run (loop iterations included), so a
 * multi-stage transcript reads as one colored tag per stage with the model on
 * the same line. The hues are theme tokens rather than fixed ANSI values, so
 * both dark and light shells stay legible; `mdLink` (light blue on dark
 * shells) is the leading hue. */
function stageTagHues(th: PianoTheme): readonly string[] {
  return [th.mdLink, th.mdHeading, th.mdCodeBlock, th.signoffBorder];
}

/** Deterministic per-stage tag color (a small hash over the stage id, then a
 * hue pick). Exported so tests can pin the mapping without parsing ANSI. */
export function stageTagColor(th: PianoTheme, stageId: string): string {
  const hues = stageTagHues(th);
  let hash = 0;
  for (const ch of stageId) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return hues[hash % hues.length] ?? th.dim;
}

export function renderUserMessage(text: string, th: PianoTheme): Container {
  const message = new Container();
  message.addChild(
    new Markdown(`▌ ${text}`, 0, 0, buildMarkdownTheme(th), {
      color: (s) => `${th.userBg}${th.userText}${s}${RST}`,
    }),
  );
  return message;
}

export class ToolCallBox {
  private readonly th: PianoTheme;
  private readonly container: Container;
  private readonly tool: string;
  private argLine: Text | null;
  private readonly titleLine: Text;
  private resultLine: Text | null = null;
  private completed = false;
  private isError = false;
  private isExpanded = false;

  constructor(tool: string, arg: string, th: PianoTheme) {
    this.th = th;
    this.tool = tool;
    this.container = new Container();
    this.titleLine = new Text("", 0, 0);
    this.argLine = arg ? new Text("    " + th.toolOutput + arg + RST, 0, 0) : null;
    this.refreshTitle();
    this.relayout();
  }

  get box(): Container {
    return this.container;
  }

  get expanded(): boolean {
    return this.isExpanded;
  }

  setExpanded(expanded: boolean): void {
    if (this.isExpanded === expanded) return;
    this.isExpanded = expanded;
    this.refreshTitle();
    this.relayout();
  }

  complete(summary: string, isError?: boolean): void {
    this.completed = true;
    this.isError = Boolean(isError);
    this.resultLine = new Text("    " + this.th.toolOutput + summary + RST, 0, 0);
    this.refreshTitle();
    this.relayout();
  }

  /** Fold a later report of the same call into this box. A streaming harness
   * opens a tool block with an empty input and only names the arguments on the
   * completed record; without this the second report stacks a duplicate box
   * that sits pending forever while its twin gets the ✓. */
  setArgs(arg: string): void {
    if (!arg) return;
    const line = "    " + this.th.toolOutput + arg + RST;
    if (this.argLine === null) this.argLine = new Text(line, 0, 0);
    else this.argLine.setText(line);
    this.relayout();
  }

  private refreshTitle(): void {
    // No background block — the title is a single colored line (the tool box
    // background read as a light strip against the dark canvas, so it's gone).
    let s = "  " + this.th.bold + this.th.toolTitle + "⚙ " + this.tool + RST;
    if (this.completed) {
      s += this.isError ? this.th.error + " ✗" + RST : this.th.success + " ✓" + RST;
    }
    s += this.isExpanded ? this.th.dim + " ▾" + RST : this.th.dim + " ▸ Ctrl+O" + RST;
    this.titleLine.setText(s);
  }

  private relayout(): void {
    this.container.clear();
    this.container.addChild(this.titleLine);
    if (this.isExpanded) {
      if (this.argLine) this.container.addChild(this.argLine);
      if (this.resultLine) this.container.addChild(this.resultLine);
    }
    this.container.invalidate();
  }
}

export interface TranscriptStream {
  append(delta: string): void;
  finalize(): void;
}

export class ErrorBox {
  private readonly container = new Container();
  private readonly titleLine = new Text("", 0, 0);
  private readonly detail: Markdown;
  private expanded = false;

  constructor(
    private readonly label: string,
    private readonly error: FailureDetails,
    private readonly th: PianoTheme,
  ) {
    this.detail = new Markdown(
      formatErrorDetail(error),
      4,
      0,
      buildMarkdownTheme(th),
      { color: (s) => th.primary + s + RST },
    );
    this.refresh();
  }

  get box(): Container {
    return this.container;
  }

  toggle(): void {
    this.expanded = !this.expanded;
    this.refresh();
  }

  private refresh(): void {
    this.titleLine.setText(
      `  ${this.th.error}✗${RST} ${this.th.mdHeading}${this.label}${RST}${this.th.dim} ${this.expanded ? "▾" : "▸ Ctrl+E"}${RST}`,
    );
    this.container.clear();
    this.container.addChild(this.titleLine);
    if (this.expanded) this.container.addChild(this.detail);
    this.container.invalidate();
  }
}

function formatErrorDetail(error: FailureDetails): string {
  const firstLine = error.message.split("\n", 1)[0] ?? error.message;
  return `### ${error.type}\n\n> ${firstLine}\n\n${error.message}`;
}

/** Serialize a tool argument for display in a compact, bounded form. */
function stringifyArg(value: unknown): string {
  return value === undefined ? "" : safeJson(value);
}

/** Serialize a compact summary of a tool result for display. */
function stringifyResult(value: unknown, isError: boolean): string {
  return value === undefined ? (isError ? "error" : "ok") : safeJson(value);
}

function safeJson(value: unknown): string {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? "undefined" : encoded;
  } catch {
    return "[unprintable]";
  }
}

export class TranscriptView {
  private readonly chatArea: Container;
  private readonly th: PianoTheme;
  private readonly openTools = new Map<string, ToolCallBox>();
  private readonly toolBoxes: ToolCallBox[] = [];
  private readonly errorBoxes: ErrorBox[] = [];
  private expandedFlag = false;
  /** The one live Markdown block a turn is written into, open between the
   * first `text_delta` and the `message_end` that closes it. */
  private liveStream: TranscriptStream | undefined;

  constructor(chatArea: Container, th: PianoTheme) {
    this.chatArea = chatArea;
    this.th = th;
  }

  get expanded(): boolean {
    return this.expandedFlag;
  }

  setExpanded(expanded: boolean): void {
    this.expandedFlag = expanded;
    for (const box of this.toolBoxes) {
      box.setExpanded(expanded);
    }
    this.chatArea.invalidate();
  }

  toggleExpanded(): boolean {
    this.setExpanded(!this.expandedFlag);
    return this.expandedFlag;
  }

  toggleLatestError(): boolean {
    const latest = this.errorBoxes.at(-1);
    if (latest === undefined) return false;
    latest.toggle();
    this.chatArea.invalidate();
    return true;
  }

  renderEvent(event: AgentEvent): void {
    switch (event.type) {
      case "spawn": {
        const stage = event.workflow?.stageId;
        const worker = event.workflow?.worker;
        const iteration = loopIteration(event.workflow?.invocationId);
        const hasStage = stage !== undefined;
        const label = hasStage
          ? `${stage}${iteration === undefined ? "" : ` #${iteration + 1}`}`
          : event.harness;
        // Workflow spawns show the stage's worker after the stage label, so
        // the line says which stage worker drives this turn and (below) with
        // which model. Each stage gets its own stable tag color; plain
        // non-workflow spawns keep the whole dim harness label.
        if (!hasStage) {
          this.appendText(
            `  ${this.th.dim}↳ ${label}${RST}` +
              (event.model ? `  ${this.th.accent}[${event.model}]${RST}` : "")
          );
          break;
        }
        const workerSuffix = worker !== undefined && worker !== "" ? ` · ${worker}` : "";
        this.appendText(
          `  ${this.th.dim}↳ ${RST}${stageTagColor(this.th, stage)}${label}${workerSuffix}${RST}` +
            (event.model ? `  ${this.th.accent}[${event.model}]${RST}` : "")
        );
        break;
      }
      case "tool_execution_start":
        {
          const open = this.openTools.get(event.toolCallId);
          if (open !== undefined) {
            open.setArgs(stringifyArg(event.args));
            break;
          }
          const tool = new ToolCallBox(event.toolName, stringifyArg(event.args), this.th);
          tool.setExpanded(this.expandedFlag);
          this.openTools.set(event.toolCallId, tool);
          this.toolBoxes.push(tool);
          this.chatArea.addChild(tool.box);
        }
        break;
      case "tool_execution_end": {
        const tool = this.openTools.get(event.toolCallId);
        if (tool !== undefined) {
          tool.complete(stringifyResult(event.result, event.isError), event.isError);
          this.openTools.delete(event.toolCallId);
        } else {
          this.appendText(`     ${this.th.dim}│ ${stringifyResult(event.result, event.isError)}${RST}`);
        }
        break;
      }
      case "message_end": {
        if (event.message.role !== undefined && event.message.role !== "assistant") break;
        const text = messageText(event.message);
        if (text !== undefined) {
          this.chatArea.addChild(
            new Markdown(text, 1, 0, buildMarkdownTheme(this.th), {
              color: (s) => this.th.primary + s + RST,
            })
          );
        }
        break;
      }
      case "error":
        this.appendText(`  ${this.th.error}✗${RST}  ${this.th.error}${event.message}${RST}`);
        break;
      case "retry":
        // The transient-failure half of the story: an attempt failed but the
        // retry boundary has it. The `error` line above shows what broke;
        // these lines show what Piano is doing about it.
        if (event.event === "scheduled") {
          this.appendText(
            `  ${this.th.primary}↻${RST}  ${this.th.primary}retrying in ${Math.round((event.delayMs ?? 0) / 1000)}s (attempt ${event.nextAttempt}/${event.totalAttempts}): ${event.message ?? event.errorType ?? ""}${RST}`,
          );
        } else {
          this.appendText(`  ${this.th.success}✓${RST}  ${this.th.success}recovered on attempt ${event.attempt}${RST}`);
        }
        break;
      case "done":
        this.appendText(`  ${this.th.success}✓${RST}  done`);
        break;
      // message_update (deltas), usage, context, resource, and any other
      // session-level events are handled elsewhere (trajectory panel / footer),
      // so the transcript chat stays focused on conversation + tools.
      default:
        break;
    }
  }

  renderUserMessage(text: string): void {
    // A turn that ended without `message_end` (interrupted, failed before the
    // closing frame) would otherwise leave the block open, and the next
    // prompt's deltas would append into the previous answer.
    this.closeLiveStream();
    this.chatArea.addChild(renderUserMessage(text, this.th));
  }

  /** Drop every rendered turn and the state that indexes it. `/resume` replays a
   * different run into the same view, and the tool/error collections drive the
   * Ctrl+O and Ctrl+E scopes — leaving stale boxes in them would let those
   * shortcuts act on a run the user is no longer looking at. */
  reset(): void {
    this.chatArea.clear();
    this.openTools.clear();
    this.toolBoxes.length = 0;
    this.errorBoxes.length = 0;
    this.expandedFlag = false;
    this.liveStream = undefined;
    this.chatArea.invalidate();
  }

  private closeLiveStream(): void {
    this.liveStream?.finalize();
    this.liveStream = undefined;
  }

  /** Route one streamed event into the transcript, keeping the live block
   * whole.
   *
   * Both harnesses speak the Pi contract: `text_delta` events grow a single
   * Markdown node in place, and the frame that closes the turn must not
   * re-render text that already streamed. Lifecycle frames that carry no
   * visible chat content leave the live block open — closing the stream on
   * them is what split one reply into a run of separate blocks and left the
   * viewport parked at the head instead of following the tail (ISSUE-011).
   *
   * A harness that reports only whole messages never opens the block, so its
   * `message_end` still renders normally. */
  route(event: AgentEvent): void {
    const delta = textDelta(event);
    if (delta !== undefined) {
      if (this.liveStream === undefined) this.liveStream = this.newStream();
      this.liveStream.append(delta);
      return;
    }
    if (event.type === "message_end") {
      const streamed = this.liveStream !== undefined;
      this.closeLiveStream();
      if (!streamed) this.renderEvent(event);
      return;
    }
    if (event.type === "usage" || event.type === "resource" || event.type === "context") {
      // Trajectory-only events: record to the side ledger but never
      // finalize/recreate the live chat stream. Routing lifecycle-only
      // events to the side panel fixes
      // the stream churn that blinked the chat area (ISSUE-011).
      return;
    }
    if (event.type === "message_update" || event.type === "message_start") {
      // Provider streams can interleave thinking/text lifecycle frames
      // with text deltas. They are not visible chat content and must
      // not close the active text stream before message_end arrives.
      return;
    }
    this.closeLiveStream();
    this.renderEvent(event);
  }

  appendText(text: string): void {
    this.chatArea.addChild(new Text(text, 0, 0));
  }

  appendError(label: string, error: FailureDetails): void {
    this.closeLiveStream();
    const errorBox = new ErrorBox(label, error, this.th);
    this.errorBoxes.push(errorBox);
    this.chatArea.addChild(errorBox.box);
  }

  newStream(): TranscriptStream {
    const md = new Markdown("", 1, 0, buildMarkdownTheme(this.th), {
      color: (s) => this.th.primary + s + RST,
    });
    this.chatArea.addChild(md);
    let buffer = "";
    return {
      append(delta: string): void {
        buffer += delta;
        md.setText(buffer);
      },
      finalize(): void {},
    };
  }
}
