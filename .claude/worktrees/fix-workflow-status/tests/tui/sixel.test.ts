import { resetCapabilitiesCache, setCapabilities } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import { darkTheme } from "../../packages/cli/src/theme.js";
import { renderWorkflowGraphPng, WorkflowGraph } from "../../packages/cli/src/workflow-graph.js";
import { detectSixelSupport, encodeSixelPng } from "../../packages/cli/src/sixel.js";

const definition = { stages: [{ id: "setup", dependsOn: [] }] } as const;

afterEach(() => {
  delete process.env.PIANO_IMAGE_PROTOCOL;
  delete process.env.PIANO_SIXEL;
  resetCapabilitiesCache();
});

describe("Sixel image backend", () => {
  it("requires explicit Sixel opt-in for an xterm-like environment", () => {
    expect(detectSixelSupport({ TERM: "xterm-256color" })).toBe(false);
    expect(detectSixelSupport({ TERM: "xterm-256color", PIANO_IMAGE_PROTOCOL: "sixel" })).toBe(true);
    expect(detectSixelSupport({ TERM: "xterm-sixel" })).toBe(true);
  });

  it("encodes the SVG raster as an atomic Sixel image line", () => {
    const png = renderWorkflowGraphPng(definition, undefined, darkTheme);
    const sixel = encodeSixelPng(png, 180, 72);

    expect(sixel.startsWith("\x1b]1337;File=name=sixel;inline=1:\x1b\\\x1bPq")).toBe(true);
    expect(sixel).toContain('"1;1;');
    expect(sixel).toContain("#");
    expect(sixel.endsWith("\x1b\\")).toBe(true);
  });

  it("uses Sixel only when explicitly enabled and keeps the image path atomic", async () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    process.env.PIANO_IMAGE_PROTOCOL = "sixel";
    const graph = new WorkflowGraph(definition, async () => undefined, darkTheme);
    const rows = graph.render(80);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.startsWith("\x1b]1337;File=name=sixel")).toBe(true);
    expect(rows[0]).not.toContain("setup");
  });
});
