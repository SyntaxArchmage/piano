import { describe, expect, it } from "vitest";
import {
  darkTheme,
  highContrastTheme,
  lightTheme,
  luminance,
  resolveTheme,
  themeForLuminance,
} from "../../packages/cli/src/theme.js";

/** Perceived luminance of an SGR colour string ("\x1b[38;2;R;G;Bm" / 3Xm). */
function sgrLuminance(sgr: string): number | null {
  const truecolor = sgr.match(/38;2;(\d+);(\d+);(\d+)/);
  if (truecolor) return luminance(`#${[truecolor[1], truecolor[2], truecolor[3]]
    .map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`);
  const palette: Record<string, string> = {
    "30": "#000000", "31": "#cd3131", "32": "#00cd00", "33": "#cdcd00",
  };
  const indexed = sgr.match(/3(\d)/);
  return indexed ? luminance(palette[`3${indexed[1]}`] ?? "#000000") : null;
}

/** WCAG-ish contrast ratio between two luminances. */
function ratio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 5) / (lo + 5);
}

describe("theme resolution", () => {
  it("lets the explicit env override beat the detected background", () => {
    expect(resolveTheme({ PIANO_THEME: "dark" }, "#ffffff")).toBe(darkTheme);
    expect(resolveTheme({ PIANO_THEME: "light" }, "#000000")).toBe(lightTheme);
  });

  it("picks the palette from the detected background when no env override exists", () => {
    expect(resolveTheme({}, "#ffffff")).toBe(lightTheme);
    expect(resolveTheme({}, "#101010")).toBe(darkTheme);
    expect(themeForLuminance(200)).toBe(lightTheme);
    expect(themeForLuminance(20)).toBe(darkTheme);
  });

  it("falls back when neither env nor a background reply is available", () => {
    // The fallback must not paint a fixed dark bar: it keeps the terminal's own
    // background so it reads on a light shell as well as a dark one.
    expect(resolveTheme({}, null)).toBe(highContrastTheme);
    expect(highContrastTheme.barBg).toBe("\x1b[49m");
  });
});

describe("light palette legibility", () => {
  // The light shell is the worst case for a dark-on-light palette: white is the
  // brightest canvas any role can land on, so clearing it clears every bar.
  const white = 255;

  it("keeps body and metadata roles readable on a white shell", () => {
    const roles = ["dim", "toolOutput", "outputLabel", "outputPunct", "mdQuote", "mdCodeBlockBorder"] as const;
    for (const role of roles) {
      const luma = sgrLuminance(lightTheme[role]);
      expect(luma, `${role} should be a resolvable colour`).not.toBeNull();
      expect(ratio(luma!, white), `${role} (${lightTheme[role]}) is too faint on white`).toBeGreaterThanOrEqual(3.5);
    }
  });

  it("keeps syntax-colour roles distinguishable and readable", () => {
    const syntax = ["outputKey", "outputString", "outputNumber", "outputLiteral"] as const;
    for (const role of syntax) {
      const luma = sgrLuminance(lightTheme[role]);
      expect(ratio(luma!, white), `${role} is too faint on white`).toBeGreaterThanOrEqual(3);
    }
    expect(new Set(syntax.map((role) => lightTheme[role])).size).toBe(4);
  });
});
