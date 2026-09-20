import { resetCapabilitiesCache, setCapabilities } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import { darkTheme } from "../../packages/cli/src/theme.js";
import {
  parseWorkflowGraphSnapshot,
  renderWorkflowGraphLineDag,
  renderWorkflowGraphPng,
  renderWorkflowGraphSvg,
  WorkflowGraph,
  type WorkflowGraphSnapshot,
} from "../../packages/cli/src/workflow-graph.js";

// eslint-disable-next-line no-control-regex -- test helper strips terminal SGR codes
const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-9;]*m/g, "");
const KITTY_IMAGE_PREFIX = `${String.fromCharCode(27)}_Ga=T,`;

const definition = {
  stages: [
    { id: "setup", dependsOn: [] },
    { id: "prepare.inputs", dependsOn: [] },
    { id: "profile.models", dependsOn: ["setup"] },
    { id: "measure", dependsOn: ["profile.models"] },
    { id: "report", dependsOn: ["measure", "prepare.inputs"] },
  ],
} as const;

const runningSnapshot: WorkflowGraphSnapshot = {
  plannedStages: 5,
  completedStages: 2,
  status: "running",
  current: { stageId: "profile.models", status: "running" },
  stageCounts: {
    setup: { planned: 1, completed: 1 },
    "prepare.inputs": { planned: 1, completed: 1 },
    "profile.models": { planned: 1, completed: 0 },
    measure: { planned: 1, completed: 0 },
    report: { planned: 1, completed: 0 },
  },
};

const mapDefinition = {
  stages: [
    { id: "prepare", dependsOn: [] },
    { id: "fanout.implement", dependsOn: ["prepare"] },
    { id: "fanout.verify", dependsOn: ["fanout.implement"] },
    { id: "report", dependsOn: ["fanout.verify"] },
  ],
  maps: [{ id: "fanout", entryStageId: "fanout.implement", exitStageId: "fanout.verify", count: 4 }],
} as const;

afterEach(() => {
  resetCapabilitiesCache();
});

describe("WorkflowGraph", () => {
  it("builds a polished vector DAG with one pill node per stage and every dependency", () => {
    const svg = renderWorkflowGraphSvg(definition, runningSnapshot, darkTheme);

    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.match(/<g data-stage=/g)).toHaveLength(5);
    for (const id of ["setup", "prepare.inputs", "profile.models", "measure", "report"]) {
      expect(svg).toContain(`data-stage="${id}"`);
    }
    for (const [from, to] of [
      ["setup", "profile.models"],
      ["profile.models", "measure"],
      ["measure", "report"],
      ["prepare.inputs", "report"],
    ]) {
      expect(svg).toContain(`data-from="${from}" data-to="${to}"`);
    }
    expect(svg).toContain("data-status=\"completed\"");
    expect(svg).toContain("data-status=\"running\"");
    expect(svg).toContain("data-status=\"pending\"");
    expect(svg).toContain("<linearGradient id=\"running-fill\"");
    expect(svg).toContain("<feDropShadow");
    expect(svg).not.toContain("──▶");
  });

  it("rasterizes valid PNG frames and pulses without changing geometry", () => {
    const bright = renderWorkflowGraphPng(definition, runningSnapshot, darkTheme, true);
    const soft = renderWorkflowGraphPng(definition, runningSnapshot, darkTheme, false);

    expect(bright.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bright.readUInt32BE(16)).toBe(940);
    expect(bright.readUInt32BE(20)).toBe(192);
    expect(soft.readUInt32BE(16)).toBe(bright.readUInt32BE(16));
    expect(soft.readUInt32BE(20)).toBe(bright.readUInt32BE(20));
    expect(soft.equals(bright)).toBe(false);
  });

  it("bounds raster dimensions for unusually wide or tall workflows", () => {
    const stages = Array.from({ length: 20 }, (_, index) => ({ id: `root-${index}`, dependsOn: [] }));
    const png = renderWorkflowGraphPng({ stages }, undefined, darkTheme);

    expect(png.readUInt32BE(16)).toBeLessThanOrEqual(1600);
    expect(png.readUInt32BE(20)).toBeLessThanOrEqual(720);
  });

  it("uses a stable Kitty image id across animation frames", async () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    const graph = new WorkflowGraph(definition, async () => runningSnapshot, darkTheme);
    await graph.refresh();

    const first = graph.render(100);
    graph.toggleBlink();
    const second = graph.render(100);
    const imageId = /\bi=(\d+)/.exec(first[0] ?? "")?.[1];

    expect(first[0]?.startsWith(KITTY_IMAGE_PREFIX)).toBe(true);
    expect(first.length).toBeGreaterThan(1);
    expect(first.length).toBeLessThanOrEqual(12);
    expect(second[0]?.startsWith(KITTY_IMAGE_PREFIX)).toBe(true);
    expect(second).toHaveLength(first.length);
    expect(second[0]).not.toBe(first[0]);
    expect(imageId).toBeDefined();
    expect(second[0]).toContain(`i=${imageId}`);
  });

  it("renders a face-page line DAG on xterm-like terminals", async () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const graph = new WorkflowGraph(definition, async () => runningSnapshot, darkTheme);
    await graph.refresh();

    const first = graph.render(100);
    graph.toggleBlink();
    const second = graph.render(100);
    // eslint-disable-next-line no-control-regex -- strip ANSI SGR for visible-width assertions
    const plain = first.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    expect(first.length).toBeGreaterThan(0);
    expect(plain).toContain("◉");
    expect(plain).toContain("›");
    expect(plain).not.toMatch(/[╭╮╰╯█▓▒░]/);
    // eslint-disable-next-line no-control-regex -- strip ANSI SGR for visible-width assertions
    expect(first.every((row) => row.replace(/\x1b\[[0-9;]*m/g, "").length <= 100)).toBe(true);
    expect(second).toHaveLength(first.length);
    expect(second.join("\n")).not.toBe(first.join("\n"));
    expect(plain).toContain("setup");
    expect(plain).toContain("models");
    expect(plain).not.toContain("profile.models");
    expect(stripAnsi(graph.summary())).toBe("");
    expect(renderWorkflowGraphLineDag(definition, runningSnapshot, darkTheme, 24).every((row) => stripAnsi(row).length <= 24)).toBe(true);
    setCapabilities({ images: null, trueColor: false, hyperlinks: false });
    expect(graph.render(80).join("\n")).not.toContain("38;2;");
    expect(graph.render(0)).toEqual([]);
    expect(graph.render(20)).toEqual([]);
    expect(graph.render(Number.POSITIVE_INFINITY)).toEqual([]);
    expect(graph.render(Number.NaN)).toEqual([]);
  });

  it("surfaces the workflow name and path in the summary, never progress or status", async () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const identified = new WorkflowGraph(
      { ...definition, name: "basic", path: "/home/albert/.piano/workflow.yml" },
      async () => runningSnapshot,
      darkTheme,
    );
    await identified.refresh();
    expect(stripAnsi(identified.summary())).toBe("basic /home/albert/.piano/workflow.yml");
    // A name-only definition shows only the name.
    const nameOnly = new WorkflowGraph(
      { ...definition, name: "basic" },
      async () => runningSnapshot,
      darkTheme,
    );
    await nameOnly.refresh();
    expect(stripAnsi(nameOnly.summary())).toBe("basic");
  });

  it("yields an empty summary when a graph has no identity", () => {
    const graph = new WorkflowGraph(
      { stages: [{ id: "setup", dependsOn: [] }] },
      async () => runningSnapshot,
      darkTheme,
    );
    expect(stripAnsi(graph.summary())).toBe("");
  });

  it("visualizes map regions as slot forks without exposing the map name", () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const plain = renderWorkflowGraphLineDag(mapDefinition, undefined, darkTheme, 100)
      .map(stripAnsi).join("\n");

    for (const slot of ["implement#0", "implement#1", "implement#2", "implement#3"]) expect(plain).toContain(slot);
    expect(plain).not.toContain("fanout");
    // Every slot label appears exactly once; arrows connect the DAG.
    expect(plain.match(/implement#[0-3]/g)).toHaveLength(4);
    expect(plain.match(/[›]/g)?.length).toBeGreaterThanOrEqual(1);
    const svg = renderWorkflowGraphSvg(mapDefinition, undefined, darkTheme);
    expect(svg).toContain("implement#0");
    expect(svg).not.toContain("fanout");
  });

  it("accumulates a loop's iterations and the stage name owns its counter", () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const rows = renderWorkflowGraphLineDag({
      stages: [
        { id: "tune.profile", dependsOn: [] },
        { id: "measure", dependsOn: ["tune.profile"] },
      ],
    }, {
      status: "running",
      invocationTime: {
        "tune.profile@tune/iter-0": { stageId: "tune.profile", instanceId: "tune/iter-0", completedMs: 20_000 },
        "tune.profile@tune/iter-1": { stageId: "tune.profile", instanceId: "tune/iter-1", completedMs: 22_000 },
        "measure@tune/iter-1": { stageId: "measure", instanceId: "tune/iter-1", completedMs: 500 },
      },
    }, darkTheme, 100).map(stripAnsi).join("\n");

    // 20s + 22s: one stage node sums the loop's iterations, on the name's row.
    expect(rows).toContain("profile - 42.0s");
    expect(rows).toContain("measure - 500ms");
  });

  it("ticks a running stage until the run stops working", () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const snapshot: WorkflowGraphSnapshot = {
      status: "running",
      invocationTime: {
        "measure@root": { stageId: "measure", completedMs: 5_000, runningSince: "2026-01-01T00:00:00.000Z" },
      },
    };
    const wideDefinition = {
      stages: [{ id: "measure", dependsOn: [] }, { id: "report", dependsOn: ["measure"] }],
    };
    const start = Date.parse("2026-01-01T00:00:00.000Z");
    const at = (offsetMs: number, status?: "running" | "paused") => renderWorkflowGraphLineDag(
      wideDefinition,
      status === undefined ? snapshot : { ...snapshot, status },
      darkTheme,
      100,
      true,
      start + offsetMs,
    ).map(stripAnsi).join("\n");

    expect(at(0)).toContain("measure - 5.0s");
    expect(at(3_000)).toContain("measure - 8.0s");
    // A paused run is not working, so the open span stops counting.
    expect(at(60_000, "paused")).toContain("measure - 5.0s");
  });

  it("renders a paused snapshot as terminal, not a live stage", () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    // Legacy on-disk shape: top-level "paused" while the interrupted stage
    // still says "running" in current.status (written before finalize folded
    // the pointer). The terminal flag suppresses the running-pulse check only —
    // stageCounts and accepted/failed per-stage checks still apply, so stages
    // that completed before the pause show ✓ and stages that never ran stay ·.
    // profile.models has current.status:"running" and stageCounts.completed:0,
    // so it stays · (same as measure/report) until a post-fix finalize folds it.
    const rows = renderWorkflowGraphLineDag(definition, {
      ...runningSnapshot,
      status: "paused",
      current: { stageId: "profile.models", status: "running" },
    }, darkTheme, 100, true).map(stripAnsi).join("\n");
    // No live pulsing glyph
    expect(rows).not.toContain("◉");
    // setup and prepare.inputs completed via stageCounts — show ✓
    expect(rows).toContain("✓");
    const arcLine = rows.split("\n").find((r) => r.includes("·") || r.includes("✓")) ?? "";
    // 2 completed (setup, inputs); 3 pending (models/measure/report — all lack stageCounts evidence)
    expect((arcLine.match(/✓/g) ?? []).length).toBe(2);
    // Map-slot path: terminal run stops all slots from pulsing. Under paused all
    // slots show ✓ (visualStatus is per-map, not per-slot — no slot granularity here).
    const slots = renderWorkflowGraphLineDag(mapDefinition, {
      status: "paused",
      current: { stageId: "fanout.implement", status: "running" },
    }, darkTheme, 100, true).map(stripAnsi).join("\n");
    expect(slots).not.toContain("◉");
  });

  it("gives every map slot its own lane time", () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const rows = renderWorkflowGraphLineDag({
      stages: [
        { id: "prepare", dependsOn: [] },
        { id: "fanout.implement", dependsOn: ["prepare"] },
      ],
      maps: [{ id: "fanout", entryStageId: "fanout.implement", exitStageId: "fanout.implement", count: 2 }],
    }, {
      status: "running",
      invocationTime: {
        "fanout.implement@fanout/slot-0": { stageId: "fanout.implement", instanceId: "fanout/slot-0", completedMs: 1_000 },
        "fanout.implement@fanout/slot-1": { stageId: "fanout.implement", instanceId: "fanout/slot-1", completedMs: 2_000 },
        // A slot this run never rendered must not leak into slot 1.
        "fanout.implement@fanout/slot-10": { stageId: "fanout.implement", instanceId: "fanout/slot-10", completedMs: 4_000 },
      },
    }, darkTheme, 100).map(stripAnsi).join("\n");

    expect(rows).toContain("implement#0 - 1.0s");
    expect(rows).toContain("implement#1 - 2.0s");
    expect(rows).not.toContain("6.0s");
    expect(rows).not.toContain("7.0s");
    // A stage the orchestrator never measured keeps its bare name.
    expect(rows).toContain("prepare");
    expect(rows).not.toContain("prepare -");
  });

  it("draws the stage counter beside the name inside the pill", () => {
    const svg = renderWorkflowGraphSvg({
      stages: [{ id: "tune.profile", dependsOn: [], model: "qwen3.8-flash" }],
    }, {
      status: "running",
      invocationTime: { "tune.profile@root": { stageId: "tune.profile", completedMs: 62_000 } },
    }, darkTheme, true, Date.parse("2026-01-01T00:00:00.000Z"));

    expect(svg).toContain("class=\"node-label\">profile - 1m02s</text>");
    // The name gives up characters before the counter does, so a long stage
    // name can never hide how long it ran.
    const clipped = renderWorkflowGraphSvg({
      stages: [{ id: "a-very-long-stage-name-for-clipping", dependsOn: [] }],
    }, {
      status: "running",
      invocationTime: { "clipped@root": { stageId: "a-very-long-stage-name-for-clipping", completedMs: 3_000 } },
    }, darkTheme);
    expect(clipped).toContain("class=\"node-label\">a-very-long… - 3.0s</text>");
  });

  it("draws the stage model in light blue adjacent to the stage name", () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const rows = renderWorkflowGraphLineDag({
      stages: [
        { id: "setup", dependsOn: [], model: "qwen3.8-flash" },
        { id: "report", dependsOn: ["setup"], model: "claude-opus-5" },
      ],
    }, undefined, darkTheme, 100);
    const plain = rows.map(stripAnsi);
    const setupNameRow = plain.findIndex((row) => row.includes("setup"));
    const reportNameRow = plain.findIndex((row) => row.includes("report"));

    expect(setupNameRow).toBeGreaterThanOrEqual(0);
    expect(reportNameRow).toBeGreaterThanOrEqual(0);
    // setup is even-indexed: label above glyph row, model directly above name.
    // report is odd-indexed: label below glyph row, model directly below name.
    // Either way the model sits one row away from the stage name.
    expect(plain.join("\n")).toContain("qwen3.8-flash");
    expect(plain.join("\n")).toContain("claude-opus-5");
    // The model rows are light blue.
    expect(rows.join("\n")).toContain(darkTheme.mdLink);
    expect(plain.every((row) => row.length <= 100)).toBe(true);
  });

  it("clips a long model to one row so the footer keeps its height", () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const withModel = renderWorkflowGraphLineDag({
      stages: [{ id: "setup", dependsOn: [], model: "a-very-long-model-name-that-overflows" }],
    }, undefined, darkTheme, 24).map(stripAnsi);
    const withoutModel = renderWorkflowGraphLineDag({
      stages: [{ id: "setup", dependsOn: [] }],
    }, undefined, darkTheme, 24).map(stripAnsi);

    expect(withModel.join("\n")).toContain("…");
    expect(withModel.every((row) => row.length <= 24)).toBe(true);
    // Model adds one more label row, which grows the above/below padding by one
    // each, so the total height rises by 2: name+model above/below the glyph.
    expect(withModel).toHaveLength(withoutModel.length + 2);
  });

  it("carries the map entry stage model onto every fan-out slot", () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const plain = renderWorkflowGraphLineDag({
      stages: [
        { id: "prepare", dependsOn: [] },
        { id: "fanout.implement", dependsOn: ["prepare"], model: "qwen3.8-flash" },
        { id: "fanout.verify", dependsOn: ["fanout.implement"] },
      ],
      maps: [{ id: "fanout", entryStageId: "fanout.implement", exitStageId: "fanout.verify", count: 2 }],
    }, undefined, darkTheme, 100).map(stripAnsi).join("\n");

    expect(plain.match(/qwen3\.8-flash/g)).toHaveLength(2);
    expect(plain).toContain("implement#0");
    expect(plain).toContain("implement#1");
  });

  it("labels each pill with its model inside the vector scene", () => {
    const svg = renderWorkflowGraphSvg({
      stages: [{ id: "profile.models", dependsOn: [], model: "qwen3.8-flash" }],
    }, undefined, darkTheme);
    const textRows = (scene: string) => [...scene.matchAll(/<text x="\d+" y="(\d+)" class="node-(prefix|label|model)"/g)]
      .map((match) => ({ row: match[2], y: Number(match[1]) }));

    expect(svg).toContain("class=\"node-model\">qwen3.8-flash</text>");
    expect(svg).toContain(".node-model{fill:#81a2be");
    // Stage name, then model — both inside the 58px pill drawn at y=24.
    expect(textRows(svg).map(({ row }) => row)).toEqual(["label", "model"]);
    expect(textRows(svg).every(({ y }) => y > 24 && y < 24 + 58)).toBe(true);
    // A prefixed label keeps all three rows inside the same pill.
    const prefixed = renderWorkflowGraphSvg({
      stages: [{ id: "measure", label: "tune.measure", dependsOn: [], model: "qwen3.8-flash" }],
    }, undefined, darkTheme);
    expect(textRows(prefixed).map(({ row }) => row)).toEqual(["prefix", "label", "model"]);
    expect(textRows(prefixed).every(({ y }) => y > 24 && y < 24 + 58)).toBe(true);
    // A model-free stage keeps its original single-line placement.
    expect(renderWorkflowGraphSvg({ stages: [{ id: "setup", dependsOn: [] }] }, undefined, darkTheme))
      .toContain("y=\"59\" class=\"node-label\"");
  });

  it("wraps long own stage names below their status node", () => {
    const rows = renderWorkflowGraphLineDag({
      stages: [{ id: "very-long-stage-name-that-needs-wrapping", dependsOn: [] }],
    }, undefined, darkTheme, 24).map(stripAnsi);

    expect(rows.length).toBeGreaterThan(3);
    expect(rows.join("\n")).toContain("very-long-stage-name");
    expect(rows.join("\n")).toContain("needs-wrapping");
    expect(rows.every((row) => row.length <= 24)).toBe(true);
  });

  it("renders both map groups without overlapping their slots", () => {
    const definition = {
      stages: [
        { id: "left.work", dependsOn: [] },
        { id: "right.work", dependsOn: [] },
        { id: "done", dependsOn: ["left.work", "right.work"] },
      ],
      maps: [
        { id: "left", entryStageId: "left.work", exitStageId: "left.work", count: 2 },
        { id: "right", entryStageId: "right.work", exitStageId: "right.work", count: 2 },
      ],
    } as const;
    const rows = renderWorkflowGraphLineDag(definition, undefined, darkTheme, 100).map(stripAnsi);
    const joined = rows.join("\n");
    expect(joined).toContain("work#0");
    expect(joined).toContain("work#1");
    // All four slots plus the done stage must appear.
    expect(joined).toContain("done");
    expect(joined.match(/work#0/g)?.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((row) => row.length <= 100)).toBe(true);
  });

  it("renders map slots without a summary-driven status", async () => {
    const graph = new WorkflowGraph(mapDefinition, async () => ({
      plannedStages: 7,
      completedStages: 1,
      status: "running",
      current: { stageId: "fanout.implement", status: "running" },
    }), darkTheme);
    await graph.refresh();
    // Without an identity (name/path) the summary is empty; stage state lives
    // in the DAG itself, not the summary line.
    expect(stripAnsi(graph.summary())).toBe("");
    expect(graph.summary()).not.toContain("fanout");
  });

  it("moves accepted and failed stages into their visual states", async () => {
    let snapshot: WorkflowGraphSnapshot = runningSnapshot;
    const graph = new WorkflowGraph(definition, async () => snapshot, darkTheme);
    await graph.refresh();

    snapshot = { ...runningSnapshot, completedStages: 3, current: { stageId: "profile.models", status: "accepted" } };
    await graph.refresh();
    expect(stripAnsi(graph.summary())).toBe("");
    expect(renderWorkflowGraphSvg(definition, snapshot, darkTheme))
      .toContain("data-stage=\"profile.models\" data-status=\"completed\"");

    snapshot = { ...snapshot, status: "failed", current: { stageId: "measure", status: "failed" } };
    await graph.refresh();
    expect(stripAnsi(graph.summary())).toBe("");
    expect(renderWorkflowGraphSvg(definition, snapshot, darkTheme))
      .toContain("data-stage=\"measure\" data-status=\"failed\"");
  });

  it("shares an in-flight read and keeps the last valid snapshot", async () => {
    let calls = 0;
    let resolveRead: ((snapshot: WorkflowGraphSnapshot | undefined) => void) | undefined;
    const pending = new Promise<WorkflowGraphSnapshot | undefined>((resolve) => { resolveRead = resolve; });
    let nextRead: Promise<WorkflowGraphSnapshot | undefined> = pending;
    const graph = new WorkflowGraph({ stages: [{ id: "setup", dependsOn: [] }] }, async () => {
      calls += 1;
      return nextRead;
    }, darkTheme);

    const first = graph.refresh();
    expect(graph.refresh()).toBe(first);
    await Promise.resolve();
    expect(calls).toBe(1);
    resolveRead?.({ plannedStages: 1, completedStages: 1, status: "completed" });
    await first;
    expect(stripAnsi(graph.summary())).toBe("");

    nextRead = Promise.resolve(undefined);
    await graph.refresh();
    expect(stripAnsi(graph.summary())).toBe("");
  });

  it("rejects malformed snapshots at the CLI boundary", () => {
    expect(parseWorkflowGraphSnapshot({ plannedStages: 1, completedStages: 0 })).toBeDefined();
    expect(parseWorkflowGraphSnapshot({ plannedStages: -1 })).toBeUndefined();
    expect(parseWorkflowGraphSnapshot({ plannedStages: 1.5 })).toBeUndefined();
    expect(parseWorkflowGraphSnapshot({ completedStages: 0.5 })).toBeUndefined();
    expect(parseWorkflowGraphSnapshot({ stageCounts: { setup: { planned: 1.5 } } })).toBeUndefined();
    expect(parseWorkflowGraphSnapshot({ stageCounts: { setup: { completed: 0.5 } } })).toBeUndefined();
    expect(parseWorkflowGraphSnapshot({ current: { status: "unknown" } })).toBeUndefined();
    expect(parseWorkflowGraphSnapshot({ invocationTime: { a: { stageId: "a", completedMs: 1 } } })).toBeDefined();
    expect(parseWorkflowGraphSnapshot({ invocationTime: { a: { completedMs: 1.5 } } })).toBeUndefined();
    expect(parseWorkflowGraphSnapshot({ invocationTime: { a: { completedMs: -1 } } })).toBeUndefined();
    expect(parseWorkflowGraphSnapshot({ invocationTime: { a: { runningSince: "soon" } } })).toBeUndefined();
  });
});
