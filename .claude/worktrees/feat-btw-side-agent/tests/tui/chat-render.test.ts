import { describe, expect, it } from "vitest";
import {
  buildMarkdownTheme,
  ErrorBox,
  renderUserMessage,
  stageTagColor,
  ToolCallBox,
  TranscriptView,
} from "../../packages/cli/src/chat-render.js";
import { RST, darkTheme } from "../../packages/cli/src/theme.js";
import { Container } from "@earendil-works/pi-tui";

describe("buildMarkdownTheme", () => {
  it("returns all 14 markdown theme functions, each wrapping text non-empty", () => {
    const theme = buildMarkdownTheme(darkTheme);
    const fnNames = [
      "heading", "link", "linkUrl", "code", "codeBlock", "codeBlockBorder",
      "quote", "quoteBorder", "hr", "listBullet", "bold", "italic",
      "strikethrough", "underline",
    ] as const;
    for (const name of fnNames) {
      const fn = theme[name] as (text: string) => string;
      expect(typeof fn, `theme.${name} should be a function`).toBe("function");
      const rendered = fn("x");
      expect(rendered, `theme.${name}("x") should be non-empty`).toBeTruthy();
      expect(rendered, `theme.${name}("x") should wrap the text`).toContain("x");
      expect(rendered, `theme.${name}("x") should reset`).toContain(RST);
    }
    expect(theme.highlightCode).toBeUndefined();
  });
});

describe("renderUserMessage", () => {
  it("renders a compact user content block without a role label or border", () => {
    const rows = renderUserMessage("hello", darkTheme).render(40);
    const out = rows.join("\n");
    expect(out).toContain("▌");
    expect(out).toContain("hello");
    expect(out).toContain(darkTheme.userBg);
    expect(out).not.toContain("user:");
    expect(out).not.toContain("┌");
    expect(out).not.toContain("└");
  });
});

describe("ToolCallBox", () => {
  it("is collapsed by default: title + Ctrl+O hint, no arg", () => {
    const box = new ToolCallBox("read", '{"p":1}', darkTheme);
    const out = box.box.render(60).join("\n");
    expect(box.expanded).toBe(false);
    expect(out).toContain("⚙");
    expect(out).toContain("read");
    expect(out).toContain("Ctrl+O");
    expect(out).not.toContain('{"p":1}');
  });

  it("renders no background strip (no reverse-video or colored bg)", () => {
    const box = new ToolCallBox("read", '{"p":1}', darkTheme);
    box.complete("ok", false);
    const out = box.box.render(60).join("\n");
    expect(out).not.toContain("\x1b[7m");
    expect(out).not.toContain("48;2");
    expect(out).not.toContain("48;5");
  });

  it("setExpanded(true) shows the arg; setExpanded(false) hides it again", () => {
    const box = new ToolCallBox("read", '{"p":1}', darkTheme);
    box.setExpanded(true);
    expect(box.expanded).toBe(true);
    expect(box.box.render(60).join("\n")).toContain('{"p":1}');
    box.setExpanded(false);
    expect(box.expanded).toBe(false);
    expect(box.box.render(60).join("\n")).not.toContain('{"p":1}');
  });

  it("complete() adds the ✓ glyph and, only when expanded, the summary", () => {
    const box = new ToolCallBox("read", '{"p":1}', darkTheme);
    box.complete("ok", false);
    const collapsed = box.box.render(60).join("\n");
    expect(collapsed).toContain("✓");
    expect(collapsed).not.toContain("ok");
    expect(collapsed).toContain(darkTheme.success);
    box.setExpanded(true);
    expect(box.box.render(60).join("\n")).toContain("ok");
  });

  it("complete(isError=true) adds the ✗ glyph and the summary only when expanded", () => {
    const box = new ToolCallBox("read", "", darkTheme);
    box.complete("boom", true);
    const collapsed = box.box.render(60).join("\n");
    expect(collapsed).toContain("✗");
    expect(collapsed).not.toContain("boom");
    expect(collapsed).toContain(darkTheme.error);
    box.setExpanded(true);
    expect(box.box.render(60).join("\n")).toContain("boom");
  });
});

describe("TranscriptView", () => {
  it("pairs a tool_execution_start with its tool_execution_end in the same box", () => {
    const chatArea = new Container();
    const view = new TranscriptView(chatArea, darkTheme);
    view.renderEvent({ type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: {} });
    view.renderEvent({ type: "tool_execution_end", toolCallId: "c1", toolName: "read", result: "ok", isError: false });
    const out = chatArea.render(60).join("\n");
    expect(out).toContain("read");
    expect(out).toContain("✓");
    expect(out).not.toContain("ok"); // collapsed hides the summary
    expect(out).toContain(darkTheme.success);
    view.setExpanded(true);
    expect(chatArea.render(60).join("\n")).toContain("ok");
  });

  it("folds a re-reported tool call into the open box instead of stacking a twin", () => {
    const chatArea = new Container();
    const view = new TranscriptView(chatArea, darkTheme);
    view.setExpanded(true);
    // Claude's streamed `content_block_start` opens the block with an empty
    // input; the completed `assistant` record reports the same id again with
    // the real arguments. Two boxes would leave one pending forever.
    view.renderEvent({ type: "tool_execution_start", toolCallId: "c1", toolName: "Bash", args: {} });
    view.renderEvent({ type: "tool_execution_start", toolCallId: "c1", toolName: "Bash", args: { command: "echo hi" } });
    view.renderEvent({ type: "tool_execution_end", toolCallId: "c1", toolName: "Bash", result: "hi", isError: false });

    const out = chatArea.render(80).join("\n");
    expect(out.match(/⚙ Bash/g)).toHaveLength(1);
    expect(out).toContain("echo hi");
    expect(out).toContain("✓");
  });

  it("pairs interleaved same-name tools by toolCallId", () => {
    const chatArea = new Container();
    const view = new TranscriptView(chatArea, darkTheme);
    view.setExpanded(true);
    view.renderEvent({ type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: { p: 1 } });
    view.renderEvent({ type: "tool_execution_start", toolCallId: "c2", toolName: "read", args: { p: 2 } });
    view.renderEvent({ type: "tool_execution_end", toolCallId: "c1", toolName: "read", result: "first", isError: false });
    view.renderEvent({ type: "tool_execution_end", toolCallId: "c2", toolName: "read", result: "second", isError: false });

    const output = chatArea.render(80).join("\n");
    expect(output.indexOf('"first"')).toBeLessThan(output.indexOf('{"p":2}'));
    expect(output.indexOf('"second"')).toBeGreaterThan(output.indexOf('{"p":2}'));
  });

  it("keeps unprintable tool values from breaking the transcript", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const throwing: Record<string, unknown> = {};
    Object.defineProperty(throwing, "value", {
      enumerable: true,
      get: () => { throw new Error("value unavailable"); },
    });
    const chatArea = new Container();
    const view = new TranscriptView(chatArea, darkTheme);
    view.setExpanded(true);

    expect(() => {
      view.renderEvent({ type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: circular });
      view.renderEvent({ type: "tool_execution_end", toolCallId: "c1", toolName: "read", result: throwing, isError: true });
      view.renderEvent({ type: "tool_execution_start", toolCallId: "c2", toolName: "read", args: 1n });
    }).not.toThrow();

    const output = chatArea.render(80).join("\n");
    expect(output).toContain("[unprintable]");
  });

  it("starts collapsed and toggleExpanded() flips the global state", () => {
    const chatArea = new Container();
    const view = new TranscriptView(chatArea, darkTheme);
    expect(view.expanded).toBe(false);
    expect(view.toggleExpanded()).toBe(true);
    expect(view.toggleExpanded()).toBe(false);
  });

  it("setExpanded(true) expands every box it created (arg visible)", () => {
    const chatArea = new Container();
    const view = new TranscriptView(chatArea, darkTheme);
    view.renderEvent({ type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: { p: 1 } });
    view.renderEvent({ type: "tool_execution_start", toolCallId: "c2", toolName: "bash", args: {} });
    expect(chatArea.render(60).join("\n")).not.toContain('{"p":1}');
    view.setExpanded(true);
    const out = chatArea.render(60).join("\n");
    expect(out).toContain('{"p":1}');
  });

  it("a ToolCallBox created while expanded renders expanded", () => {
    const chatArea = new Container();
    const view = new TranscriptView(chatArea, darkTheme);
    view.setExpanded(true);
    view.renderEvent({ type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: { p: 1 } });
    const out = chatArea.render(60).join("\n");
    expect(out).toContain('{"p":1}');
    expect(out).not.toContain("Ctrl+O");
  });

  it("falls back to a dim line when a tool_execution_end has no open tool", () => {
    const chatArea = new Container();
    const view = new TranscriptView(chatArea, darkTheme);
    view.renderEvent({ type: "tool_execution_end", toolCallId: "c1", toolName: "read", result: "orphan", isError: false });
    const out = chatArea.render(60).join("\n");
    expect(out).toContain("orphan");
  });

  it("streams deltas into a single live markdown block", () => {
    const chatArea = new Container();
    const view = new TranscriptView(chatArea, darkTheme);
    const stream = view.newStream();
    stream.append("a");
    stream.append("b");
    stream.finalize();
    const out = chatArea.render(60).join("\n");
    expect(out).toContain("ab");
  });

  it("renders message_end as a primary-colored markdown block", () => {
    const chatArea = new Container();
    const view = new TranscriptView(chatArea, darkTheme);
    view.renderEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "hello world" }] } });
    const out = chatArea.render(60).join("\n");
    expect(out).toContain("hello world");
  });

  it("does not duplicate non-assistant message_end events in chat", () => {
    const chatArea = new Container();
    const view = new TranscriptView(chatArea, darkTheme);
    view.renderEvent({ type: "message_end", message: { role: "user", content: "local echo" } });
    view.renderEvent({ type: "message_end", message: { role: "toolResult", content: "tool output" } });
    expect(chatArea.render(60).join("\n")).not.toContain("local echo");
    expect(chatArea.render(60).join("\n")).not.toContain("tool output");
  });

  it("renders spawn/done/error metadata lines", () => {
    const chatArea = new Container();
    const view = new TranscriptView(chatArea, darkTheme);
    view.renderEvent({ type: "spawn", harness: "pi", skills: [] });
    view.renderEvent({ type: "done", exitStatus: 0, sessionId: "session", transcriptPath: "" });
    view.renderEvent({ type: "error", errorType: "boom", message: "failed" });
    const out = chatArea.render(60).join("\n");
    expect(out).toContain("↳ pi");
    expect(out).toContain("done");
    expect(out).toContain("failed");
  });

  it("renders structured workflow failures as a readable error block", () => {
    const chatArea = new Container();
    const view = new TranscriptView(chatArea, darkTheme);
    view.appendError("workflow failed", {
      type: "WorkflowError",
      message: "workflow parse failed at workflow.yml: bad indentation",
    });
    const out = chatArea.render(80).join("\n");
    expect(out).toContain("workflow failed");
    expect(out).toContain("Ctrl+E");
    expect(out).not.toContain("WorkflowError");
    expect(out).not.toContain("bad indentation");
  });

  it("keeps an error compact until its detail is toggled", () => {
    const error = new ErrorBox("workflow failed", {
      type: "WorkflowError",
      message: "workflow.yml: bad indentation",
    }, darkTheme);
    expect(error.box.render(80).join("\n")).toContain("Ctrl+E");
    expect(error.box.render(80).join("\n")).not.toContain("bad indentation");
    error.toggle();
    const detail = error.box.render(80).join("\n");
    expect(detail).toContain("WorkflowError");
    expect(detail).toContain("workflow.yml: bad indentation");
    expect(detail).toContain(darkTheme.mdHeading);
    expect(detail).not.toContain(`${darkTheme.error}WorkflowError`);
    expect(detail).not.toContain("```text");
  });

  it("wraps the full expanded error detail instead of truncating it", () => {
    const message = "workflow parse failed because this detail must remain readable across a narrow chat area";
    const error = new ErrorBox("workflow failed", {
      type: "WorkflowError",
      message,
    }, darkTheme);
    error.toggle();
    const rows = error.box.render(36);
    const output = rows.join("\n");
    expect(output).toContain("WorkflowError");
    expect(output).toContain("narrow chat area");
    expect(output).not.toContain("```text");
    expect(rows.length).toBeGreaterThan(2);
  });

  it("surfaces workflow stage + iteration on a spawn line", () => {
    const chatArea = new Container();
    const view = new TranscriptView(chatArea, darkTheme);
    view.renderEvent({
      type: "spawn",
      harness: "pi",
      model: "gpt-4o",
      skills: [],
      workflow: { stageId: "tune.profile", invocationId: "tune.profile@tune/iter-3", worker: "cuda-profile", attempt: 0 },
    });
    const out = chatArea.render(60).join("\n");
    // 1-based iteration is shown: iter-0 -> #1, iter-3 -> #4.
    expect(out).toContain("tune.profile #4");
    expect(out).toContain("gpt-4o");
    expect(out).toContain("cuda-profile");
  });

  it("colors the workflow stage tag per stage and keeps the model on the line", () => {
    const renderSpawn = (stageId: string, worker: string, model: string): string => {
      const chatArea = new Container();
      const view = new TranscriptView(chatArea, darkTheme);
      view.renderEvent({
        type: "spawn",
        harness: "dsh",
        model,
        skills: [],
        workflow: { stageId, invocationId: stageId, worker, attempt: 0 },
      });
      return chatArea.render(80).join("\n");
    };
    const setupLine = renderSpawn("setup-env", "topsop-setup-env", "deepseek-v4-flash");
    const ideaLine = renderSpawn("idea", "topsop-idea", "deepseek-v4-flash");
    // The stage worker name rides the tag, and the model follows in brackets.
    expect(setupLine).toContain("setup-env · topsop-setup-env");
    expect(setupLine).toContain("[deepseek-v4-flash]");
    // The tag color is theme-aware and deterministic per stage id.
    expect(setupLine).toContain(stageTagColor(darkTheme, "setup-env"));
    const repeatLine = renderSpawn("setup-env", "topsop-setup-env", "deepseek-v4-flash");
    expect(repeatLine).toContain(stageTagColor(darkTheme, "setup-env"));
    expect(stageTagColor(darkTheme, "setup-env")).not.toBe(stageTagColor(darkTheme, "idea"));
    expect(setupLine).not.toBe(ideaLine);
  });

  it("keeps a non-workflow spawn on the dim harness label without a worker", () => {
    const chatArea = new Container();
    const view = new TranscriptView(chatArea, darkTheme);
    view.renderEvent({ type: "spawn", harness: "dsh", skills: [] });
    const out = chatArea.render(60).join("\n");
    expect(out).toContain("↳ dsh");
    expect(out).toContain(darkTheme.dim);
    expect(out).not.toContain(" · ");
  });
});
