import { describe, expect, it } from "vitest";
import { ScrollableChatArea } from "../../packages/cli/src/tui.js";

/**
 * Stand-in for the transcript container: `rows` is mutable so a test can model
 * what Ctrl+O does to the real chat area — toggling tool-box expansion reflows
 * the transcript by an unbounded number of rows.
 */
class FakeContent {
  rows: string[];

  constructor(count: number) {
    this.rows = Array.from({ length: count }, (_, i) => `line-${i}`);
  }

  setCount(count: number): void {
    this.rows = Array.from({ length: count }, (_, i) => `line-${i}`);
  }

  render(): string[] {
    return this.rows;
  }

  invalidate(): void {}
}

const VIEWPORT = 5;

function setup(contentRows: number): { content: FakeContent; area: ScrollableChatArea } {
  const content = new FakeContent(contentRows);
  const area = new ScrollableChatArea(content, () => VIEWPORT);
  return { content, area };
}

describe("chat viewport focus", () => {
  it("follows the newest rows before the user scrolls", () => {
    const { area } = setup(20);
    expect(area.isPinned).toBe(true);
    expect(area.render(40)).toEqual(["line-15", "line-16", "line-17", "line-18", "line-19"]);
  });

  it("unpins once the wheel moves back through older content", () => {
    const { area } = setup(20);
    area.render(40);
    expect(area.scrollBy(-5)).toBe(true);
    expect(area.isPinned).toBe(false);
    expect(area.render(40)).toEqual(["line-10", "line-11", "line-12", "line-13", "line-14"]);
  });

  // The wheel is also the way back into follow mode: scrolling down until the
  // viewport reaches the newest row re-pins, so auto-scroll resumes without
  // needing the Ctrl+End shortcut.
  it("re-pins when the wheel scrolls back down to the newest rows", () => {
    const { area } = setup(20);
    area.render(40);
    area.scrollBy(-5);
    expect(area.isPinned).toBe(false);
    expect(area.scrollBy(5)).toBe(true);
    expect(area.isPinned).toBe(true);
    expect(area.render(40)).toEqual(["line-15", "line-16", "line-17", "line-18", "line-19"]);
  });

  // A partial scroll down that does not reach the newest row must leave the
  // viewport unpinned — follow mode resumes only at the bottom.
  it("stays unpinned when the wheel scrolls down but not to the bottom", () => {
    const { area } = setup(20);
    area.render(40);
    area.scrollBy(-10);
    expect(area.scrollBy(4)).toBe(true);
    expect(area.isPinned).toBe(false);
    expect(area.render(40)).toEqual(["line-9", "line-10", "line-11", "line-12", "line-13"]);
  });

  // Overshooting past the bottom clamps to the newest row and re-pins: the
  // user asked for the bottom, so follow mode must resume.
  it("re-pins when a downward wheel overshoots past the bottom", () => {
    const { area } = setup(20);
    area.render(40);
    area.scrollBy(-5);
    expect(area.scrollBy(50)).toBe(true);
    expect(area.isPinned).toBe(true);
    expect(area.render(40)).toEqual(["line-15", "line-16", "line-17", "line-18", "line-19"]);
  });

  // The regression this guards: expansion multiplies the transcript height, so a
  // scrollTop captured while scrolled back lands on unrelated older content and
  // there is no keyboard route to the newest message.
  it("strands the viewport on old content when growth is not re-pinned", () => {
    const { content, area } = setup(20);
    area.render(40);
    area.scrollBy(-5);
    content.setCount(200); // Ctrl+O expands every tool box
    expect(area.render(40)).toEqual(["line-10", "line-11", "line-12", "line-13", "line-14"]);
  });

  it("focuses the newest rows after expansion grows the transcript", () => {
    const { content, area } = setup(20);
    area.render(40);
    area.scrollBy(-5);
    content.setCount(200);
    area.scrollEnd();
    expect(area.isPinned).toBe(true);
    expect(area.render(40)).toEqual(["line-195", "line-196", "line-197", "line-198", "line-199"]);
  });

  // Reverse direction: collapsing shrinks the transcript. Clamping alone leaves
  // the viewport at an arbitrary offset, so the re-pin has to hold both ways.
  it("focuses the newest rows after collapse shrinks the transcript", () => {
    const { content, area } = setup(200);
    area.render(40);
    area.scrollBy(-150);
    content.setCount(20); // Ctrl+O collapses every tool box
    area.scrollEnd();
    expect(area.render(40)).toEqual(["line-15", "line-16", "line-17", "line-18", "line-19"]);
  });

  it("stays on the newest rows across a full expand/collapse cycle", () => {
    const { content, area } = setup(20);
    area.render(40);
    area.scrollBy(-8);

    content.setCount(200);
    area.scrollEnd();
    expect(area.render(40).at(-1)).toBe("line-199");

    content.setCount(20);
    area.scrollEnd();
    expect(area.render(40).at(-1)).toBe("line-19");
  });

  it("is idempotent and safe to call while already pinned", () => {
    const { area } = setup(20);
    area.render(40);
    area.scrollEnd();
    area.scrollEnd();
    expect(area.isPinned).toBe(true);
    expect(area.render(40).at(-1)).toBe("line-19");
  });

  it("keeps the wheel able to leave the newest rows after a re-pin", () => {
    const { area } = setup(20);
    area.render(40);
    area.scrollEnd();
    expect(area.scrollBy(-3)).toBe(true);
    expect(area.isPinned).toBe(false);
    expect(area.render(40)).toEqual(["line-12", "line-13", "line-14", "line-15", "line-16"]);
  });

  // The wheel re-pin and the shortcut re-pin must converge on the same state,
  // or one of the two recovery paths would strand the viewport.
  it("converges the wheel re-pin and the shortcut re-pin on the same state", () => {
    const wheel = setup(20).area;
    const shortcut = setup(20).area;
    wheel.render(40);
    wheel.scrollBy(-7);
    wheel.scrollBy(7);
    shortcut.render(40);
    shortcut.scrollBy(-7);
    shortcut.scrollEnd();
    expect(wheel.isPinned).toBe(shortcut.isPinned);
    expect(wheel.render(40)).toEqual(shortcut.render(40));
  });

  it("pads short content to the viewport height and still reports pinned", () => {
    const { area } = setup(2);
    area.scrollEnd();
    expect(area.render(40)).toEqual(["line-0", "line-1", "", "", ""]);
    expect(area.isPinned).toBe(true);
  });
});
