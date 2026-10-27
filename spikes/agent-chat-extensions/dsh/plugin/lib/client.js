// dsh spike client plugin, bundled in the hand-written lazy-CJS form the dsh
// boot facade expects: executing this file only registers a factory, and the
// module body runs when the loader materializes it. `react` is part of the
// shell's frozen PLATFORM_MODULES baseline, so it is a legal bare require.
//
// The plugin registers one Conversation Definition for the `piano-spike/*`
// log-only event family and one keyed `conversation.chat.node` renderer for
// kind `piano-spike`. The node renders in the main transcript beside ordinary
// assistant/tool nodes; it is not an assistant message.

window.__ModuleLoader__.load({
  id: "dsh-piano-spike",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");

    const STATUS_LABELS = {
      running: "Running",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
    };

    const styles = {
      root: {
        boxSizing: "border-box",
        width: "100%",
        minWidth: 0,
        background: "var(--dsw-alias-bg-module-platform)",
        borderRadius: "8px",
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        fontSize: "var(--dsh-content-font-size-secondary, 13px)",
        color: "var(--dsw-alias-label-secondary)",
      },
      header: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        minWidth: 0,
      },
      dot: {
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        flex: "none",
        background:
          "var(--dsw-alias-state-business-primary, #4d6bfe)",
      },
      title: {
        fontWeight: 510,
        flex: "none",
      },
      status: {
        flex: "none",
        marginLeft: "auto",
        color: "var(--dsw-alias-label-tertiary)",
      },
      phase: {
        color: "var(--dsw-alias-label-tertiary)",
        flex: "none",
      },
      line: {
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        color: "var(--dsw-alias-label-secondary)",
      },
      final: {
        color: "var(--dsw-alias-label-tertiary)",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      },
    };

    const STATUS_COLORS = {
      running: "var(--dsw-alias-state-business-primary, #4d6bfe)",
      completed: "var(--dsw-alias-state-success-primary, #2e9e5b)",
      failed: "var(--dsw-alias-state-error-primary, #d93026)",
      cancelled: "var(--dsw-alias-state-warning-primary, #c47f00)",
    };

    /** One custom Chat node: Piano status plus the latest progress line. */
    function PianoSpikeNode(props) {
      const data = (props && props.node && props.node.data) || {};
      const status = typeof data.status === "string" ? data.status : "running";
      const statusLabel = STATUS_LABELS[status] || status;
      const detail =
        status !== "running" && typeof data.finalText === "string" && data.finalText.length > 0
          ? data.finalText
          : typeof data.line === "string"
            ? data.line
            : "";
      return React.createElement(
        "section",
        {
          "data-piano-spike": true,
          "data-piano-spike-run": data.runId,
          "data-status": status,
          style: styles.root,
        },
        React.createElement(
          "div",
          { style: styles.header },
          React.createElement("span", {
            "aria-hidden": true,
            style: { ...styles.dot, background: STATUS_COLORS[status] || styles.dot.background },
          }),
          React.createElement("span", { style: styles.title }, "Piano run"),
          typeof data.phase === "string" && data.phase.length > 0
            ? React.createElement("span", { "data-piano-spike-phase": data.phase, style: styles.phase }, `· ${data.phase}`)
            : null,
          React.createElement("span", { "data-piano-spike-status": status, style: styles.status }, statusLabel),
        ),
        detail === ""
          ? null
          : React.createElement(
              "div",
              status === "running"
                ? { "data-piano-spike-line": true, style: styles.line, title: detail }
                : { "data-piano-spike-final": true, style: styles.final },
              detail,
            ),
      );
    }

    /** Durable piano-spike event family folded into one keyed Chat node. */
    const pianoSpikeDefinition = {
      kind: "piano-spike",
      target: "chat",
      match: (event) => {
        if (event.type === "piano-spike/run-start") return { id: String(event.data.runId), role: "start" };
        if (event.type === "piano-spike/progress" || event.type === "piano-spike/run-end") {
          return { id: String(event.data.runId), role: "update" };
        }
        return null;
      },
      start: (_context, match) => {
        if (match.event.type !== "piano-spike/run-start") {
          throw new Error("piano-spike start requires piano-spike/run-start");
        }
        return {
          runId: String(match.event.data.runId),
          prompt: match.event.data.prompt,
          workflowPath: match.event.data.workflowPath,
          status: "running",
          phase: null,
          line: null,
          dropped: 0,
          finalText: null,
        };
      },
      update: (context, match) => {
        const state = context.state;
        if (match.event.type === "piano-spike/progress") {
          return {
            ...state,
            phase: match.event.data.phase,
            line: match.event.data.line,
            dropped: state.dropped + (match.event.data.dropped || 0),
          };
        }
        if (match.event.type === "piano-spike/run-end") {
          return {
            ...state,
            status: match.event.data.status,
            finalText: match.event.data.text,
          };
        }
        return state;
      },
      buildViewNode: (context) => {
        if (context.start === undefined) return null;
        return {
          key: context.key,
          kind: "piano-spike",
          id: context.id,
          target: "chat",
          anchorSeq: context.start.event.seq,
          location: context.start.location,
          visibility: "visible",
          data: context.state,
        };
      },
    };

    /** Browser services this plugin waits for. */
    const inject = ["uiConversation", "slots"];

    /** Register the Definition and its keyed Chat renderer as Cordis effects. */
    function apply(ctx) {
      ctx.uiConversation.events.register(pianoSpikeDefinition);
      ctx.slots.inject("conversation.chat.node", () =>
        ctx.slots.register(
          {
            name: "conversation.chat.node",
            key: "piano-spike",
          },
          PianoSpikeNode,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
