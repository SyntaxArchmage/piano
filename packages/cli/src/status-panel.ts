import { getCapabilities, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { RST, type PianoTheme } from "./theme.js";
import type { WorkflowGraph } from "./workflow-graph.js";
import { detectSixelSupport } from "./sixel.js";
import { TUI_SLASH_COMMANDS } from "./tui-commands.js";
import type { ScrollModifier } from "./shortcuts.js";
import { usageRows, emptyRunStats, type RunStats } from "./run-stats.js";

interface FooterColumn {
  readonly header: string;
  readonly rows: readonly string[];
}

function cell(value: string, width: number): string {
  if (width <= 0) return "";
  const valueWidth = visibleWidth(value);
  if (valueWidth <= width) return `${value}${" ".repeat(width - valueWidth)}`;
  return truncateToWidth(value, width);
}

/** Footer geometry without workflow state. `shrinkOrder` lists column indices
 * to reduce first when the terminal is too narrow — WORKFLOW and SHORTCUTS are
 * the least essential and sacrifice width before USAGE and COMMANDS. */
function layoutColumns(
  columns: readonly FooterColumn[],
  theme: PianoTheme,
  width: number,
  shrinkOrder: readonly number[],
): string[] {
  const total = Math.max(0, Math.floor(width));
  if (total === 0) return [];

  const fullGap = `${theme.dim} │ ${RST}`;
  const canUseFullGaps = total >= 3 * (columns.length - 1) + columns.length;
  const canUseCompactGaps = total >= 2 * columns.length - 1;
  const separator = canUseFullGaps ? fullGap : canUseCompactGaps ? " " : "";
  const gaps = (canUseFullGaps ? 3 : canUseCompactGaps ? 1 : 0) * (columns.length - 1);
  const widths = columns.map((column) => Math.max(
    visibleWidth(column.header),
    ...column.rows.map(visibleWidth),
  ));
  const budget = Math.max(0, total - gaps);
  while (widths.reduce((sum, value) => sum + value, 0) > budget) {
    const target = shrinkOrder.find((index) => (widths[index] ?? 0) > 0);
    if (target === undefined) break;
    widths[target] = (widths[target] ?? 0) - 1;
  }

  const height = 1 + Math.max(0, ...columns.map((column) => column.rows.length));
  return Array.from({ length: height }, (_, row) => {
    const body = columns.map((column, index) => cell(
      row === 0 ? column.header : (column.rows[row - 1] ?? ""),
      widths[index] ?? 0,
    )).join(separator);
    const solidBody = body.split(RST).join(`${RST}${theme.barBg}`);
    return `${theme.barBg}${solidBody}${" ".repeat(Math.max(0, total - visibleWidth(body)))}${RST}`;
  });
}

/** Width the WORKFLOW column is actually left with once the other three take
 * their natural widths and the three ` │ ` separators are paid for. The DAG must
 * be drawn at exactly this width: `layoutColumns` shrinks WORKFLOW first, so a
 * wider canvas is sliced from the right and the centered stage nodes — names and
 * model lines included — fall outside the visible cell. */
function workflowColumnWidth(columns: readonly FooterColumn[], total: number): number {
  const separators = 3 * columns.length;
  const natural = columns.reduce((sum, column) =>
    sum + Math.max(visibleWidth(column.header), ...column.rows.map(visibleWidth)), 0);
  return Math.max(0, total - separators - natural);
}

/** Interaction footer with an optional read-only workflow DAG in WORKFLOW and
 * an always-on cumulative usage column. `copyMode` renders the modal indicator:
 * a released mouse makes the wheel and split-drag stop responding, so without a
 * visible marker the mode reads as a hang. */
export function renderStatusPanel(theme: PianoTheme, width: number, graph?: WorkflowGraph, stats?: RunStats, copyMode = false, scrollModifier: ScrollModifier = "Ctrl"): string[] {
  const renderWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  if (renderWidth === 0) return [];
  const imageCapable = getCapabilities().images !== null || detectSixelSupport();
  const usageTheme = { dim: theme.dim, primary: theme.primary, accent: theme.accent, reset: RST };
  // The usage column always renders four rows (tokens/tools/stages/status),
  // providing the "0/1 waiting"-style runtime watch regardless of whether a
  // workflow graph or events have streamed in yet. Without stats it renders
  // the empty/waiting labels so the column shape is stable.
  const usageRowsBuilt = usageRows(stats ?? emptyRunStats(), usageTheme);
  const interactionColumns: readonly FooterColumn[] = [
    {
      header: `${theme.dim}COMMANDS${RST}`,
      rows: TUI_SLASH_COMMANDS.map((command) =>
        `${theme.primary}/${command.name}${RST} ${theme.dim}${command.description ?? ""}${RST}`),
    },
    {
      header: `${theme.dim}SHORTCUTS${RST}`,
      rows: [
        `${theme.primary}Esc${RST} ${theme.dim}interrupt${RST}`,
        `${theme.primary}Ctrl+C${RST} ${theme.dim}exit${RST}`,
        `${theme.primary}Enter${RST} ${theme.dim}submit${RST}`,
        // "jump" covers both directions; the panel's own ↑/↓ more rows name
        // Keep the displayed modifier in sync with the terminal-specific key
        // bindings used by the input router.
        `${theme.primary}${scrollModifier}+Home/End${RST} ${theme.dim}jump${RST}`,
        // Accent + uppercase while active so the row reads as a badge. Both
        // states are the same visible width, so toggling copy mode does not
        // reflow the neighbouring columns; the key stays in the label because
        // the same key is the way back out.
        copyMode
          ? `${theme.accent}Alt+C COPY MODE${RST}`
          : `${theme.primary}Alt+C${RST} ${theme.dim}copy mode${RST}`,
      ],
    },
    {
      header: `${theme.dim}USAGE${RST}`,
      rows: usageRowsBuilt,
    },
  ];
  // The WORKFLOW column is the graph's home, so the graph is drawn at the width
  // that column will really be given — not a share of the whole terminal, which
  // the layout would then slice the DAG out of.
  const statusGraphWidth = workflowColumnWidth(interactionColumns, renderWidth);
  const statusRows = graph === undefined
    ? []
    : [
      graph.summary(),
      ...(imageCapable ? [] : graph.render(statusGraphWidth)),
    ];
  const footer = layoutColumns([
    ...interactionColumns,
    {
      header: `${theme.dim}WORKFLOW${RST}`,
      rows: statusRows,
    },
  ], theme, renderWidth, [3, 1, 0, 2]);
  // Image protocol escape sequences must remain on their own full-width line;
  // passing them through the column truncator would corrupt the payload. The
  // WORKFLOW summary anchors the visual semantically in the existing section.
  // Raster image protocol payloads must remain on their own full-width lines.
  // The protocol-free fallback is ordinary text and belongs inside WORKFLOW.
  return [...(imageCapable ? (graph?.render(renderWidth) ?? []) : []), ...footer];
}
