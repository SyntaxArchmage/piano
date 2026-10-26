const PALETTE = [
  "#6c9cff", "#f08a4b", "#4cc38a", "#e66a9c", "#a78bfa",
  "#e0b341", "#4bb8c9", "#d46a5e", "#8fa94a", "#b98af0",
];

// The incumbent curve is the story; lane colors are provenance, so they are
// always drawn faintly and the best-so-far step line is drawn last, in a
// neutral color that reads the same in non-tournament and tournament runs.
const CORE_COLOR = "#e8eef8";
const CORE_AREA = "rgba(232, 238, 248, 0.055)";

const state = {
  runs: [],
  runId: null,
  data: null,
  metricKey: null,
  xMode: "time",
  hidden: new Set(),
  zoom: null,
  paused: false,
  layout: null,
  hoverRing: null,
  hover: null,
  lastUpdated: null,
  timer: null,
};

const $ = (selector) => document.querySelector(selector);
const NS = "http://www.w3.org/2000/svg";

function appendChildren(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  appendChildren(node, children);
  return node;
}

function s(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  return node;
}

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

function fmtNumber(value) {
  return Number.isFinite(value) ? numberFormat.format(value) : "—";
}

function fmtCompact(value) {
  return Number.isFinite(value) ? compactFormat.format(value) : "—";
}

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

function fmtClock(ms) {
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtTimestamp(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : String(value ?? "—");
}

function unitSuffix(unit) {
  return unit ? ` ${unit}` : "";
}

async function api(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

// ── data selection ─────────────────────────────────────────────────────────

function records() {
  const data = state.data;
  if (data === null) return [];
  return [...(data.records?.benchmark ?? []), ...(data.records?.derived ?? [])];
}

function plottable() {
  return records().filter((record) => record?.metric !== undefined && Number.isFinite(record.metric.best));
}

function metricKey(metric) {
  return `${metric?.name ?? ""}|${metric?.unit ?? ""}`;
}

function metricList() {
  const map = new Map();
  for (const record of plottable()) {
    const metric = record.metric;
    const key = metricKey(metric);
    const entry = map.get(key);
    if (entry === undefined) {
      map.set(key, {
        key,
        name: metric.name,
        unit: metric.unit ?? "",
        direction: metric.direction === "lower" ? "lower" : "higher",
        count: 1,
        derived: record.source === "result",
      });
    } else {
      entry.count += 1;
      if (record.source !== "result") entry.derived = false;
    }
  }
  return [...map.values()].sort((a, b) => Number(a.derived) - Number(b.derived) || a.name.localeCompare(b.name));
}

function currentMetric() {
  return metricList().find((metric) => metric.key === state.metricKey);
}

function xOf(point) {
  return state.xMode === "iteration" && point.iter !== null ? point.iter : point.t;
}

function buildAllSeries() {
  const metric = currentMetric();
  if (metric === undefined) return [];
  const groups = new Map();
  for (const record of plottable()) {
    if (metricKey(record.metric) !== metric.key) continue;
    const lane = Number.isInteger(record.mapSlot) ? record.mapSlot : null;
    const key = lane === null ? "run" : `lane-${lane}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        key,
        lane,
        label: lane === null ? "all lanes" : `lane ${lane}`,
        color: PALETTE[(lane ?? 0) % PALETTE.length],
        points: [],
      };
      groups.set(key, group);
    }
    const parsed = Date.parse(record.timestamp);
    group.points.push({
      t: Number.isFinite(parsed) ? parsed : 0,
      iter: Number.isInteger(record.iteration) ? record.iteration : null,
      value: record.metric.best,
      record,
    });
  }
  const series = [...groups.values()].sort((a, b) => (a.lane ?? -1) - (b.lane ?? -1));
  for (const item of series) {
    item.points.sort((a, b) => xOf(a) - xOf(b) || a.t - b.t);
    item.points.forEach((point, index) => {
      point.prev = index > 0 ? item.points[index - 1].value : undefined;
    });
  }
  return series;
}

function harnessOf(record) {
  const harnesses = state.data?.status?.harnesses ?? {};
  if (record.actorKey && harnesses[record.actorKey]) return harnesses[record.actorKey];
  const parts = String(record.actorKey ?? "").split("/").filter(Boolean);
  if (parts[0] === "v2") return parts[2] ?? "unknown";
  return parts[1] ?? "unknown";
}

// ── controls ───────────────────────────────────────────────────────────────

function syncControls() {
  const metrics = metricList();
  const picker = $("#metric-picker");
  const previous = state.metricKey;
  if (!metrics.some((metric) => metric.key === previous)) {
    state.metricKey = metrics[0]?.key ?? null;
  }
  picker.replaceChildren(...metrics.map((metric) => h(
    "option",
    { value: metric.key },
    `${metric.name}${metric.unit ? ` (${metric.unit})` : ""}${metric.derived ? " · derived" : ""}`,
  )));
  if (state.metricKey !== null) picker.value = state.metricKey;

  const metric = currentMetric();
  const canIterate = metric !== undefined &&
    plottable()
      .filter((record) => metricKey(record.metric) === metric.key)
      .every((record) => Number.isInteger(record.iteration));
  const iterationOption = $("#xmode").querySelector('option[value="iteration"]');
  iterationOption.disabled = !canIterate;
  if (!canIterate && state.xMode === "iteration") state.xMode = "time";
  $("#xmode").value = state.xMode;

  $("#metric-sub").textContent = metric === undefined
    ? "no metric records yet"
    : `${metric.unit || "value"} · ${metric.direction === "higher" ? "higher is better" : "lower is better"} · ${metric.count} measurement${metric.count === 1 ? "" : "s"}${metric.derived ? " · derived from result JSON" : ""}`;
}

function bindControls() {
  $("#run-picker").addEventListener("change", (event) => {
    void selectRun(event.target.value).catch(showError);
  });
  $("#pause").addEventListener("click", () => {
    state.paused = !state.paused;
    $("#pause").textContent = state.paused ? "Resume" : "Pause";
    $("#live").classList.toggle("paused", state.paused);
    $("#live").replaceChildren(h("i"), state.paused ? " paused" : " live");
    if (!state.paused) void refreshRun();
  });
  $("#metric-picker").addEventListener("change", (event) => {
    state.metricKey = event.target.value;
    state.zoom = null;
    render();
  });
  $("#xmode").addEventListener("change", (event) => {
    state.xMode = event.target.value;
    state.zoom = null;
    render();
  });
  $("#reset-zoom").addEventListener("click", () => {
    state.zoom = null;
    drawChart();
  });

  const chart = $("#chart");
  chart.addEventListener("wheel", (event) => {
    if (state.layout === null) return;
    event.preventDefault();
    const rect = chart.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const zoom = state.zoom ?? { a: 0, b: 1 };
    const span = zoom.b - zoom.a;
    const nextSpan = Math.min(1, Math.max(0.02, span * (event.deltaY > 0 ? 1.25 : 0.8)));
    const anchor = zoom.a + span * fraction;
    let a = anchor - nextSpan * fraction;
    let b = a + nextSpan;
    if (a < 0) { a = 0; b = nextSpan; }
    if (b > 1) { b = 1; a = 1 - nextSpan; }
    state.zoom = { a, b };
    drawChart();
  }, { passive: false });

  let drag = null;
  chart.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, zoom: state.zoom ?? { a: 0, b: 1 }, moved: false };
    chart.setPointerCapture(event.pointerId);
    chart.classList.add("dragging");
  });
  chart.addEventListener("pointermove", (event) => {
    if (drag !== null) {
      const rect = chart.getBoundingClientRect();
      const delta = (event.clientX - drag.x) / rect.width;
      if (Math.abs(event.clientX - drag.x) > 3) drag.moved = true;
      const span = drag.zoom.b - drag.zoom.a;
      let a = drag.zoom.a - delta * span;
      a = Math.min(1 - span, Math.max(0, a));
      state.zoom = { a, b: a + span };
      drawChart();
      return;
    }
    onPointerMove(event);
  });
  const endDrag = () => {
    drag = null;
    chart.classList.remove("dragging");
  };
  chart.addEventListener("pointerup", endDrag);
  chart.addEventListener("pointercancel", endDrag);
  chart.addEventListener("pointerleave", () => {
    if (drag === null) hideTooltip();
  });
  chart.addEventListener("dblclick", () => {
    state.zoom = null;
    drawChart();
  });

  const observer = new ResizeObserver(() => {
    if (state.data !== null) requestAnimationFrame(drawChart);
  });
  observer.observe($("#chart-wrap"));
}

// ── chart ──────────────────────────────────────────────────────────────────

function niceTicks(min, max, count = 5) {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let value = start; value <= max + step * 1e-9; value += step) {
    ticks.push(Number(value.toFixed(12)));
  }
  return ticks;
}

function integerTicks(min, max) {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  if (high < low) return [];
  const step = Math.max(1, Math.ceil((high - low) / 6));
  const ticks = [];
  for (let value = low; value <= high; value += step) ticks.push(value);
  if (ticks[ticks.length - 1] !== high) ticks.push(high);
  return ticks;
}

/** Step-after path: a measured value holds until the next measurement. Tuning
 * curves are not straight-line interpolations, so every series uses this. */
function stepPath(points) {
  if (points.length === 0) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    path += ` L ${current.x} ${previous.y} L ${current.x} ${current.y}`;
  }
  return path;
}

/** The incumbent over time, across every lane (including ones the legend has
 * hidden). The line holds flat between improvements and extends to the last
 * measurement, so it reads as the run's best result rather than as a lane. */
function buildBestSteps(metric) {
  const points = [];
  for (const record of plottable()) {
    if (metricKey(record.metric) !== metric.key) continue;
    const parsed = Date.parse(record.timestamp);
    const t = Number.isFinite(parsed) ? parsed : 0;
    const iter = Number.isInteger(record.iteration) ? record.iteration : null;
    points.push({ x: xOf({ t, iter }), t, iter, value: record.metric.best, record });
  }
  points.sort((a, b) => a.x - b.x || a.t - b.t);
  const steps = [];
  let best;
  let previous;
  let bestRecord;
  for (const point of points) {
    const improved = best === undefined || (metric.direction === "higher" ? point.value > best : point.value < best);
    if (!improved) continue;
    previous = best;
    best = point.value;
    bestRecord = point.record;
    steps.push({ ...point, value: best, prev: previous });
  }
  const last = points.at(-1);
  if (last !== undefined && steps.length > 0 && last.x > steps.at(-1).x) {
    steps.push({ ...last, value: best, prev: undefined, record: bestRecord, extended: true });
  }
  return steps;
}

function drawChart() {
  const chart = $("#chart");
  const wrap = $("#chart-wrap");
  const width = Math.max(320, wrap.clientWidth);
  const height = Math.max(280, chart.clientHeight || 400);
  chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
  chart.replaceChildren();
  state.layout = null;
  state.hoverRing = null;

  const empty = $("#chart-empty");
  const metric = currentMetric();
  if (metric === undefined) {
    empty.textContent = "No benchmark metric yet. The dashboard reads eval-metrics/benchmark.jsonl; tuning workers that declare outputs.metrics feed it. Workflows whose contract only projects performance fields are read from results/*.json.";
    empty.classList.remove("hidden");
    return;
  }
  const allSeries = buildAllSeries();
  const visibleSeries = allSeries.filter((series) => !state.hidden.has(series.key));
  const allPoints = allSeries.flatMap((series) => series.points.map((point) => ({ series, point })));
  if (allPoints.length === 0) {
    empty.textContent = `No measurements for ${metric.name} yet. They appear as stages are accepted.`;
    empty.classList.remove("hidden");
    return;
  }
  const bestSteps = buildBestSteps(metric);
  empty.classList.add("hidden");

  const xValues = allPoints.map((item) => xOf(item.point));
  let x0 = Math.min(...xValues);
  let x1 = Math.max(...xValues);
  if (!(x1 > x0)) {
    const pad = state.xMode === "iteration" ? 0.5 : 60_000;
    x0 -= pad;
    x1 += pad;
  }
  if (state.zoom !== null) {
    const span = x1 - x0;
    const a = x0 + span * state.zoom.a;
    const b = x0 + span * state.zoom.b;
    x0 = a;
    x1 = b;
  }
  const inWindow = (value) => value >= x0 && value <= x1;
  const visibleInView = allPoints.filter((item) => !state.hidden.has(item.series.key) && inWindow(xOf(item.point)));
  const inViewBest = bestSteps.filter((step) => inWindow(step.x));
  if (visibleInView.length === 0 && inViewBest.length === 0) {
    empty.textContent = "No points in this zoom window — double-click the chart to reset.";
    empty.classList.remove("hidden");
    return;
  }

  const values = [
    ...visibleInView.map((item) => item.point.value),
    ...inViewBest.map((step) => step.value),
  ];
  let y0 = Math.min(...values);
  let y1 = Math.max(...values);
  if (y1 === y0) {
    const pad = Math.abs(y0) * 0.05 || 1;
    y0 -= pad;
    y1 += pad;
  } else {
    const pad = (y1 - y0) * 0.08;
    y0 -= pad;
    y1 += pad;
  }

  const margin = { left: 66, right: 22, top: 18, bottom: 38 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const sx = (value) => margin.left + ((value - x0) / (x1 - x0)) * plotWidth;
  const sy = (value) => margin.top + (1 - (value - y0) / (y1 - y0)) * plotHeight;

  const gridColor = "#232b38";
  const labelColor = "#8c97a8";

  // Y grid and labels.
  for (const tick of niceTicks(y0, y1, 5)) {
    const y = sy(tick);
    chart.append(s("line", { x1: margin.left, x2: width - margin.right, y1: y, y2: y, stroke: gridColor, "stroke-width": 1 }));
    const label = s("text", { x: margin.left - 9, y: y + 4, "text-anchor": "end", fill: labelColor, "font-size": 11 });
    label.textContent = fmtCompact(tick);
    chart.append(label);
  }

  // X grid and labels.
  const xTicks = state.xMode === "iteration"
    ? integerTicks(x0, x1)
    : niceTicks(x0, x1, 6);
  const spanMs = x1 - x0;
  for (const tick of xTicks) {
    const x = sx(tick);
    chart.append(s("line", { x1: x, x2: x, y1: margin.top, y2: height - margin.bottom, stroke: gridColor, "stroke-width": 1 }));
    const label = s("text", { x, y: height - margin.bottom + 18, "text-anchor": "middle", fill: labelColor, "font-size": 11 });
    label.textContent = state.xMode === "iteration"
      ? `iter ${tick}`
      : spanMs > 86_400_000
        ? new Date(tick).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : fmtClock(tick);
    chart.append(label);
  }

  // Faint area under the incumbent, then lane provenance, then the incumbent
  // step line on top. Lanes are context; the best-so-far line is the result.
  const corePoints = inViewBest.map((step) => ({ x: sx(step.x), y: sy(step.value) }));
  if (corePoints.length > 1) {
    const path = stepPath(corePoints);
    const area = `${path} L ${corePoints.at(-1).x} ${height - margin.bottom} L ${corePoints[0].x} ${height - margin.bottom} Z`;
    chart.append(s("path", { d: area, fill: CORE_AREA, stroke: "none" }));
  }

  const dense = visibleInView.length > 700;
  const layoutPoints = [];
  // Core points are first so a tie in hit-testing reports the incumbent.
  for (const step of inViewBest) {
    layoutPoints.push({
      point: step,
      series: { key: "best-so-far", label: "best so far", color: CORE_COLOR },
      px: sx(step.x),
      py: sy(step.value),
    });
  }

  for (const series of visibleSeries) {
    const points = series.points.filter((point) => inWindow(xOf(point)));
    if (points.length === 0) continue;
    if (points.length > 1) {
      const path = stepPath(points.map((point) => ({ x: sx(xOf(point)), y: sy(point.value) })));
      chart.append(s("path", {
        d: path,
        fill: "none",
        stroke: series.color,
        "stroke-width": 1.6,
        "stroke-opacity": 0.58,
        "stroke-dasharray": "5 4",
        "stroke-linejoin": "round",
        "data-role": "lane-trace",
      }));
    }
    for (const point of points) {
      const failed = /FAIL|DISCARD|BLOCKED/.test(String(point.record.decision ?? ""));
      const circle = s("circle", {
        cx: sx(xOf(point)),
        cy: sy(point.value),
        r: dense ? 2 : 2.6,
        fill: failed ? "#141922" : series.color,
        stroke: series.color,
        "stroke-width": failed ? 1.2 : 0,
        "fill-opacity": 0.68,
        "stroke-opacity": 0.68,
      });
      chart.append(circle);
      layoutPoints.push({ point, series, px: sx(xOf(point)), py: sy(point.value) });
    }
  }

  // Incumbent step line, drawn last and identical in both modes.
  if (corePoints.length > 0) {
    if (corePoints.length > 1) {
      chart.append(s("path", {
        d: stepPath(corePoints),
        fill: "none",
        stroke: CORE_COLOR,
        "stroke-width": 2.6,
        "stroke-linejoin": "round",
        "data-role": "best-so-far",
      }));
    }
    const last = inViewBest.at(-1);
    chart.append(s("circle", {
      cx: sx(last.x),
      cy: sy(last.value),
      r: 4,
      fill: CORE_COLOR,
      stroke: "#0d1016",
      "stroke-width": 1.5,
      "data-role": "best-so-far-point",
    }));
    const label = s("text", {
      x: sx(last.x) + 8,
      y: sy(last.value) - 9,
      fill: CORE_COLOR,
      "font-size": 11,
      "font-weight": 600,
    });
    label.textContent = `${fmtNumber(last.value)}${unitSuffix(metric.unit)}`;
    if (sx(last.x) > width - margin.right - 96) {
      label.setAttribute("x", String(sx(last.x) - 8));
      label.setAttribute("text-anchor", "end");
    }
    chart.append(label);
  }

  state.hoverRing = s("circle", { r: 6, fill: "none", stroke: "#ffffff", "stroke-width": 1.5, opacity: 0, "pointer-events": "none" });
  chart.append(state.hoverRing);
  state.layout = { width, height, margin, plotWidth, plotHeight, x0, x1, y0, y1, sx, sy, points: layoutPoints, metric };
}

function onPointerMove(event) {
  const layout = state.layout;
  if (layout === null) return;
  const chart = $("#chart");
  const rect = chart.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (layout.width / rect.width);
  const y = (event.clientY - rect.top) * (layout.height / rect.height);
  let nearest;
  let nearestDistance = 26;
  for (const item of layout.points) {
    const distance = Math.hypot(item.px - x, item.py - y);
    if (distance < nearestDistance) {
      nearest = item;
      nearestDistance = distance;
    }
  }
  if (nearest === undefined) {
    hideTooltip();
    return;
  }
  state.hover = nearest;
  const ring = state.hoverRing;
  if (ring !== null) {
    ring.setAttribute("cx", nearest.px);
    ring.setAttribute("cy", nearest.py);
    ring.setAttribute("stroke", nearest.series.color);
    ring.setAttribute("opacity", "1");
  }
  showTooltip(nearest, event, layout.metric);
}

function hideTooltip() {
  $("#tooltip").classList.add("hidden");
  state.hover = null;
  if (state.hoverRing !== null) state.hoverRing.setAttribute("opacity", "0");
}

function deltaText(delta, direction) {
  const good = direction === "lower" ? delta < 0 : delta > 0;
  const sign = delta > 0 ? "+" : "";
  return h("span", { class: good ? "delta-good" : "delta-bad" }, `${sign}${fmtNumber(delta)}`);
}

function tooltipRow(label, value) {
  return h("div", { class: "t-row" }, h("span", {}, label), h("b", {}, value));
}

function shortCommit(commit) {
  return commit.slice(0, 8);
}

function tooltipLink(url, text, title) {
  return h("a", { href: url, target: "_blank", rel: "noreferrer noopener", title }, text);
}

/** Prefer the point's workspace evidence. Only when it has none does the
 * run's workflow repository apply, and that fallback is labelled as such so a
 * lane point is never mistaken for the current checkout. */
function gitContext(record) {
  const local = record?.git;
  if (local !== undefined && (local.branch !== undefined || local.commit !== undefined)) {
    return { ...local, fallback: false };
  }
  const repository = state.data?.repository;
  if (repository !== undefined && (repository.branch !== undefined || repository.commit !== undefined)) {
    return { ...repository, commitKind: "repo", fallback: true };
  }
  return undefined;
}

function commitLabel(kind) {
  return kind === "iteration" ? "Commit" : kind === "base" ? "Commit (base)" : "Commit (repo HEAD)";
}

function showTooltip(item, event, metric) {
  const tooltip = $("#tooltip");
  const wrap = $("#chart-wrap");
  const point = item.point;
  const record = point.record;
  const git = gitContext(record);
  const rows = [
    h("div", { class: "t-title" }, h("span", { class: "dot", style: `background:${item.series.color}` }), item.series.label),
    tooltipRow("Value", `${fmtNumber(point.value)}${unitSuffix(metric.unit)}`),
    point.iter !== null ? tooltipRow("Iteration", point.iter) : null,
    tooltipRow("Time", fmtTimestamp(record.timestamp)),
    point.prev !== undefined ? tooltipRow("Δ prev", deltaText(point.value - point.prev, metric.direction)) : null,
    Number.isFinite(record.metric.median) && record.metric.median !== point.value ? tooltipRow("Median", fmtNumber(record.metric.median)) : null,
    git?.branch !== undefined
      ? tooltipRow(
        git.fallback ? "Branch (repo)" : "Branch",
        git.branchUrl === undefined ? git.branch : tooltipLink(git.branchUrl, git.branch, `open branch ${git.branch}`),
      )
      : null,
    git?.commit !== undefined
      ? tooltipRow(
        commitLabel(git.commitKind),
        git.commitUrl === undefined
          ? shortCommit(git.commit)
          : tooltipLink(git.commitUrl, shortCommit(git.commit), `open commit ${git.commit}`),
      )
      : null,
    record.decision !== undefined ? tooltipRow("Decision", record.decision) : null,
    record.stage !== undefined ? tooltipRow("Stage", record.stage) : null,
    record.source === "result" ? tooltipRow("Source", "result JSON") : null,
  ].filter((row) => row !== null && row !== undefined);
  tooltip.replaceChildren(...rows);
  tooltip.classList.remove("hidden");
  const wrapRect = wrap.getBoundingClientRect();
  let left = event.clientX - wrapRect.left + 14;
  let top = event.clientY - wrapRect.top + 14;
  const maxLeft = wrapRect.width - tooltip.offsetWidth - 8;
  const maxTop = wrapRect.height - tooltip.offsetHeight - 8;
  if (left > maxLeft) left = Math.max(8, event.clientX - wrapRect.left - tooltip.offsetWidth - 14);
  if (top > maxTop) top = Math.max(8, event.clientY - wrapRect.top - tooltip.offsetHeight - 14);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

// ── panels ─────────────────────────────────────────────────────────────────

function tokenTotals() {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  for (const record of state.data?.records?.tokenUsage ?? []) {
    const delta = record?.delta;
    if (delta === undefined || delta === null) continue;
    for (const key of Object.keys(totals)) totals[key] += Number(delta[key]) || 0;
  }
  return totals;
}

function tokenByHarness() {
  const map = new Map();
  for (const record of state.data?.records?.tokenUsage ?? []) {
    const harness = harnessOf(record);
    const delta = record?.delta ?? {};
    const entry = map.get(harness) ?? { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    entry.total += Number(delta.total) || 0;
    entry.input += Number(delta.input) || 0;
    entry.output += Number(delta.output) || 0;
    entry.cacheRead += Number(delta.cacheRead) || 0;
    entry.cacheWrite += Number(delta.cacheWrite) || 0;
    map.set(harness, entry);
  }
  return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
}

function card(label, value, extra) {
  return h("div", { class: "card" },
    h("div", { class: "label" }, label),
    h("div", { class: "value" }, value),
    extra === undefined ? null : h("div", { class: "extra" }, extra));
}

function statusBadge(status) {
  const known = ["running", "paused", "completed", "failed", "cancelled"];
  const name = known.includes(status) ? status : "unknown";
  return h("span", { class: `badge ${name}` }, status ?? "unknown");
}

function progressBar(ratio) {
  const percent = Math.max(0, Math.min(100, ratio * 100));
  return h("div", { class: "bar" }, h("span", { style: `width:${percent}%` }));
}

function currentStage(current) {
  if (current === null || current === undefined) return "—";
  const parts = [current.stage ?? current.stageId ?? "—"];
  const detail = [current.instanceId, current.attempt !== undefined ? `attempt ${current.attempt}` : undefined]
    .filter(Boolean)
    .join(" · ");
  return h("span", {}, parts[0], detail ? h("div", { class: "extra" }, detail) : null);
}

function renderCards() {
  const status = state.data?.status ?? {};
  const start = earliestTimestamp();
  const terminal = ["completed", "failed", "paused", "cancelled"].includes(status.status);
  const end = terminal ? Date.parse(status.updatedAt) : Date.now();
  const elapsed = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : undefined;
  const totals = tokenTotals();
  const harnesses = [...new Set(Object.values(status.harnesses ?? {}))];
  $("#cards").replaceChildren(
    card("Status", statusBadge(status.status), status.error),
    card("Progress", `${status.completedStages ?? 0} / ${status.plannedStages ?? 0}`,
      progressBar((status.completedStages ?? 0) / (status.plannedStages || 1))),
    card("Current", currentStage(status.current), status.workflowName),
    card("Elapsed", fmtDuration(elapsed), status.mnemonic),
    card("Tokens", fmtCompact(totals.total),
      `in ${fmtCompact(totals.input)} · out ${fmtCompact(totals.output)} · cache ${fmtCompact(totals.cacheRead + totals.cacheWrite)}`),
    card("Harnesses", harnesses.length === 0 ? "—" : h("span", { class: "chips" }, ...harnesses.map((name) => h("span", { class: "chip" }, name)))),
  );
}

function renderLegend() {
  const legend = $("#legend");
  const series = buildAllSeries();
  if (series.length === 0) {
    legend.replaceChildren();
    return;
  }
  const chips = [
    h("span", { class: "legend-chip primary", style: "cursor:default" }, h("span", { class: "core-line" }), "best so far · step"),
    ...series.map((item) => h("button", {
      type: "button",
      class: `legend-chip lane${state.hidden.has(item.key) ? " hidden" : ""}`,
      title: `${item.points.length} measurement${item.points.length === 1 ? "" : "s"} · click to hide lane`,
      onclick: () => {
        if (state.hidden.has(item.key)) state.hidden.delete(item.key);
        else state.hidden.add(item.key);
        drawChart();
        renderLegend();
      },
    }, h("span", { class: "swatch", style: `background:${item.color}` }), item.label)),
  ];
  legend.replaceChildren(...chips);
}

function renderMeasurements() {
  const table = $("#measure-table");
  const metric = currentMetric();
  if (metric === undefined) {
    table.replaceChildren(h("tbody", {}, h("tr", {}, h("td", { class: "muted" }, "No measurements yet."))));
    return;
  }
  const items = [];
  for (const series of buildAllSeries()) {
    for (const point of series.points) items.push({ series, point });
  }
  items.sort((a, b) => b.point.t - a.point.t);
  const rows = items.slice(0, 30).map(({ series, point }) => {
    const record = point.record;
    return h("tr", {},
      h("td", {}, fmtClock(point.t)),
      h("td", { class: "num" }, point.iter === null ? "—" : point.iter),
      h("td", {}, h("span", { class: "dot", style: `background:${series.color}` }), series.label),
      h("td", { class: "num" }, fmtNumber(point.value)),
      h("td", { class: "num" }, point.prev === undefined ? "—" : deltaText(point.value - point.prev, metric.direction)),
      h("td", { class: "num" }, record.metric.runs ?? record.metric.samples?.length ?? "—"),
      h("td", {}, record.decision ?? (record.source === "result" ? "derived" : "—")),
    );
  });
  table.replaceChildren(
    h("thead", {}, h("tr", {},
      h("th", {}, "Time"),
      h("th", { class: "num" }, "Iter"),
      h("th", {}, "Lane"),
      h("th", { class: "num" }, `Value${unitSuffix(metric.unit)}`),
      h("th", { class: "num" }, "Δ prev"),
      h("th", { class: "num" }, "Samples"),
      h("th", {}, "Decision"),
    )),
    h("tbody", {}, ...(rows.length === 0 ? [h("tr", {}, h("td", { class: "muted", colspan: 7 }, "No measurements yet."))] : rows)),
  );
}

function renderStages() {
  const table = $("#stage-table");
  const map = new Map();
  for (const record of state.data?.records?.duration ?? []) {
    const id = record.stageId ?? record.stage;
    if (id === undefined) continue;
    const entry = map.get(id) ?? { stage: id, count: 0, total: 0, max: 0, accepted: 0, failed: 0 };
    entry.count += 1;
    entry.total += Number(record.durationMs) || 0;
    entry.max = Math.max(entry.max, Number(record.durationMs) || 0);
    if (record.outcome === "accepted") entry.accepted += 1;
    else entry.failed += 1;
    map.set(id, entry);
  }
  let rows = [...map.values()].sort((a, b) => b.total - a.total);
  let headers;
  if (rows.length === 0) {
    const invocationTime = state.data?.status?.invocationTime ?? {};
    rows = Object.entries(invocationTime).map(([invocationId, value]) => ({
      stage: value?.stageId ?? invocationId,
      count: 1,
      total: Number(value?.completedMs) || 0,
      max: Number(value?.completedMs) || 0,
      accepted: 1,
      failed: 0,
      fallback: true,
    })).sort((a, b) => b.total - a.total);
    headers = ["Stage", "Attempts", "Total", "Accepted"];
  } else {
    headers = ["Stage", "Attempts", "Total", "Mean", "Max", "Accepted / failed"];
  }
  const body = rows.length === 0
    ? [h("tr", {}, h("td", { class: "muted", colspan: headers.length }, "No duration records yet."))]
    : rows.map((row) => h("tr", {},
      h("td", {}, row.stage),
      h("td", { class: "num" }, row.count),
      h("td", { class: "num" }, fmtDuration(row.total)),
      row.fallback === true ? null : h("td", { class: "num" }, fmtDuration(row.total / row.count)),
      row.fallback === true ? null : h("td", { class: "num" }, fmtDuration(row.max)),
      h("td", { class: "num" }, row.fallback === true ? "—" : `${row.accepted} / ${row.failed}`),
    ));
  table.replaceChildren(
    h("thead", {}, h("tr", {}, ...headers.map((label, index) => h("th", { class: index === 0 ? undefined : "num" }, label)))),
    h("tbody", {}, ...body),
  );
}

function renderTokens() {
  const panel = $("#token-panel");
  const totals = tokenTotals();
  const byHarness = tokenByHarness();
  if (totals.total === 0) {
    panel.replaceChildren(h("div", { class: "muted" }, "No token-usage records yet."));
    return;
  }
  const max = Math.max(...byHarness.map(([, value]) => value.total), 1);
  panel.replaceChildren(
    h("div", { class: "token-total" }, fmtCompact(totals.total)),
    h("div", { class: "token-breakdown" },
      `input ${fmtCompact(totals.input)} · output ${fmtCompact(totals.output)} · cache read ${fmtCompact(totals.cacheRead)} · cache write ${fmtCompact(totals.cacheWrite)}`),
    ...byHarness.map(([harness, value]) => h("div", { class: "token-row" },
      h("span", {}, harness),
      h("span", { class: "track" }, h("span", { style: `width:${(value.total / max) * 100}%` })),
      h("span", { class: "amount" }, fmtCompact(value.total)),
    )),
  );
}

// ── lifecycle ──────────────────────────────────────────────────────────────

function startFromRunId(runId) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(String(runId ?? ""));
  if (match === null) return undefined;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
}

function earliestTimestamp() {
  let earliest = Infinity;
  for (const record of records()) {
    const parsed = Date.parse(record.timestamp);
    if (Number.isFinite(parsed)) earliest = Math.min(earliest, parsed);
  }
  for (const record of state.data?.records?.tokenUsage ?? []) {
    const parsed = Date.parse(record.timestamp);
    if (Number.isFinite(parsed)) earliest = Math.min(earliest, parsed);
  }
  for (const record of state.data?.records?.duration ?? []) {
    const parsed = Date.parse(record.timestamp);
    if (Number.isFinite(parsed)) earliest = Math.min(earliest, parsed);
  }
  if (!Number.isFinite(earliest)) return startFromRunId(state.data?.runId);
  return earliest;
}

function render() {
  const data = state.data;
  $("#empty").classList.toggle("hidden", data !== null);
  $("#overview").classList.toggle("hidden", data === null);
  if (data === null) return;
  syncControls();
  renderCards();
  drawChart();
  renderLegend();
  renderMeasurements();
  renderStages();
  renderTokens();
  $("#updated").textContent = state.lastUpdated === null ? "" : `updated ${fmtClock(state.lastUpdated)}`;
}

function showError(error) {
  const empty = $("#empty");
  empty.classList.remove("hidden");
  empty.replaceChildren(
    h("h1", {}, "Dashboard error"),
    h("p", { class: "muted" }, error instanceof Error ? error.message : String(error)),
  );
  $("#overview").classList.add("hidden");
}

async function refreshRun() {
  if (state.runId === null) return;
  try {
    state.data = await api(`/api/runs/${encodeURIComponent(state.runId)}`);
    state.lastUpdated = Date.now();
    render();
  } catch (error) {
    showError(error);
  }
}

async function selectRun(runId, push = true) {
  state.runId = runId;
  state.data = null;
  state.metricKey = null;
  state.zoom = null;
  state.hidden.clear();
  state.layout = null;
  if (push) history.replaceState(null, "", `?run=${encodeURIComponent(runId)}`);
  $("#run-picker").value = runId;
  await refreshRun();
}

function runFromLocation() {
  const match = /^\/r\/([^/]+)$/.exec(location.pathname);
  if (match !== null) return decodeURIComponent(match[1]);
  return new URLSearchParams(location.search).get("run") ?? undefined;
}

async function refreshRuns() {
  const data = await api("/api/runs");
  state.runs = data.runs ?? [];
  $("#run-picker").replaceChildren(...state.runs.map((run) => h(
    "option",
    { value: run.id },
    `${run.id} · ${run.status ?? "?"} · ${run.workflowName ?? "workflow"}`,
  )));
  if (state.runId !== null) $("#run-picker").value = state.runId;
}

async function tick() {
  if (state.paused || document.hidden) return;
  await refreshRun();
}

async function boot() {
  bindControls();
  try {
    await refreshRuns();
  } catch (error) {
    showError(error);
    return;
  }
  const wanted = runFromLocation();
  const runId = wanted !== undefined && state.runs.some((run) => run.id === wanted)
    ? wanted
    : state.runs[0]?.id;
  if (runId === undefined) {
    render();
  } else {
    await selectRun(runId, false);
  }
  state.timer = setInterval(tick, 2000);
}

void boot();
