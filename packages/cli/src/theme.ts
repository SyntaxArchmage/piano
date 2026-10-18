// ── Themes ────────────────────────────────────────────────────────────────────

import { stdin, stdout } from "node:process";

/** Contrast class a theme was built for. The mission and `/btw`'s side screen
 * each have their own palette, but both must stay legible on the same shell, so
 * a side palette is selected by the contrast class of the theme it replaces. */
export type PianoThemeVariant = "dark" | "light" | "high-contrast";

/** Color roles used throughout the TUI. `accent` is the brand dark-red. */
export interface PianoTheme {
  variant: PianoThemeVariant;
  accent: string;  // brand, borders, labels, tools, commands
  primary: string; // task value, agent messages
  dim: string;     // hints, metadata, examples
  success: string; // success + user message marker
  error: string;   // errors
  bold: string;    // bold
  barBg: string;   // fixed status bar background (full-width strip)
  // chat-area transcript roles (decision 0022)
  userBg: string;             // user message background block
  userText: string;           // user message foreground
  toolTitle: string;          // tool call title (name)
  toolCommand: string;        // executable tool preview / command
  toolSection: string;        // expanded tool section labels
  toolOutput: string;         // tool call args / result
  // Per-type tool-output formatting (see tool-output.ts). The expanded result
  // body is a mixture of data kinds, so each kind owns a colour instead of
  // every line sharing `toolOutput`.
  outputKey: string;          // JSON object keys / diff hunk headers
  outputString: string;       // JSON string values / diff added lines / file names
  outputNumber: string;       // JSON numbers / file sizes
  outputLiteral: string;      // JSON true|false|null
  outputPunct: string;        // JSON punctuation, diff headers, listing metadata
  outputAdded: string;        // diff added lines
  outputRemoved: string;      // diff removed lines
  outputMetric: string;       // metric values in `KEY=value` lines
  outputLabel: string;        // keys, `cat -n` line numbers
  mdHeading: string;          // markdown heading
  mdLink: string;             // markdown link
  mdCode: string;             // markdown inline code
  mdCodeBlock: string;        // markdown fenced code block text
  mdCodeBlockBorder: string;  // markdown code block border
  mdQuote: string;            // markdown blockquote text
  mdQuoteBorder: string;      // markdown blockquote border
  mdHr: string;               // markdown horizontal rule
  mdListBullet: string;       // markdown list bullet
  // sign-off review block (decision: mounted as the newest chat block)
  signoffBorder: string;        // review block outline (box-drawing border only)
  signoffBg: string;            // review block background (very dark purple fill)
  signoffTitle: string;         // review question title on the block
  signoffText: string;          // options / typed answer foreground on the block
  signoffMuted: string;         // message, details and descriptions on the block
  signoffSelectedBg: string;    // selected option row background
  signoffSelectedFg: string;    // selected option row foreground
}

export const RST = "\x1b[0m"; // universal reset — identical in every theme

/** Dark-shell theme. Accent is a dark red that stays legible on black. */
export const darkTheme: PianoTheme = {
  variant: "dark",
  accent: "\x1b[38;2;192;57;43m", // #c0392b — dark red, readable on black
  primary: "\x1b[97m",
  // A mid-gray (not faint+bright-black, which collapses to near-black on a
  // dark terminal) so hints/examples stay legible on black.
  dim: "\x1b[38;2;150;150;150m",
  success: "\x1b[32m",
  error: "\x1b[91m",
  bold: "\x1b[1m",
  // A mid-dark gray (#303030) so the strip reads as a distinct bar against the
  // near-black chat canvas without competing with the chat text.
  barBg: "\x1b[48;2;48;48;48m",
  // Indigo-tinted slate (#3c3e5a) — one clear step off the neutral chat canvas
  // so user turns (and sign-off decisions echoed as user messages) read as the
  // human side of the conversation, without competing with chat text.
  userBg: "\x1b[48;2;60;62;90m",
  userText: "\x1b[97m",
  toolTitle: "\x1b[38;2;192;57;43m",
  toolCommand: "\x1b[38;2;130;216;255m",
  toolSection: "\x1b[38;2;174;184;194m",
  toolOutput: "\x1b[38;2;150;150;150m",
  outputKey: "\x1b[38;2;130;216;255m",
  outputString: "\x1b[38;2;152;195;121m",
  outputNumber: "\x1b[38;2;229;192;123m",
  outputLiteral: "\x1b[38;2;198;120;221m",
  outputPunct: "\x1b[38;2;120;120;120m",
  outputAdded: "\x1b[38;2;152;195;121m",
  outputRemoved: "\x1b[38;2;224;108;117m",
  outputMetric: "\x1b[38;2;229;192;123m",
  outputLabel: "\x1b[38;2;150;150;150m",
  mdHeading: "\x1b[38;2;240;198;116m",
  mdLink: "\x1b[38;2;129;162;190m",
  mdCode: "\x1b[38;2;192;57;43m",
  mdCodeBlock: "\x1b[38;2;181;189;104m",
  mdCodeBlockBorder: "\x1b[38;2;96;96;96m",
  mdQuote: "\x1b[38;2;150;150;150m",
  mdQuoteBorder: "\x1b[38;2;96;96;96m",
  mdHr: "\x1b[38;2;96;96;96m",
  mdListBullet: "\x1b[38;2;192;57;43m",
  // Sign-off review block: a bordered panel — very dark purple fill (#211a3d)
  // carrying light lavender text, with only the box outline painted purple so
  // the review reads as a distinct gate without washing the chat in colour.
  signoffBorder: "\x1b[38;2;176;142;222m", // #b08ede — purple outline
  signoffBg: "\x1b[48;2;33;26;61m",        // #211a3d — very dark purple fill
  signoffTitle: "\x1b[1m\x1b[38;2;244;238;255m",
  signoffText: "\x1b[38;2;233;225;250m",
  signoffMuted: "\x1b[38;2;179;163;208m",
  signoffSelectedBg: "\x1b[48;2;224;206;246m",
  signoffSelectedFg: "\x1b[38;2;46;30;78m",
};

/** Light-shell theme. Dark red on white; no dim-on-light invisibility. */
export const lightTheme: PianoTheme = {
  variant: "light",
  accent: "\x1b[38;2;139;0;0m", // #8b0000 — dark red, readable on white
  primary: "\x1b[30m",
  // Dark gray (#404040) so hints and examples clear 4.5:1 against white —
  // the previous #5a5a5a sat at 2.7:1 and read as washed out.
  dim: "\x1b[38;2;64;64;64m",
  success: "\x1b[38;2;0;110;0m",   // dark green — the palette green was 2:1 on white
  error: "\x1b[38;2;160;20;20m",   // dark red — the palette red was 2.6:1 on white
  bold: "\x1b[1m",
  // A barely-darker-than-white strip so the bar reads on a white shell.
  barBg: "\x1b[48;2;235;235;235m",
  // Pale lavender (#e6e2f0) instead of near-white gray: still a light block,
  // but the user message now stands out from the white shell.
  userBg: "\x1b[48;2;230;226;240m",
  userText: "\x1b[30m",
  toolTitle: "\x1b[38;2;139;0;0m",
  toolCommand: "\x1b[38;2;0;70;110m",
  toolSection: "\x1b[38;2;50;60;70m",
  toolOutput: "\x1b[38;2;64;64;64m",
  outputKey: "\x1b[38;2;0;70;110m",
  outputString: "\x1b[38;2;40;80;20m",
  outputNumber: "\x1b[38;2;110;60;0m",
  outputLiteral: "\x1b[38;2;90;30;120m",
  outputPunct: "\x1b[38;2;62;62;62m",
  outputAdded: "\x1b[38;2;40;80;20m",
  outputRemoved: "\x1b[38;2;140;20;20m",
  outputMetric: "\x1b[38;2;110;60;0m",
  outputLabel: "\x1b[38;2;64;64;64m",
  mdHeading: "\x1b[38;2;110;60;0m",
  mdLink: "\x1b[38;2;0;68;136m",
  mdCode: "\x1b[38;2;139;0;0m",
  mdCodeBlock: "\x1b[38;2;50;70;20m",
  mdCodeBlockBorder: "\x1b[38;2;62;62;62m",
  mdQuote: "\x1b[38;2;64;64;64m",
  mdQuoteBorder: "\x1b[38;2;62;62;62m",
  mdHr: "\x1b[38;2;62;62;62m",
  mdListBullet: "\x1b[38;2;139;0;0m",
  // Sign-off review block: the panel is self-contained, so the white shell
  // gets the same very dark purple fill and light lavender text as the dark
  // shell — the light lavender strip it replaces washed the whole chat row.
  signoffBorder: "\x1b[38;2;176;142;222m", // #b08ede — purple outline
  signoffBg: "\x1b[48;2;33;26;61m",        // #211a3d — very dark purple fill
  signoffTitle: "\x1b[1m\x1b[38;2;244;238;255m",
  signoffText: "\x1b[38;2;233;225;250m",
  signoffMuted: "\x1b[38;2;179;163;208m",
  signoffSelectedBg: "\x1b[48;2;224;206;246m",
  signoffSelectedFg: "\x1b[38;2;46;30;78m",
};

/**
 * Fallback theme for when the background could not be detected (OSC-11 fails
 * on tmux/ssh). Uses the terminal's default foreground and background for
 * every role, so text stays readable on either a light or a dark shell — the
 * previous fixed dark-gray bar was illegible under a light default foreground.
 * The status bar loses its filled strip and reads as a plain text row.
 */
export const highContrastTheme: PianoTheme = {
  variant: "high-contrast",
  accent: "\x1b[33m",
  primary: "\x1b[39m",
  dim: "\x1b[2m\x1b[39m",
  success: "\x1b[32m",
  error: "\x1b[31m",
  bold: "\x1b[1m",
  barBg: "\x1b[49m", // default background — readable on light and dark shells
  userBg: "\x1b[7m",  // reverse video: a block that works on either canvas
  userText: "\x1b[39m",
  toolTitle: "\x1b[33m",
  toolCommand: "\x1b[36m",
  toolSection: "\x1b[37m",
  toolOutput: "\x1b[2m\x1b[39m",
  outputKey: "\x1b[36m",
  outputString: "\x1b[32m",
  outputNumber: "\x1b[33m",
  outputLiteral: "\x1b[35m",
  outputPunct: "\x1b[2m\x1b[39m",
  outputAdded: "\x1b[32m",
  outputRemoved: "\x1b[31m",
  outputMetric: "\x1b[33m",
  outputLabel: "\x1b[2m\x1b[39m",
  mdHeading: "\x1b[1m\x1b[33m",
  mdLink: "\x1b[36m",
  mdCode: "\x1b[33m",
  mdCodeBlock: "\x1b[32m",
  mdCodeBlockBorder: "\x1b[2m\x1b[39m",
  mdQuote: "\x1b[2m\x1b[39m",
  mdQuoteBorder: "\x1b[2m\x1b[39m",
  mdHr: "\x1b[2m\x1b[39m",
  mdListBullet: "\x1b[33m",
  // Sign-off review block: the panel carries its own fixed colours (very dark
  // purple fill, purple outline, light lavender text), so the fallback shows
  // the same bordered panel as the real themes.
  signoffBorder: "\x1b[38;2;176;142;222m", // #b08ede — purple outline
  signoffBg: "\x1b[48;2;33;26;61m",        // #211a3d — very dark purple fill
  signoffTitle: "\x1b[1m\x1b[38;2;244;238;255m",
  signoffText: "\x1b[38;2;233;225;250m",
  signoffMuted: "\x1b[38;2;179;163;208m",
  signoffSelectedBg: "\x1b[48;2;224;206;246m",
  signoffSelectedFg: "\x1b[38;2;46;30;78m",
};

// ── Background / theme detection ──────────────────────────────────────────────

/** Parse an OSC-11 background reply into "#rrggbb", or null if not understood. */
export function parseBackgroundQuery(s: string): string | null {
  // eslint-disable-next-line no-control-regex -- OSC-11 escape sequence
  const rgb = s.match(/\x1b\]11;rgb:([0-9a-fA-F]{4})\/([0-9a-fA-F]{4})\/([0-9a-fA-F]{4})/);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((v) => parseInt(v?.slice(0, 2) ?? "", 16));
    const hex = [r, g, b]
      .map((v) => (Number.isNaN(v) || v === undefined ? 0 : v).toString(16).padStart(2, "0"))
      .join("");
    return `#${hex}`;
  }
  // eslint-disable-next-line no-control-regex -- OSC-11 escape sequence
  const hex = s.match(/\x1b\]11;#?([0-9a-fA-F]{6})/);
  if (hex) return `#${hex[1]?.toLowerCase()}`;
  return null;
}

/** Perceived luminance of a "#rrggbb" color, 0 (black) … 255 (white). */
export function luminance(hex: string): number {
  const m = (hex.replace("#", "").match(/../g) ?? []).map((v) => parseInt(v, 16));
  const [r, g, b] = [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0];
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Pick a theme for a background luminance. */
export function themeForLuminance(luma: number): PianoTheme {
  return luma > 128 ? lightTheme : darkTheme;
}

/** Resolve a theme from env: PIANO_THEME override, or COLORFGBG shell hint. */
function themeFromEnv(env: Record<string, string | undefined>): PianoTheme | null {
  const t = env.PIANO_THEME?.trim().toLowerCase();
  if (t === "light") return lightTheme;
  if (t === "dark") return darkTheme;
  if (t === "high-contrast" || t === "hc" || t === "highcontrast") return highContrastTheme;
  // COLORFGBG: "fg;bg" where 0=black … 15=bright-white. bg ≥ 7 → light shell.
  const cfbg = env.COLORFGBG;
  if (cfbg) {
    const bg = parseInt(cfbg.split(";")[1] ?? cfbg.split(";")[0] ?? "", 10);
    if (!Number.isNaN(bg)) return bg >= 7 ? lightTheme : darkTheme;
  }
  return null;
}

/**
 * Ask the terminal for its background colour via OSC-11 and resolve a theme
 * from the reply. Returns `null` when the terminal does not answer in time
 * (tmux/ssh without passthrough, dumb terminals) — the caller then falls back
 * to the env-only path.
 *
 * The query is `\x1b]11;?\x07`; most modern terminals answer with
 * `\x1b]11;rgb:RRRR/GGGG/BBBB\x07` which `parseBackgroundQuery` understands.
 */
export function queryBackgroundColor(timeoutMs = 200): Promise<string | null> {
  return new Promise((resolve) => {
    if (!stdin.isTTY || !stdout.isTTY) return resolve(null);
    const onData = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const hex = parseBackgroundQuery(text);
      if (hex !== null) finish(hex);
    };
    const finish = (hex: string | null) => {
      clearTimeout(timer);
      stdin.off("data", onData);
      // Restore the mode we found; the TUI sets raw itself when it starts.
      if (wasRaw !== undefined && stdin.setRawMode) stdin.setRawMode(wasRaw);
      resolve(hex);
    };
    const wasRaw = stdin.isRaw ?? false;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.on("data", onData);
    // OSC-11 background colour query (BEL-terminated).
    stdout.write("\x1b]11;?\x07");
    const timer = setTimeout(() => finish(null), timeoutMs);
    timer.unref?.();
  });
}

/**
 * Full theme resolution: explicit env override first, then the detected
 * terminal background, then the dark-oriented fallback (which is where tmux
 * and ssh land when OSC-11 is unavailable).
 */
export function resolveTheme(
  env: Record<string, string | undefined> = process.env,
  backgroundHex: string | null = null,
): PianoTheme {
  const fromEnv = themeFromEnv(env);
  if (fromEnv !== null) return fromEnv;
  if (backgroundHex !== null) return themeForLuminance(luminance(backgroundHex));
  return highContrastTheme;
}

/** Resolve the configured theme from environment hints without terminal I/O. */
export function detectTheme(env: Record<string, string | undefined> = process.env): PianoTheme {
  return resolveTheme(env, null);
}

// ── `/btw` side screen ────────────────────────────────────────────────────────

/** The identity colours `/btw`'s screen puts in place of the mission's brand.
 *
 * Only the roles that carry the brand are listed: the semantic ones (error,
 * success, JSON/diff syntax) keep the mission theme's values, so a tool result
 * still reads the same way on both screens. Everything derived from `accent`
 * (tool titles, markdown code and bullets, list markers, caret) follows the
 * accent below without being repeated here. */
interface SideIdentity {
  accent: string;
  primary: string;
  dim: string;
  barBg: string;
  userBg: string;
  userText: string;
  /** Tool command previews and markdown headings: the one warm accent, kept
   * apart from the accent so a command still stands out from its tool name. */
  warm: string;
  mdLink: string;
}

const SIDE_IDENTITY: Record<PianoThemeVariant, SideIdentity> = {
  // Teal workbench. Chosen as far from the mission's dark red as a dark theme
  // gets: the accent, the user-message block, the trajectory panel's background
  // and the editor border all change family, so the screen cannot be mistaken
  // for the run even at a glance.
  dark: {
    accent: "\x1b[38;2;45;212;191m",   // #2dd4bf — teal
    primary: "\x1b[38;2;227;253;255m", // #e3fdff — pale cyan, still white-ish text
    dim: "\x1b[38;2;126;167;173m",     // #7ea7ad — slate teal
    barBg: "\x1b[48;2;10;47;53m",      // #0a2f35 — deep teal strip
    userBg: "\x1b[48;2;15;70;80m",     // #0f4650 — teal user block
    userText: "\x1b[38;2;227;253;255m",
    warm: "\x1b[38;2;242;193;78m",     // #f2c14e — amber
    mdLink: "\x1b[38;2;127;216;208m",  // #7fd8d0
  },
  // Dark teal on white: enough contrast to read as text, far enough from the
  // mission's dark red that the two screens never look alike.
  light: {
    accent: "\x1b[38;2;0;112;124m",    // #00707c
    primary: "\x1b[38;2;11;43;48m",    // #0b2b30
    dim: "\x1b[38;2;74;107;112m",      // #4a6b70
    barBg: "\x1b[48;2;214;238;241m",   // #d6eef1 — pale teal strip
    userBg: "\x1b[48;2;203;232;236m",  // #cbe8ec
    userText: "\x1b[38;2;11;43;48m",
    warm: "\x1b[38;2;138;90;0m",       // #8a5a00
    mdLink: "\x1b[38;2;15;95;104m",    // #0f5f68
  },
  // The fallback is hit when the background is unknown, so the side screen
  // also leans on default foreground/background rather than a fixed dark fill.
  // Reverse video keeps the bar a visible strip on either canvas and marks it
  // as the side's own surface next to the mission's plain default-background bar.
  "high-contrast": {
    accent: "\x1b[36m",
    primary: "\x1b[39m",
    dim: "\x1b[2m\x1b[36m",
    barBg: "\x1b[7m",
    userBg: "\x1b[7m",
    userText: "\x1b[39m",
    warm: "\x1b[93m",
    mdLink: "\x1b[36m",
  },
};

/**
 * Palette for `/btw`'s side screen, derived from the mission theme it replaces.
 *
 * A new object every call: the two screens hold their own theme for the whole
 * session, so nothing may be shared that a later switch could overwrite. Only
 * the brand roles move — the contrast class (and therefore legibility on the
 * developer's shell) is inherited, not re-guessed.
 */
export function sideTheme(base: PianoTheme): PianoTheme {
  const side = SIDE_IDENTITY[base.variant];
  return {
    ...base,
    accent: side.accent,
    primary: side.primary,
    dim: side.dim,
    barBg: side.barBg,
    userBg: side.userBg,
    userText: side.userText,
    toolTitle: side.accent,
    mdCode: side.accent,
    mdListBullet: side.accent,
    toolCommand: side.warm,
    mdHeading: side.warm,
    mdLink: side.mdLink,
  };
}
