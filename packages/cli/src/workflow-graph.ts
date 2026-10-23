import { Resvg } from "@resvg/resvg-js";
import {
  Image,
  allocateImageId,
  getCapabilities,
  type Component,
} from "@earendil-works/pi-tui";
import { RST, type PianoTheme } from "./theme.js";
import { detectSixelSupport, encodeSixelPng } from "./sixel.js";
import { formatCompactDuration } from "./duration.js";
import { isRecord } from "@piano/logging";
import { RUN_LIFECYCLE_STATUSES, type InvocationStatus, type RunLifecycleStatus } from "@piano/base";

interface WorkflowGraphStage {
  readonly id: string;
  readonly displayId?: string;
  readonly dependsOn: readonly string[];
  readonly label?: string;
  /** Model the stage runs on (`stage.model` in the DSL), drawn as a secondary
   * line under the stage name — the footer counterpart of the trajectory
   * panel's spawn model row. */
  readonly model?: string;
  /** Set on synthesized map slots: the runtime lane (`${mapId}/slot-${n}`)
   * whose invocations this node reports. A slot aggregates by lane because a
   * per-stage total cannot tell concurrent branches apart. */
  readonly lane?: string;
  readonly visualStatus?: WorkflowGraphNodeStatus;
}

interface WorkflowGraphMap {
  readonly id: string;
  readonly entryStageId: string;
  readonly exitStageId: string;
  readonly count: number;
}

/** The graph consumes the compiler's flattened leaf-stage view. Loop/map
 * expansion stays in progress counts; the displayed nodes remain the stable
 * ids emitted by the orchestrator. */
export interface WorkflowGraphDefinition {
  readonly stages: readonly WorkflowGraphStage[];
  readonly maps?: readonly WorkflowGraphMap[];
  /** Human workflow name (`workflow.name` in the DSL), surfaced in the footer. */
  readonly name?: string;
  /** Absolute path to the loaded workflow file, surfaced in the footer. */
  readonly path?: string;
}

/** Cumulative worker time the orchestrator recorded for one runtime
 * invocation. The CLI only reads it: every field is written by
 * `markWorkflowStageStarted` / `appendWorkflowProgress`. */
interface WorkflowGraphInvocationTime {
  readonly stageId?: string;
  readonly instanceId?: string;
  readonly completedMs?: number;
  /** ISO start of the span still in flight, so a running node ticks. */
  readonly runningSince?: string;
}

export interface WorkflowGraphSnapshot {
  readonly plannedStages?: number;
  readonly completedStages?: number;
  readonly status?: RunLifecycleStatus;
  readonly current?: {
    readonly stageId?: string;
    readonly status?: InvocationStatus;
  };
  readonly stageCounts?: Readonly<Record<string, {
    readonly planned?: number;
    readonly completed?: number;
  }>>;
  /** Invocation id -> cumulative worker time. */
  readonly invocationTime?: Readonly<Record<string, WorkflowGraphInvocationTime>>;
}

const GRAPH_STATUSES: ReadonlySet<string> = RUN_LIFECYCLE_STATUSES;
const CURRENT_STATUSES: ReadonlySet<string> = new Set<InvocationStatus>(["running", "accepted", "failed"]);

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function optionalNonNegativeInteger(value: Record<string, unknown>, key: string): boolean {
  return value[key] === undefined || nonNegativeInteger(value[key]);
}

/** Parse the orchestrator snapshot at the CLI boundary without trusting JSON
 * shape assertions. Invalid or partially-written snapshots are ignored so
 * the last valid view remains visible. */
export function parseWorkflowGraphSnapshot(value: unknown): WorkflowGraphSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  if (!optionalNonNegativeInteger(value, "plannedStages") ||
    !optionalNonNegativeInteger(value, "completedStages")) return undefined;
  if (value.status !== undefined &&
    (typeof value.status !== "string" || !GRAPH_STATUSES.has(value.status))) return undefined;
  if (value.current !== undefined) {
    if (!isRecord(value.current)) return undefined;
    if (value.current.stageId !== undefined && typeof value.current.stageId !== "string") return undefined;
    if (value.current.status !== undefined &&
      (typeof value.current.status !== "string" || !CURRENT_STATUSES.has(value.current.status))) return undefined;
  }
  if (value.stageCounts !== undefined) {
    if (!isRecord(value.stageCounts)) return undefined;
    for (const count of Object.values(value.stageCounts)) {
      if (!isRecord(count) || !optionalNonNegativeInteger(count, "planned") ||
        !optionalNonNegativeInteger(count, "completed")) return undefined;
    }
  }
  if (value.invocationTime !== undefined) {
    if (!isRecord(value.invocationTime)) return undefined;
    for (const time of Object.values(value.invocationTime)) {
      if (!isRecord(time)) return undefined;
      if (time.stageId !== undefined && typeof time.stageId !== "string") return undefined;
      if (time.instanceId !== undefined && typeof time.instanceId !== "string") return undefined;
      if (!optionalNonNegativeInteger(time, "completedMs")) return undefined;
      if (time.runningSince !== undefined &&
        (typeof time.runningSince !== "string" || !Number.isFinite(Date.parse(time.runningSince)))) {
        return undefined;
      }
    }
  }
  // Pick the graph's fields and no others: the run's state document carries
  // more than a graph draws, and a view that passed it all through would grow
  // whatever the document grows.
  return {
    ...(value.plannedStages === undefined ? {} : { plannedStages: value.plannedStages as number }),
    ...(value.completedStages === undefined ? {} : { completedStages: value.completedStages as number }),
    ...(value.status === undefined ? {} : { status: value.status as WorkflowGraphSnapshot["status"] }),
    ...(value.current === undefined ? {} : { current: value.current as WorkflowGraphSnapshot["current"] }),
    ...(value.stageCounts === undefined ? {} : { stageCounts: value.stageCounts as WorkflowGraphSnapshot["stageCounts"] }),
    ...(value.invocationTime === undefined
      ? {}
      : { invocationTime: value.invocationTime as WorkflowGraphSnapshot["invocationTime"] }),
  };
}

type WorkflowGraphSnapshotReader = () => Promise<WorkflowGraphSnapshot | undefined>;
type WorkflowGraphNodeStatus = "completed" | "running" | "failed" | "pending";

interface PositionedNode {
  readonly stage: WorkflowGraphStage;
  readonly status: WorkflowGraphNodeStatus;
  readonly x: number;
  readonly y: number;
}

interface GraphPalette {
  readonly backdrop: string;
  readonly backdropStroke: string;
  readonly text: string;
  readonly secondaryText: string;
  /** Light blue used for the stage model line (matches `theme.mdLink`). */
  readonly modelText: string;
  readonly pendingFill: string;
  readonly pendingStroke: string;
  readonly pendingDot: string;
  readonly completeFill: string;
  readonly completeStroke: string;
  readonly completeDot: string;
  readonly runningFillStart: string;
  readonly runningFillEnd: string;
  readonly runningStroke: string;
  readonly runningDot: string;
  readonly failedFill: string;
  readonly failedStroke: string;
  readonly failedDot: string;
  readonly edge: string;
}

const NODE_WIDTH = 164;
const NODE_HEIGHT = 58;
const LAYER_GAP = 76;
const ROW_GAP = 28;
const PADDING_X = 28;
const PADDING_Y = 24;
const MIN_IMAGE_COLUMNS = 24;
const MAX_IMAGE_ROWS = 12;
const MAX_RASTER_WIDTH = 1600;
const MAX_RASTER_HEIGHT = 720;

function terminalColor(value: string): string {
  if (getCapabilities().trueColor !== false) return value;
  // eslint-disable-next-line no-control-regex -- match the ANSI SGR introducer
  const match = value.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/);
  if (match === null) return value;
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  const cube = (channel: number): number => Math.round(channel / 255 * 5);
  const index = 16 + 36 * cube(r) + 6 * cube(g) + cube(b);
  return `\x1b[38;5;${index}m`;
}

function graphPalette(theme: PianoTheme): GraphPalette {
  const light = theme.barBg.includes("235;235;235");
  if (light) {
    return {
      backdrop: "#f4f5f7", backdropStroke: "#d9dde4", text: "#20242c", secondaryText: "#687181",
      modelText: "#004488",
      pendingFill: "#ffffff", pendingStroke: "#c7cdd7", pendingDot: "#8b94a3",
      completeFill: "#e9f8f0", completeStroke: "#46a977", completeDot: "#168653",
      runningFillStart: "#8b1d2c", runningFillEnd: "#c23d4d", runningStroke: "#8b0012", runningDot: "#ffffff",
      failedFill: "#fff0f1", failedStroke: "#dc5360", failedDot: "#c52e3b", edge: "#aeb6c2",
    };
  }
  return {
    backdrop: "#171a21", backdropStroke: "#2d3440", text: "#f3f5f8", secondaryText: "#9aa5b5",
    modelText: "#81a2be",
    pendingFill: "#222832", pendingStroke: "#4c5869", pendingDot: "#8b97a8",
    completeFill: "#173329", completeStroke: "#3dbb7d", completeDot: "#65dfa2",
    runningFillStart: "#6b1e2d", runningFillEnd: "#b83245", runningStroke: "#ff7e8d", runningDot: "#ffffff",
    failedFill: "#3a2027", failedStroke: "#ff6675", failedDot: "#ff7b87", edge: "#556173",
  };
}

interface FaceCell {
  readonly char: string;
  readonly color: string;
}

function faceStatus(status: WorkflowGraphNodeStatus, pulseOn: boolean): string {
  if (status === "completed") return "✓";
  if (status === "failed") return "×";
  if (status === "running") return pulseOn ? "◉" : "○";
  return "·";
}

function faceStatusColor(status: WorkflowGraphNodeStatus, theme: PianoTheme): string {
  switch (status) {
    case "completed": return terminalColor(theme.success);
    case "running": return terminalColor(theme.accent);
    case "failed": return terminalColor(theme.error);
    case "pending": return terminalColor(theme.dim);
  }
}

function facePut(canvas: FaceCell[][], x: number, y: number, char: string, color: string): void {
  const row = canvas[y];
  if (row === undefined || x < 0 || x >= row.length) return;
  row[x] = { char, color };
}

/** Minimal face-page DAG: the node itself is the status glyph, with no card or
 * block around it. Labels alternate above/below to halve the required width:
 * even-indexed stages get their label above the glyph row, odd-indexed get it
 * below, so all glyphs share a single horizontal line and every stage only
 * needs a few columns rather than a full layer slot. */
export function renderWorkflowGraphLineDag(
  definition: WorkflowGraphDefinition,
  snapshot: WorkflowGraphSnapshot | undefined,
  theme: PianoTheme,
  width: number,
  pulseOn = true,
  now = Date.now(),
): string[] {
  const totalWidth = Math.max(0, Math.floor(width));
  if (totalWidth < MIN_IMAGE_COLUMNS || definition.stages.length === 0) return [];
  const display = displayDefinition(definition, snapshot);
  const depths = stageDepths(display.stages);

  // Topological order: sort stages by depth, then by original order within depth.
  const originalOrder = new Map(display.stages.map((stage, index) => [stage.id, index]));
  const orderedStages = [...display.stages].sort((a, b) => {
    const depthDiff = (depths.get(a.id) ?? 0) - (depths.get(b.id) ?? 0);
    return depthDiff !== 0 ? depthDiff : (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0);
  });

  const count = orderedStages.length;
  const nodeSpacing = Math.floor(totalWidth / count);
  if (nodeSpacing < 4) return [];

  const labelWidth = Math.max(2, nodeSpacing - 1);
  type PreparedNode = {
    stage: WorkflowGraphStage;
    status: WorkflowGraphNodeStatus;
    lines: string[];
    modelFrom: number;
    x: number;
    index: number;
  };
  const nodes: PreparedNode[] = orderedStages.map((stage, index) => {
    const status = nodeStatus(stage, snapshot);
    const label = `${stageLabel(stage)}${stageTimeSuffix(stage, snapshot, now)}`;
    const labelLines = wrapStageLabel(label, labelWidth);
    const model = stage.model === undefined || stage.model === "" ? [] : [clippedLabel(stage.model, labelWidth)];
    const lines = [...labelLines, ...model];
    const x = index * nodeSpacing + Math.floor(nodeSpacing / 2);
    return { stage, status, lines, modelFrom: labelLines.length, x, index };
  });

  const maxLabelLines = Math.max(1, ...nodes.map(({ lines }) => lines.length));
  // Canvas rows: label-above space + glyph row + label-below space.
  const canvasHeight = maxLabelLines + 1 + maxLabelLines;
  const midY = maxLabelLines; // glyph row index
  const canvas: FaceCell[][] = Array.from({ length: canvasHeight }, () =>
    Array.from({ length: totalWidth }, () => ({ char: " ", color: theme.dim })));

  // Edges: draw on the glyph row between adjacent nodes with a dependency.
  const stageIndex = new Map(nodes.map(({ stage, index }) => [stage.id, index]));
  for (const node of nodes) {
    for (const dep of node.stage.dependsOn) {
      const depIdx = stageIndex.get(dep);
      if (depIdx === undefined) continue;
      const sourceNode = nodes[depIdx];
      if (sourceNode === undefined) continue;
      const color = node.status === "failed" ? terminalColor(theme.error)
        : node.status === "running" ? terminalColor(theme.accent) : terminalColor(theme.dim);
      const fromX = sourceNode.x + 1;
      const toX = node.x - 1;
      for (let x = fromX; x < toX; x += 1) facePut(canvas, x, midY, "─", color);
      if (toX >= fromX) facePut(canvas, toX, midY, "›", color);
    }
  }

  // Nodes and labels.
  for (const { status, lines, modelFrom, x, index } of nodes) {
    const color = faceStatusColor(status, theme);
    const modelColor = terminalColor(theme.mdLink);
    facePut(canvas, x, midY, faceStatus(status, pulseOn), color);
    const labelAbove = index % 2 === 0;
    for (const [lineIndex, line] of lines.entries()) {
      const labelX = Math.max(0, x - Math.floor(line.length / 2));
      const lineColor = lineIndex >= modelFrom ? modelColor : color;
      const y = labelAbove
        ? midY - lines.length + lineIndex  // lines anchor at bottom, touching midY
        : midY + 1 + lineIndex;            // lines start just below midY
      for (const [ci, ch] of [...line].entries()) facePut(canvas, labelX + ci, y, ch, lineColor);
    }
  }

  return canvas.map((row) => row.map((cell) => cell.char === " " ? " " : `${cell.color}${cell.char}${RST}`).join(""));
}

function stageDepths(stages: readonly WorkflowGraphStage[]): ReadonlyMap<string, number> {
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    const stage = byId.get(id);
    if (stage === undefined) return 0;
    visiting.add(id);
    const dependencies = stage.dependsOn.filter((dependency) => byId.has(dependency));
    const depth = dependencies.length === 0
      ? 0
      : Math.max(...dependencies.map((dependency) => depthOf(dependency) + 1));
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
  };
  for (const stage of stages) depthOf(stage.id);
  return depths;
}

function nodeStatus(stage: WorkflowGraphStage, snapshot: WorkflowGraphSnapshot | undefined): WorkflowGraphNodeStatus {
  if (stage.visualStatus !== undefined) return stage.visualStatus;
  const snapshotStatus = snapshot?.status;
  // Only explicitly terminal statuses suppress the running-pulse check. An
  // absent status field (partial/legacy snapshot) is treated as live so the
  // graph behaves the same as before this fix for status-less snapshots.
  // A cancelled run is a human stop like paused: nothing is working anymore.
  const terminal = snapshotStatus === "completed" || snapshotStatus === "paused" || snapshotStatus === "cancelled";
  const current = snapshot?.current;
  if (!terminal && current?.stageId === stage.id && current.status === "running") return "running";
  if (current?.stageId === stage.id && current.status === "failed") return "failed";
  if (current?.stageId === stage.id && current.status === "accepted") return "completed";
  const count = snapshot?.stageCounts?.[stage.id];
  if (count !== undefined && count.planned !== undefined && count.completed !== undefined &&
    count.planned > 0 && count.completed >= count.planned) return "completed";
  // A fully-completed run means every planned stage ran; treat any residual
  // pending stages as completed. A paused run may have unstarted stages —
  // leave those as pending so the viewer can see where the run stopped.
  if (snapshotStatus === "completed") return "completed";
  return "pending";
}

function stageLabel(stage: WorkflowGraphStage): string {
  return stage.label ?? stage.displayId ?? ownStageName(stage.id);
}

function ownStageName(id: string): string {
  const separator = Math.max(id.lastIndexOf("."), id.lastIndexOf("/"));
  return separator < 0 ? id : id.slice(separator + 1);
}

function stageDisplayId(stage: WorkflowGraphStage): string {
  return stage.displayId ?? stage.id;
}

function mapSlotLabel(map: WorkflowGraphMap, index: number): string {
  return `${ownStageName(map.entryStageId)}#${index}`;
}

/** Cumulative worker time for one displayed node, or undefined when the
 * orchestrator measured none. A static stage sums every invocation of that
 * stage, which is exactly how a loop accumulates its iterations (`iter 0 +
 * iter 1 + ...`); a synthesized map slot sums only its own lane. */
function nodeTimeMs(
  stage: WorkflowGraphStage,
  snapshot: WorkflowGraphSnapshot | undefined,
  now: number,
): number | undefined {
  const times = snapshot?.invocationTime;
  if (times === undefined) return undefined;
  // A finished or paused run is not working, so its open span stops ticking.
  const live = snapshot?.status === "running";
  let total = 0;
  let measured = false;
  for (const time of Object.values(times)) {
    if (!reportsOn(time, stage)) continue;
    measured = true;
    total += time.completedMs ?? 0;
    const open = time.runningSince === undefined ? undefined : Date.parse(time.runningSince);
    if (live && open !== undefined && Number.isFinite(open)) total += Math.max(0, now - open);
  }
  return measured ? total : undefined;
}

function reportsOn(time: WorkflowGraphInvocationTime, stage: WorkflowGraphStage): boolean {
  if (stage.lane !== undefined) return laneHolds(time.instanceId, stage.lane);
  return time.stageId === stage.id;
}

/** Match a lane as a whole path segment so `m/slot-1` never absorbs
 * `m/slot-10`. A nested region keeps the outer lane as a prefix of the inner
 * invocation's instance id, so a lane is matched anywhere in the chain. */
function laneHolds(instanceId: string | undefined, lane: string): boolean {
  if (instanceId === undefined) return false;
  for (let from = 0; from < instanceId.length;) {
    const at = instanceId.indexOf(lane, from);
    if (at < 0) return false;
    const next = instanceId[at + lane.length];
    if (next === undefined || next === "/") return true;
    from = at + 1;
  }
  return false;
}

/** `profile - 1m02s`: the time rides on the stage name because the model line
 * below is already the widest text in the pill. */
function stageTimeSuffix(
  stage: WorkflowGraphStage,
  snapshot: WorkflowGraphSnapshot | undefined,
  now: number,
): string {
  const time = nodeTimeMs(stage, snapshot, now);
  return time === undefined ? "" : ` - ${formatCompactDuration(time)}`;
}

/** Replace compiler map internals with visual fan-out slots. Runtime stage IDs
 * and progress snapshots remain untouched; this is only the terminal scene. */
function displayDefinition(
  definition: WorkflowGraphDefinition,
  snapshot: WorkflowGraphSnapshot | undefined,
): WorkflowGraphDefinition {
  const maps = definition.maps?.filter((map) => Number.isSafeInteger(map.count) && map.count > 0) ?? [];
  if (maps.length === 0) return definition;
  const slotByInternalId = new Map<string, readonly string[]>();
  const slotStages: WorkflowGraphStage[] = [];
  for (const map of maps) {
    const prefix = `${map.id}.`;
    const members = definition.stages.filter((stage) => stage.id === map.id || stage.id.startsWith(prefix));
    if (members.length === 0) continue;
    const slotIds = Array.from({ length: map.count }, (_, index) => `${map.id}.slot-${index}`);
    for (const member of members) slotByInternalId.set(member.id, slotIds);
    const active = snapshot?.current?.stageId?.startsWith(prefix) || snapshot?.current?.stageId === map.id;
    // visualStatus is a single value shared by every slot in this map — there
    // is no per-slot stageId to discriminate on at this layer. Terminal runs
    // (completed or paused) show all slots as completed; a failed run shows
    // all slots as failed when the map was active, pending otherwise; a live
    // run shows the active map's slots as running, others as pending.
    const snapshotStatus = snapshot?.status;
    const terminal = snapshotStatus === "completed" || snapshotStatus === "paused" || snapshotStatus === "cancelled";
    const visualStatus: WorkflowGraphNodeStatus = terminal
      ? "completed"
      : snapshotStatus === "failed" && active ? "failed"
        : active ? "running" : "pending";
    const entry = definition.stages.find((stage) => stage.id === map.entryStageId);
    const dependencies = entry?.dependsOn.flatMap((dependency) => slotByInternalId.get(dependency) ?? [dependency]) ?? [];
    for (const [index, id] of slotIds.entries()) {
      const label = mapSlotLabel(map, index);
      slotStages.push({
        id,
        displayId: label,
        label,
        dependsOn: dependencies,
        // Every slot runs the map's entry stage, so it shows that stage's model.
        model: entry?.model,
        // …and reports the work of its own branch, not of the whole map.
        lane: `${map.id}/slot-${index}`,
        visualStatus,
      });
    }
  }
  if (slotStages.length === 0) return definition;
  const stages = definition.stages
    .filter((stage) => !slotByInternalId.has(stage.id))
    .map((stage) => ({
      ...stage,
      dependsOn: stage.dependsOn.flatMap((dependency) => slotByInternalId.get(dependency) ?? [dependency]),
    }));
  return { stages: [...stages, ...slotStages] };
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;").replaceAll("'", "&apos;");
}

function clippedLabel(value: string, maxLength: number): string {
  const characters = [...value];
  return characters.length <= maxLength
    ? value
    : `${characters.slice(0, Math.max(1, maxLength - 1)).join("")}…`;
}

function wrapStageLabel(value: string, width: number): string[] {
  const characters = [...value];
  const lineWidth = Math.max(1, width);
  if (characters.length === 0) return [""];
  const lines: string[] = [];
  for (let offset = 0; offset < characters.length; offset += lineWidth) {
    lines.push(characters.slice(offset, offset + lineWidth).join(""));
  }
  return lines;
}

/** Split a stage label into its path prefix and leaf name, keeping the
 * duration suffix readable: the name gives up characters first. */
function labelParts(id: string, suffix = ""): { readonly prefix?: string; readonly label: string } {
  const separator = Math.max(id.lastIndexOf("."), id.lastIndexOf("/"));
  if (separator <= 0 || separator >= id.length - 1) {
    return { label: `${clippedLabel(id, Math.max(1, 19 - suffix.length))}${suffix}` };
  }
  return {
    prefix: clippedLabel(id.slice(0, separator), 21),
    label: `${clippedLabel(id.slice(separator + 1), Math.max(1, 17 - suffix.length))}${suffix}`,
  };
}

function layoutGraph(
  definition: WorkflowGraphDefinition,
  snapshot: WorkflowGraphSnapshot | undefined,
): { readonly width: number; readonly height: number; readonly nodes: readonly PositionedNode[] } {
  const depths = stageDepths(definition.stages);
  const layers = new Map<number, WorkflowGraphStage[]>();
  for (const stage of definition.stages) {
    const depth = depths.get(stage.id) ?? 0;
    const layer = layers.get(depth) ?? [];
    layer.push(stage);
    layers.set(depth, layer);
  }
  const maxDepth = Math.max(0, ...layers.keys());
  const maxRows = Math.max(1, ...[...layers.values()].map((layer) => layer.length));
  const contentHeight = maxRows * NODE_HEIGHT + (maxRows - 1) * ROW_GAP;
  const nodes: PositionedNode[] = [];
  for (const [depth, layer] of layers) {
    const layerHeight = layer.length * NODE_HEIGHT + (layer.length - 1) * ROW_GAP;
    const offsetY = PADDING_Y + (contentHeight - layerHeight) / 2;
    for (const [row, stage] of layer.entries()) {
      nodes.push({
        stage,
        status: nodeStatus(stage, snapshot),
        x: PADDING_X + depth * (NODE_WIDTH + LAYER_GAP),
        y: offsetY + row * (NODE_HEIGHT + ROW_GAP),
      });
    }
  }
  return {
    width: PADDING_X * 2 + NODE_WIDTH + maxDepth * (NODE_WIDTH + LAYER_GAP),
    height: PADDING_Y * 2 + contentHeight,
    nodes,
  };
}

function nodeColors(status: WorkflowGraphNodeStatus, palette: GraphPalette): {
  readonly fill: string; readonly stroke: string; readonly dot: string;
} {
  switch (status) {
    case "completed": return { fill: palette.completeFill, stroke: palette.completeStroke, dot: palette.completeDot };
    case "running": return { fill: "url(#running-fill)", stroke: palette.runningStroke, dot: palette.runningDot };
    case "failed": return { fill: palette.failedFill, stroke: palette.failedStroke, dot: palette.failedDot };
    case "pending": return { fill: palette.pendingFill, stroke: palette.pendingStroke, dot: palette.pendingDot };
  }
}

function statusIcon(node: PositionedNode, palette: GraphPalette, pulseOn: boolean): string {
  const cx = node.x + 21;
  const cy = node.y + NODE_HEIGHT / 2;
  if (node.status === "completed") {
    return `<circle cx="${cx}" cy="${cy}" r="10" fill="${palette.completeDot}"/>` +
      `<path d="M ${cx - 4.5} ${cy} l 3 3.2 l 6.3 -7" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (node.status === "failed") {
    return `<circle cx="${cx}" cy="${cy}" r="10" fill="${palette.failedDot}"/>` +
      `<path d="M ${cx - 3.5} ${cy - 3.5} l 7 7 M ${cx + 3.5} ${cy - 3.5} l -7 7" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>`;
  }
  if (node.status === "running") {
    const haloRadius = pulseOn ? 15 : 13;
    const haloOpacity = pulseOn ? 0.3 : 0.15;
    return `<circle cx="${cx}" cy="${cy}" r="${haloRadius}" fill="none" stroke="${palette.runningStroke}" stroke-width="2" opacity="${haloOpacity}"/>` +
      `<circle cx="${cx}" cy="${cy}" r="10" fill="${palette.runningDot}" opacity="0.16"/>` +
      `<path d="M ${cx} ${cy - 7} A 7 7 0 1 1 ${cx - 6.1} ${cy + 3.5}" fill="none" stroke="${palette.runningDot}" stroke-width="2.3" stroke-linecap="round"/>`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="4.5" fill="${palette.pendingDot}"/>`;
}

/** Text baselines inside the 58px pill. A stage model adds a third row, so the
 * prefix/label rows tighten to keep every row within the shape; nodes without a
 * model keep their original two-row placement. */
function nodeTextRows(
  labels: { readonly prefix?: string; readonly label: string },
  model: string | undefined,
): readonly { readonly dy: number; readonly className: string; readonly value: string }[] {
  const label = { className: "node-label", value: labels.label };
  const prefix = labels.prefix === undefined
    ? undefined
    : { className: "node-prefix", value: labels.prefix };
  if (model === undefined) {
    return prefix === undefined ? [{ dy: 35, ...label }] : [{ dy: 22, ...prefix }, { dy: 42, ...label }];
  }
  const modelRow = { className: "node-model", value: model };
  return prefix === undefined
    ? [{ dy: 29, ...label }, { dy: 45, ...modelRow }]
    : [{ dy: 18, ...prefix }, { dy: 34, ...label }, { dy: 50, ...modelRow }];
}

function renderNode(
  node: PositionedNode,
  palette: GraphPalette,
  pulseOn: boolean,
  snapshot: WorkflowGraphSnapshot | undefined,
  now: number,
): string {
  const colors = nodeColors(node.status, palette);
  const labels = labelParts(stageLabel(node.stage), stageTimeSuffix(node.stage, snapshot, now));
  // 19 characters at 10px stay clear of the pill's rounded right edge.
  const model = node.stage.model === undefined || node.stage.model === ""
    ? undefined
    : clippedLabel(node.stage.model, 19);
  const textX = node.x + 41;
  const text = nodeTextRows(labels, model)
    .map((row) => `<text x="${textX}" y="${node.y + row.dy}" class="${row.className}">${xml(row.value)}</text>`)
    .join("");
  const runningClass = node.status === "running" ? " running-node" : "";
  return `<g data-stage="${xml(stageDisplayId(node.stage))}" data-status="${node.status}" class="node${runningClass}">` +
    `<rect x="${node.x}" y="${node.y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="${NODE_HEIGHT / 2}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.5"/>` +
    statusIcon(node, palette, pulseOn) + text + "</g>";
}

function edgeColor(target: PositionedNode, source: PositionedNode, palette: GraphPalette): {
  readonly color: string; readonly marker: string; readonly opacity: number;
} {
  if (target.status === "failed") return { color: palette.failedStroke, marker: "failed-arrow", opacity: 0.9 };
  if (target.status === "running") return { color: palette.runningStroke, marker: "running-arrow", opacity: 0.9 };
  if (target.status === "completed" && source.status === "completed") {
    return { color: palette.completeStroke, marker: "complete-arrow", opacity: 0.72 };
  }
  return { color: palette.edge, marker: "pending-arrow", opacity: 0.64 };
}

/** Build the vector scene used by both terminal rendering and visual tests. */
export function renderWorkflowGraphSvg(
  definition: WorkflowGraphDefinition,
  snapshot: WorkflowGraphSnapshot | undefined,
  theme: PianoTheme,
  pulseOn = true,
  now = Date.now(),
): string {
  const display = displayDefinition(definition, snapshot);
  const { width, height, nodes } = layoutGraph(display, snapshot);
  const palette = graphPalette(theme);
  const byId = new Map(nodes.map((node) => [node.stage.id, node]));
  const edges = nodes.flatMap((target) => target.stage.dependsOn.flatMap((dependency) => {
    const source = byId.get(dependency);
    if (source === undefined) return [];
    const startX = source.x + NODE_WIDTH;
    const startY = source.y + NODE_HEIGHT / 2;
    const endX = target.x - 7;
    const endY = target.y + NODE_HEIGHT / 2;
    const bend = Math.max(28, Math.abs(endX - startX) * 0.48);
    const colors = edgeColor(target, source, palette);
    const path = `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
    return [`<path data-from="${xml(stageDisplayId(source.stage))}" data-to="${xml(stageDisplayId(target.stage))}" d="${path}" fill="none" stroke="${colors.color}" stroke-width="2" stroke-linecap="round" opacity="${colors.opacity}" marker-end="url(#${colors.marker})"/>`];
  }));
  const marker = (id: string, color: string): string =>
    `<marker id="${id}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8 z" fill="${color}"/></marker>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs>` +
    `<linearGradient id="backdrop" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.backdrop}"/><stop offset="1" stop-color="${palette.pendingFill}"/></linearGradient>` +
    `<linearGradient id="running-fill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.runningFillStart}"/><stop offset="1" stop-color="${palette.runningFillEnd}"/></linearGradient>` +
    `<filter id="shadow" x="-30%" y="-50%" width="160%" height="200%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000000" flood-opacity="0.24"/></filter>` +
    `<filter id="active-glow" x="-45%" y="-80%" width="190%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="${pulseOn ? 8 : 5}" flood-color="${palette.runningStroke}" flood-opacity="${pulseOn ? 0.34 : 0.2}"/></filter>` +
    marker("pending-arrow", palette.edge) + marker("complete-arrow", palette.completeStroke) +
    marker("running-arrow", palette.runningStroke) + marker("failed-arrow", palette.failedStroke) +
    `<style>.node{filter:url(#shadow)}.running-node{filter:url(#active-glow)}.node-label{fill:${palette.text};font:600 15px Inter,Segoe UI,sans-serif;letter-spacing:.1px}.node-prefix{fill:${palette.secondaryText};font:500 10px Inter,Segoe UI,sans-serif;letter-spacing:.35px}.node-model{fill:${palette.modelText};font:500 10px Inter,Segoe UI,sans-serif;letter-spacing:.35px}.running-node .node-label{fill:#ffffff}.running-node .node-prefix{fill:#f6d9de}.running-node .node-model{fill:#cfe3f5}</style>` +
    `</defs>` +
    `<rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="20" fill="url(#backdrop)" stroke="${palette.backdropStroke}" stroke-width="1.5"/>` +
    `<g class="edges">${edges.join("")}</g>` +
    `<g class="nodes">${nodes.map((node) => renderNode(node, palette, pulseOn, snapshot, now)).join("")}</g>` +
    `</svg>`;
}

/** Rasterize the exact scene sent to image-capable terminals. */
export function renderWorkflowGraphPng(
  definition: WorkflowGraphDefinition,
  snapshot: WorkflowGraphSnapshot | undefined,
  theme: PianoTheme,
  pulseOn = true,
): Buffer {
  const layout = layoutGraph(displayDefinition(definition, snapshot), snapshot);
  const scale = Math.min(1, MAX_RASTER_WIDTH / layout.width, MAX_RASTER_HEIGHT / layout.height);
  return new Resvg(renderWorkflowGraphSvg(definition, snapshot, theme, pulseOn), {
    fitTo: { mode: "zoom", value: scale }, shapeRendering: 2, textRendering: 1,
  }).render().asPng();
}

/** Read-only workflow visualization owned by the footer's STATUS section. */
export class WorkflowGraph implements Component {
  private snapshot: WorkflowGraphSnapshot | undefined;
  private refreshInFlight: Promise<void> | undefined;
  private disposed = false;
  private pulseOn = true;
  private image: Image | undefined;
  private imageKey: string | undefined;
  private readonly pngFrames = new Map<string, string>();
  private readonly imageId = allocateImageId();

  constructor(
    private definition: WorkflowGraphDefinition,
    private readonly readSnapshot: WorkflowGraphSnapshotReader,
    private readonly theme: PianoTheme,
    private readonly onSnapshot: () => void = () => {},
  ) {}

  setDefinition(definition: WorkflowGraphDefinition): void {
    this.definition = definition;
    this.snapshot = undefined;
    this.image = undefined;
    this.imageKey = undefined;
    this.pngFrames.clear();
    this.invalidate();
  }

  /** Refresh outside render. Concurrent heartbeat ticks share one read, and an
   * invalid/partial read leaves the last valid frame intact. */
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.refreshInFlight !== undefined) return this.refreshInFlight;
    const request = Promise.resolve().then(() => this.readSnapshot()).then((snapshot) => {
      if (this.disposed || snapshot === undefined) return;
      this.snapshot = snapshot;
      this.invalidate();
      this.onSnapshot();
    }).catch(() => undefined).finally(() => {
      this.refreshInFlight = undefined;
    });
    this.refreshInFlight = request;
    return request;
  }

  setBlink(on: boolean): void {
    if (this.pulseOn === on) return;
    this.pulseOn = on;
    this.invalidate();
  }

  toggleBlink(): void {
    this.setBlink(!this.pulseOn);
  }

  summary(): string {
    const { name, path } = this.definition;
    const identity = [name, path].filter((value): value is string => value !== undefined && value !== "").join(" ");
    return `${this.theme.primary}${identity}${RST}`;
  }

  dispose(): void {
    this.disposed = true;
    this.image = undefined;
    this.pngFrames.clear();
  }

  invalidate(): void {
    // The render key includes every visual input. Keeping the previous image
    // here avoids rasterizing an unchanged snapshot on each filesystem poll.
  }

  render(width: number): string[] {
    const totalWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
    if (totalWidth < MIN_IMAGE_COLUMNS || this.definition.stages.length === 0) {
      return [];
    }
    if (getCapabilities().images === null) {
      if (detectSixelSupport()) {
        try {
          const png = renderWorkflowGraphPng(this.definition, this.snapshot, this.theme, this.pulseOn);
          return [encodeSixelPng(png, Math.max(1, (totalWidth - 2) * 9), MAX_IMAGE_ROWS * 18)];
        } catch {
          // A malformed/unsupported raster must fall back to ordinary TUI text.
        }
      }
      return renderWorkflowGraphLineDag(this.definition, this.snapshot, this.theme, totalWidth, this.pulseOn);
    }
    // The blink pulse already varies this key twice per second, so a running
    // stage's ticking counter is redrawn without extra invalidation.
    const frameKey = `${this.pulseOn ? 1 : 0}:${JSON.stringify(this.snapshot)}`;
    const imageKey = `${totalWidth}:${frameKey}`;
    if (this.image === undefined || this.imageKey !== imageKey) {
      try {
        let png = this.pngFrames.get(frameKey);
        if (png === undefined) {
          png = renderWorkflowGraphPng(this.definition, this.snapshot, this.theme, this.pulseOn).toString("base64");
          if (this.pngFrames.size >= 4) {
            const oldest = this.pngFrames.keys().next().value as string | undefined;
            if (oldest !== undefined) this.pngFrames.delete(oldest);
          }
          this.pngFrames.set(frameKey, png);
        }
        this.image = new Image(png, "image/png", {
          fallbackColor: (value) => `${this.theme.dim}${value}${RST}`,
        }, {
          maxWidthCells: Math.max(1, totalWidth - 2),
          maxHeightCells: MAX_IMAGE_ROWS,
          filename: "workflow-dag.png",
          imageId: this.imageId,
        });
        this.imageKey = imageKey;
      } catch {
        this.image = undefined;
        this.imageKey = undefined;
        return [];
      }
    }
    return this.image.render(totalWidth);
  }
}
