// Chat-area transcript renderer for Piano (decision 0022). Renders AgentEvent
// events and user messages as pi-tui
// components (Box/Markdown) instead of flat Text, so the main canvas carries the
// full conversation — user echo, Markdown agent messages, and expandable tool
// boxes — while the trajectory panel remains the timestamped event ledger.
import { messageText, textDelta, type AgentEvent } from "@piano/harness";
import { Container, Markdown, Text, type MarkdownTheme } from "@earendil-works/pi-tui";
import { formatCompactDuration } from "./duration.js";
import { jsonText } from "./text.js";
import { RST, type PianoTheme } from "./theme.js";
import { formatToolOutput } from "./tool-output.js";
import { loopIteration } from "./trajectory.js";
import {
  AGENT_DONE_NAME,
  AGENT_ERROR_NAME,
  AGENT_RETRY_NAME,
  asRecord,
  metadataNumber,
  metadataString,
  outputText,
  toolCallIdFromHandle,
  type FailureDetails,
  type ObservationOp,
} from "@piano/logging";

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

/** The one `↳ …` line a spawn draws, whichever dialect fed it. Workflow
 * spawns show the stage's worker after the stage label; plain spawns keep the
 * whole dim harness label. */
function formatSpawnLine(
  th: PianoTheme,
  facts: {
    readonly stageId?: string;
    readonly iteration?: number;
    readonly worker?: string;
    readonly harness?: string;
    readonly model?: string;
  },
): string {
  const { stageId, iteration, worker, harness, model } = facts;
  const modelSuffix = model === undefined || model === "" ? "" : `  ${th.accent}[${model}]${RST}`;
  if (stageId === undefined) {
    return `  ${th.dim}↳ ${harness ?? "agent"}${RST}${modelSuffix}`;
  }
  const label = `${stageId}${iteration === undefined ? "" : ` #${iteration + 1}`}`;
  const workerSuffix = worker === undefined || worker === "" ? "" : ` · ${worker}`;
  return `  ${th.dim}↳ ${RST}${stageTagColor(th, stageId)}${label}${workerSuffix}${RST}${modelSuffix}`;
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
  private preview: string;
  private argLine: Text | null;
  private readonly titleLine: Text;
  private resultLine: Text | null = null;
  private completed = false;
  private isError = false;
  private isExpanded = false;
  private durationMs: number | undefined;

  constructor(tool: string, arg: string, th: PianoTheme) {
    this.th = th;
    this.tool = tool;
    this.container = new Container();
    this.titleLine = new Text("", 0, 0);
    this.preview = previewText(tool, arg);
    this.argLine = arg ? new Text(formatToolDetail(th, tool, arg), TOOL_DETAIL_INDENT, 0) : null;
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

  complete(summary: string, isError?: boolean, durationMs?: number): void {
    this.completed = true;
    this.isError = Boolean(isError);
    this.durationMs = durationMs;
    this.resultLine = new Text(formatToolDetail(this.th, "result", summary), TOOL_DETAIL_INDENT, 0);
    this.refreshTitle();
    this.relayout();
  }

  /** Fold a later report of the same call into this box. A streaming harness
   * opens a tool block with an empty input and only names the arguments on the
   * completed record; without this the second report stacks a duplicate box
   * that sits pending forever while its twin gets the ✓. */
  setArgs(arg: string): void {
    if (!arg) return;
    this.preview = previewText(this.tool, arg);
    const line = formatToolDetail(this.th, this.tool, arg);
    if (this.argLine === null) this.argLine = new Text(line, TOOL_DETAIL_INDENT, 0);
    else this.argLine.setText(line);
    this.refreshTitle();
    this.relayout();
  }

  private refreshTitle(): void {
    // No background block — the title is a single colored line (the tool box
    // background read as a light strip against the dark canvas, so it's gone).
    let s = "  " + this.th.bold + this.th.toolTitle + "⚙ " + this.tool + RST;
    if (this.completed) {
      s += this.isError ? this.th.error + " ✗" + RST : this.th.success + " ✓" + RST;
    }
    if (this.durationMs !== undefined) {
      s += " " + this.th.dim + formatCompactDuration(this.durationMs) + RST;
    }
    // The preview is the collapsed affordance: expanded shows the labeled
    // detail lines instead, so repeating it in the title would duplicate them.
    if (!this.isExpanded && this.preview !== "") {
      s += "  " + this.th.toolCommand + this.preview + RST;
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

function previewText(tool: string, detail: string): string {
  const compact = detail.replace(/\s+/g, " ").trim();
  if (compact === "") return "";
  const value = /^(bash|shell|exec|command)$/i.test(tool)
    ? `$ ${compact}`
    : compact;
  return value.length <= 72 ? value : `${value.slice(0, 69)}...`;
}

/** Left margin of the expanded detail lines. It is Text's `paddingX` rather
 * than a literal prefix so a multi-line result — and every wrapped continuation
 * of a long one — keeps the detail column instead of drifting to the left edge.
 */
const TOOL_DETAIL_INDENT = 4;

function formatToolDetail(th: PianoTheme, tool: string, detail: string): string {
  const label = tool === "result" ? "output" : /^(bash|shell|exec|command)$/i.test(tool) ? "command" : "input";
  const prefix = label === "command" ? "$ " : "";
  // A result body carries its own per-kind formatting, so only the argument and
  // command lines take the single `toolCommand` colour.
  if (label === "output") return `${th.toolSection}${label}${RST} ${formatToolOutput(detail, th)}`;
  return `${th.toolSection}${label}${RST} ${th.toolCommand}${prefix}${detail}${RST}`;
}

interface TranscriptStream {
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
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length === 0) return "";
    for (const key of ["command", "cmd", "shell_command", "script", "path", "file_path", "filename"]) {
      if (typeof record[key] === "string") return record[key];
    }
    if (typeof record.description === "string") return record.description;
  }
  return jsonText(value);
}

/** Max lines of a tool result kept in the expanded detail. A build log or a
 * `cat` of a large file would otherwise push the transcript off screen. */
const TOOL_OUTPUT_MAX_LINES = 40;

/** Serialize a tool result for display: provider content blocks
 * (`[{type:"text",text:"..."}]`) and `{content: ...}` envelopes are unwrapped
 * into their text, so the expanded detail reads as output rather than JSON.
 * Only genuinely unstructured values fall back to compact JSON. */
function stringifyResult(value: unknown, isError: boolean): string {
  if (value === undefined) return isError ? "error" : "ok";
  const text = resultText(value);
  if (text === undefined) return boundLines(jsonText(value));
  const trimmed = text.replace(/\s+$/, "");
  if (trimmed === "") return isError ? "error" : "(no output)";
  return boundLines(trimmed);
}

/** Text of a result value, or undefined when it is not a readable envelope.
 * `depth` stops a self-referential `{content: ...}` chain. */
function resultText(value: unknown, depth = 0): string | undefined {
  if (depth > 3) return undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const part of value) {
      const text = blockText(part);
      // A mixed array (an image block beside text) is not a text body; showing
      // it as JSON keeps the unrendered parts visible instead of silently lost.
      if (text === undefined) return undefined;
      parts.push(text);
    }
    return parts.join("\n");
  }
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const direct = blockText(record);
  if (direct !== undefined) return direct;
  if ("content" in record) {
    const body = resultText(record.content, depth + 1) ?? "";
    // pi's Edit puts the applied diff — the part a reader actually wants — in
    // `details` rather than in `content`, so unwrapping content alone would
    // drop it.
    const extras = detailText(record.details);
    if (body === "" && extras === "") return undefined;
    return extras === "" ? body : `${body}\n${extras}`;
  }
  return undefined;
}

/** String fields of a provider `details` envelope, newline-joined. */
function detailText(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
  const parts: string[] = [];
  for (const field of Object.values(value as Record<string, unknown>)) {
    if (typeof field === "string" && field !== "") parts.push(field);
  }
  return parts.join("\n");
}

/** Text of one content block ({type:"text",text:"..."}), or undefined. */
function blockText(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as { type?: unknown; text?: unknown };
  if (typeof record.text !== "string") return undefined;
  return record.type === undefined || record.type === "text" || record.type === "output_text"
    ? record.text
    : undefined;
}

/** Keep at most `TOOL_OUTPUT_MAX_LINES` lines, disclosing what was dropped. */
function boundLines(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= TOOL_OUTPUT_MAX_LINES) return text;
  const hidden = lines.length - TOOL_OUTPUT_MAX_LINES;
  return `${lines.slice(0, TOOL_OUTPUT_MAX_LINES).join("\n")}\n... +${hidden} lines`;
}

export class TranscriptView {
  private readonly chatArea: Container;
  private readonly th: PianoTheme;
  private readonly openTools = new Map<string, ToolCallBox>();
  private readonly toolBoxes: ToolCallBox[] = [];
  private readonly errorBoxes: ErrorBox[] = [];
  private expandedFlag = false;
  /** Wall-clock start of each open tool call, for the elapsed time shown on
   * completion. Only the live `route` path fills it: a replayed trajectory
   * carries no timestamps, so replay must not invent durations. */
  private readonly toolStartedAt = new Map<string, number>();
  /** Wall-clock start of the assistant message being streamed. */
  private responseStartedAt: number | undefined;
  /** The `↳ …` line each agent handle has drawn, so a refining `start` (the
   * harness's `spawn`) updates it instead of stacking a second line. */
  private readonly spawnLines = new Map<string, Text>();
  /** Injectable clock so the timing paths are deterministic under test. */
  private readonly now: () => number;
  /** The one live Markdown block a turn is written into, open between the
   * first `text_delta` and the `message_end` that closes it. */
  private liveStream: TranscriptStream | undefined;

  constructor(chatArea: Container, th: PianoTheme, now: () => number = () => Date.now()) {
    this.chatArea = chatArea;
    this.th = th;
    this.now = now;
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

  renderEvent(event: AgentEvent, timing?: { readonly toolDurationMs?: number }): void {
    switch (event.type) {
      case "spawn": {
        this.appendText(formatSpawnLine(this.th, {
          stageId: event.workflow?.stageId,
          iteration: loopIteration(event.workflow?.invocationId),
          worker: event.workflow?.worker,
          harness: event.harness,
          model: event.model,
        }));
        break;
      }
      case "tool_execution_start":
        this.drawToolCall(event.toolCallId, event.toolName, stringifyArg(event.args));
        break;
      case "tool_execution_end":
        this.completeToolCall(
          event.toolCallId,
          stringifyResult(event.result, event.isError),
          event.isError,
          timing?.toolDurationMs,
        );
        break;
      case "message_end": {
        if (event.message.role !== undefined && event.message.role !== "assistant") break;
        const text = messageText(event.message);
        if (text !== undefined) this.drawAssistantMessage(text);
        break;
      }
      case "error":
        this.appendErrorLine(event.message);
        break;
      case "retry":
        // The transient-failure half of the story: an attempt failed but the
        // retry boundary has it. The `error` line above shows what broke;
        // these lines show what Piano is doing about it.
        this.appendRetryLine(event);
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
    // Arm the reply clock at submit so the footer measures the whole wait, not
    // just the streaming tail.
    this.responseStartedAt = this.now();
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
    this.toolStartedAt.clear();
    this.spawnLines.clear();
    this.responseStartedAt = undefined;
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
      this.appendStreamDelta(delta);
      return;
    }
    if (event.type === "message_end") {
      const startedAt = this.responseStartedAt;
      this.responseStartedAt = undefined;
      const streamed = this.liveStream !== undefined;
      this.closeLiveStream();
      if (!streamed) this.renderEvent(event);
      this.appendResponseTiming(event, startedAt);
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
    const toolDurationMs = this.trackToolDuration(event);
    this.closeLiveStream();
    this.renderEvent(event, toolDurationMs === undefined ? undefined : { toolDurationMs });
  }

  /** Grow the one live Markdown block a turn is written into. The reply clock
   * falls back to the first delta for a harness that opens a turn without a
   * user echo; `renderUserMessage` normally arms it at submit time so the
   * figure covers time-to-first-token as well as generation. */
  private appendStreamDelta(delta: string): void {
    this.responseStartedAt ??= this.now();
    if (this.liveStream === undefined) this.liveStream = this.newStream();
    this.liveStream.append(delta);
  }

  /** Draw the op stream into the transcript. Under `--langfuse` this is the
   * chat's content source — the panel and the wire read the same ops — and
   * `route` is left unused. A `user.message` op is skipped: the prompt echo
   * already drew the turn's heading. */
  routeOps(ops: readonly ObservationOp[]): void {
    for (const op of ops) {
      if (op.op === "update") {
        const delta = asRecord(op.output)?.delta;
        if (typeof delta === "string") this.appendStreamDelta(delta);
        continue;
      }
      if (op.op === "start" && op.type === "agent") {
        this.closeLiveStream();
        this.drawSpawnLine(op);
        continue;
      }
      if (op.op === "start" && op.type === "tool") {
        const toolCallId = toolCallIdFromHandle(op.handle);
        if (toolCallId === undefined) continue;
        this.closeLiveStream();
        if (!this.toolStartedAt.has(toolCallId)) {
          this.toolStartedAt.set(toolCallId, Date.parse(op.timestamp));
        }
        this.drawToolCall(toolCallId, op.name, stringifyArg(op.input));
        continue;
      }
      if (op.op === "end") {
        const toolCallId = toolCallIdFromHandle(op.handle);
        if (toolCallId !== undefined) {
          this.closeLiveStream();
          const startedAt = this.toolStartedAt.get(toolCallId);
          this.toolStartedAt.delete(toolCallId);
          this.completeToolCall(
            toolCallId,
            stringifyResult(op.output, op.level === "ERROR"),
            op.level === "ERROR",
            startedAt === undefined ? undefined : Date.parse(op.timestamp) - startedAt,
          );
          continue;
        }
        if (op.name !== undefined && op.name.endsWith(".message")) {
          const streamed = this.liveStream !== undefined;
          const startedAt = this.responseStartedAt;
          this.responseStartedAt = undefined;
          this.closeLiveStream();
          const text = outputText(op);
          if (!streamed && text !== undefined) this.drawAssistantMessage(text);
          this.appendTiming(startedAt);
        }
        continue;
      }
      if (op.op === "emit" && op.name === AGENT_ERROR_NAME) {
        this.closeLiveStream();
        this.appendErrorLine(metadataString(op, "message") ?? "");
        continue;
      }
      if (op.op === "emit" && op.name === AGENT_RETRY_NAME) {
        this.closeLiveStream();
        this.appendRetryLine({
          event: metadataString(op, "event"),
          attempt: metadataNumber(op, "attempt"),
          nextAttempt: metadataNumber(op, "nextAttempt"),
          totalAttempts: metadataNumber(op, "totalAttempts"),
          delayMs: metadataNumber(op, "delayMs"),
          errorType: metadataString(op, "errorType"),
          message: metadataString(op, "message"),
        });
        continue;
      }
      if (op.op === "emit" && op.name === AGENT_DONE_NAME) {
        this.closeLiveStream();
        this.appendText(`  ${this.th.success}✓${RST}  ${this.th.success}done${RST}`);
      }
    }
  }

  /** The `↳ …` line, updated in place when a later `start` refines the same
   * handle (the harness's `spawn` closes what `stage_attempt_started` opened). */
  private drawSpawnLine(op: Extract<ObservationOp, { op: "start" }>): void {
    const input = asRecord(op.input);
    const line = formatSpawnLine(this.th, {
      stageId: typeof input?.stageId === "string" ? input.stageId : undefined,
      iteration: loopIteration(metadataString(op, "invocationId")),
      worker: metadataString(op, "worker"),
      harness: typeof input?.harness === "string" ? input.harness : undefined,
      model: op.model,
    });
    const drawn = this.spawnLines.get(op.handle);
    if (drawn !== undefined) {
      drawn.setText(line);
      return;
    }
    const text = new Text(line, 0, 0);
    this.spawnLines.set(op.handle, text);
    this.chatArea.addChild(text);
  }

  private drawToolCall(toolCallId: string, toolName: string, args: string): void {
    const open = this.openTools.get(toolCallId);
    if (open !== undefined) {
      open.setArgs(args);
      return;
    }
    const tool = new ToolCallBox(toolName, args, this.th);
    tool.setExpanded(this.expandedFlag);
    this.openTools.set(toolCallId, tool);
    this.toolBoxes.push(tool);
    this.chatArea.addChild(tool.box);
  }

  private completeToolCall(
    toolCallId: string,
    result: string,
    isError: boolean,
    durationMs: number | undefined,
  ): void {
    const open = this.openTools.get(toolCallId);
    if (open === undefined) {
      this.appendText(`     ${this.th.dim}│ ${result}${RST}`);
      return;
    }
    open.complete(result, isError, durationMs);
    this.openTools.delete(toolCallId);
  }

  private drawAssistantMessage(text: string): void {
    this.chatArea.addChild(new Markdown(text, 1, 0, buildMarkdownTheme(this.th), {
      color: (s) => this.th.primary + s + RST,
    }));
  }

  private appendErrorLine(message: string): void {
    this.appendText(`  ${this.th.error}✗${RST}  ${this.th.error}${message}${RST}`);
  }

  /** The retry boundary: the transient-failure half of the story. The `error`
   * line shows what broke; this shows what Piano is doing about it. */
  private appendRetryLine(facts: {
    readonly event?: string;
    readonly attempt?: number;
    readonly nextAttempt?: number;
    readonly totalAttempts?: number;
    readonly delayMs?: number;
    readonly errorType?: string;
    readonly message?: string;
  }): void {
    if (facts.event !== "scheduled") {
      this.appendText(`  ${this.th.success}✓${RST}  ${this.th.success}recovered on attempt ${facts.attempt ?? 0}${RST}`);
      return;
    }
    const why = facts.message ?? facts.errorType ?? "";
    this.appendText(
      `  ${this.th.primary}↻${RST}  ${this.th.primary}retrying in ${Math.round((facts.delayMs ?? 0) / 1000)}s ` +
        `(attempt ${facts.nextAttempt ?? "?"}/${facts.totalAttempts ?? 0}): ${why}${RST}`,
    );
  }

  /** Elapsed time of one live tool call. Arms the clock on its start event and
   * reports the duration on the matching end; undefined for every other event.
   * A re-reported start (Claude opens a call with empty args and names them on
   * completion) keeps the original start time rather than restarting. */
  private trackToolDuration(event: AgentEvent): number | undefined {
    if (event.type === "tool_execution_start") {
      if (!this.toolStartedAt.has(event.toolCallId)) {
        this.toolStartedAt.set(event.toolCallId, this.now());
      }
      return undefined;
    }
    if (event.type !== "tool_execution_end") return undefined;
    const startedAt = this.toolStartedAt.get(event.toolCallId);
    this.toolStartedAt.delete(event.toolCallId);
    return startedAt === undefined ? undefined : this.now() - startedAt;
  }

  /** One dim footer under a completed assistant reply with how long it took.
   * Only the live path calls it, so a replayed turn — whose events arrive in a
   * tight loop and carry no timestamps — never shows a fabricated duration. */
  private appendResponseTiming(event: AgentEvent, startedAt: number | undefined): void {
    if (event.type !== "message_end") return;
    const role = event.message.role;
    if (role !== undefined && role !== "assistant") return;
    if (messageText(event.message) === undefined) return;
    this.appendTiming(startedAt);
  }

  /** One dim footer under a completed assistant reply with how long it took. */
  private appendTiming(startedAt: number | undefined): void {
    if (startedAt === undefined) return;
    this.appendText(`  ${this.th.dim}✎ ${formatCompactDuration(this.now() - startedAt)}${RST}`);
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
