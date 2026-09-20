import type { HeatScale } from "./types.js";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

/** Render one normalized scorecard cell with an optional deterministic heat
 * scale. This stays pure so reports, TUI views, and tests can share it. */
export function heatCell(
  value: number | undefined,
  scale?: HeatScale,
  format: (value: number) => string = (candidate) => String(candidate),
): string {
  if (value === undefined) return "n/a";
  const display = format(value);
  if (scale === undefined) return display;

  const clamped = Math.min(scale.max, Math.max(scale.min, value));
  const span = scale.max - scale.min;
  if (span <= 0) return `${GREEN}${display}${RESET}`;

  let color: string;
  if (typeof scale.good === "number") {
    const tolerance = Math.max(0.05 * span, 1e-9);
    const distance = Math.abs(clamped - scale.good);
    color = distance <= tolerance ? GREEN : distance <= 2 * tolerance ? YELLOW : RED;
  } else {
    const normalized = (clamped - scale.min) / span;
    color = scale.good === "high"
      ? normalized >= 0.8 ? GREEN : normalized >= 0.5 ? YELLOW : RED
      : normalized <= 0.2 ? GREEN : normalized <= 0.5 ? YELLOW : RED;
  }
  return `${color}${display}${RESET}`;
}
