import { RST, type PianoTheme } from "./theme.js";

/** Renders one tool result body with a format and a colour per data kind.
 *
 * The kinds are the ones actually present in recorded runs (27k tool results
 * across ~/.piano/runs): plain text, `ls -l` listings, `KEY=value` metrics,
 * `cat -n` numbered files, test summaries, diffs and JSON. Bodies are often a
 * *mixture* of these — a metrics line, a JSON payload and an exit marker in one
 * result — so classification is per line rather than per body. A whole-body
 * decision would mislabel most real output. */

/** A body that already carries SGR escapes is passed through untouched: Piano
 * did not author those codes, and re-colouring around them would corrupt the
 * width bookkeeping the TUI's wrapper relies on. */
const HAS_ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`);

/** `[exit code: 1]` (pi's bash trailer) and `exit=0` / `VERIFY_EXIT=0` /
 * `EXIT_CODE=2` (grader scripts) all end a result and carry the status a reader
 * checks first. The key must actually end in `exit`/`exit_code`, so an
 * unrelated metric that merely contains those letters (`nonexits=5`) keeps its
 * metric colour. The status is group 1 in both patterns. */
const EXIT_BRACKET = /^\[exit code: (\d+)\]$/i;
const EXIT_ASSIGN = /^(?:[A-Za-z_]+_)?exit(?:_code)?=(\d+)$/i;

/** `KEY=value` / `KEY: value`. The key must look like a variable name so prose
 * containing a colon is not mistaken for a metric. */
const METRIC_LINE = /^([A-Za-z_][A-Za-z0-9_.-]*)(\s*[=:]\s*)(.*\S)$/;

/** Verdicts get the success/error colours rather than the neutral metric
 * colour, because they are what a reader scans for. */
const PASSING_VALUE = /^(pass|passed|ok|true|yes|fine|complete|completed)$/i;
const FAILING_VALUE = /^(fail|failed|error|false|no|incomplete)$/i;

/** `cat -n` output. The real corpus writes the number then a tab. */
const NUMBERED_LINE = /^(\s*\d+)(\t)(.*)$/;

/** An `ls -l` row, split into the four parts worth colouring separately: the
 * metadata before the size, the size, the timestamp, and the entry name. The
 * trailing `@`/`+` of an extended-attribute row is part of the permissions, and
 * the timestamp column may be a year instead of a clock. */
const LISTING_ROW = /^([-dlbcps][-rwxsStT]{9}[@+]?\s+\d+\s+\S+\s+\S+\s+)(\d+)(\s+\S+\s+\d+\s+[\d:]{4,5}\s+)(.*)$/;
const LISTING_TOTAL = /^total \d+$/;

/** Diff lines. The `+++`/`---` file headers are checked before the generic
 * added/removed prefixes so they read as headers, not as content. */
const DIFF_HEADER = /^(diff --git |index |Index: |new file mode |deleted file mode |similarity index |rename )/;
const DIFF_FILE = /^(--- |\+\+\+ )/;
const DIFF_HUNK = /^@@/;

/** Vitest passes a `✓`/`×` marker per row and a `Tests N passed` summary. */
const TEST_PASS = /[✓✔]|[0-9]+ passed/;
const TEST_FAIL = /[×✗✘]|[0-9]+ failed/;
const TEST_SUMMARY = /\bTests?\s+\d+/;

function paint(color: string, text: string): string {
  return `${color}${text}${RST}`;
}

/** Append a separator as its own painted segment, never spliced into the line's
 * colour scope: keeping each line a sequence of independently terminated pieces
 * means no piece is left without a reset, and a caller can still find any one
 * of them by its literal text. */
function withSuffix(line: string, th: PianoTheme, suffix: string): string {
  return `${line}${paint(th.outputPunct, suffix)}`;
}

/** The capture groups of an already-successful match, typed as a fixed-length
 * tuple.
 *
 * Every pattern here declares its groups unconditionally, so a group cannot be
 * absent once `exec` has returned a match — but TypeScript cannot know that, and
 * the `?? ""` fallbacks it forces are branches no input can ever take. Stating
 * the invariant once, here, keeps the classifiers free of them; a mismatched
 * group count would surface as `undefined` in the rendered output.
 */
function captures<T extends readonly string[]>(matched: RegExpExecArray): T {
  return matched.slice(1) as unknown as T;
}

/** The line at `index`, which every caller has already bounded by the array's
 * length. */
function lineAt(lines: readonly string[], index: number): string {
  return lines[index] as string;
}

/** One JSON scalar as coloured text. `JSON.stringify` renders every scalar form
 * (`"a"`, `1`, `true`, `null`), so the runtime type only selects the colour. */
function jsonScalar(value: unknown, th: PianoTheme): string {
  if (typeof value === "string") return paint(th.outputString, JSON.stringify(value));
  if (typeof value === "number") return paint(th.outputNumber, JSON.stringify(value));
  if (typeof value === "boolean") return paint(th.outputLiteral, String(value));
  return paint(th.outputLiteral, String(value));
}

/** Short arrays of primitives read better on one line than expanded. Returns
 * undefined when the array should be expanded instead. */
function inlineJson(value: readonly unknown[], th: PianoTheme): string | undefined {
  if (value.some((item) => item !== null && typeof item === "object")) return undefined;
  const parts = value.map((item) => jsonScalar(item, th));
  // The width budget is a readability bound, not a hard wrap: the TUI wraps the
  // rendered row anyway, and a wrapped inline array is harder to read than an
  // expanded one.
  if (value.map((item) => JSON.stringify(item)).join(", ").length > 72) return undefined;
  return `${paint(th.outputPunct, "[")}${parts.join(paint(th.outputPunct, ", "))}${paint(th.outputPunct, "]")}`;
}

/** Pretty-print a parsed JSON value into coloured text, indented to `indent`.
 *
 * The value is walked directly rather than reformatted with a regex over
 * `JSON.stringify` output: a string containing braces or quotes would defeat
 * the regex and mis-colour the line, and the corpus has those (embedded CUDA
 * source, shell commands, `"max_rel_error=...\nVERIFY: PASS"`). Walking the
 * value also keeps a newline *inside* a JSON string escaped on one line instead
 * of fabricating structure the payload does not have. */
function jsonValueText(value: unknown, th: PianoTheme, indent: number): string {
  const pad = "  ".repeat(indent);
  const childPad = "  ".repeat(indent + 1);

  if (Array.isArray(value)) {
    if (value.length === 0) return paint(th.outputPunct, "[]");
    const inline = inlineJson(value, th);
    if (inline !== undefined) return inline;
    const items = value.map((item, position) => {
      const body = `${childPad}${jsonValueText(item, th, indent + 1)}`;
      return position < value.length - 1 ? withSuffix(body, th, ",") : body;
    });
    return `${paint(th.outputPunct, "[")}\n${items.join("\n")}\n${pad}${paint(th.outputPunct, "]")}`;
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return paint(th.outputPunct, "{}");
    const items = entries.map(([key, nested], position) => {
      const label = paint(th.outputKey, JSON.stringify(key));
      const entry = `${childPad}${label}${paint(th.outputPunct, ": ")}${jsonValueText(nested, th, indent + 1)}`;
      // The last entry takes no trailing comma, so the closing brace does not
      // look like it continues.
      return position < entries.length - 1 ? withSuffix(entry, th, ",") : entry;
    });
    return `${paint(th.outputPunct, "{")}\n${items.join("\n")}\n${pad}${paint(th.outputPunct, "}")}`;
  }

  return jsonScalar(value, th);
}

/** The run of lines from `start` that parses as one JSON object or array, with
 * the index of its last line. Undefined when the line does not open one.
 *
 * A JSON payload is not always alone in its result — the corpus frequently
 * appends `exit=0` or `[exit code: 1]` — so the scan extends only while the
 * candidate stays balanced and stops at the first parse that succeeds. */
function jsonBlockAt(
  lines: readonly string[],
  start: number,
): { readonly value: unknown; readonly end: number } | undefined {
  const first = lineAt(lines, start).trim();
  if (first[0] !== "{" && first[0] !== "[") return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < lines.length; index += 1) {
    for (const character of lineAt(lines, index)) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        if (inString) escaped = true;
        continue;
      }
      if (character === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (character === "{" || character === "[") depth += 1;
      else if (character === "}" || character === "]") depth -= 1;
    }
    if (depth !== 0) continue;
    try {
      const parsed: unknown = JSON.parse(lines.slice(start, index + 1).join("\n"));
      // Only objects and arrays are worth reformatting; a bare number or quoted
      // string sitting on its own line is ordinary output.
      if (parsed !== null && typeof parsed === "object") return { value: parsed, end: index };
    } catch {
      // The candidate closed its braces but is not JSON: fall through and leave
      // the line to the ordinary line rules.
    }
    return undefined;
  }
  return undefined;
}

/** `KEY=value` lines: the key is muted so the value column carries the eye. */
function metricLine(line: string, th: PianoTheme): string | undefined {
  const matched = METRIC_LINE.exec(line);
  if (matched === null) return undefined;
  const [key, separator, value] = captures<[string, string, string]>(matched);
  // `split` always yields at least one element, so the head is not optional.
  const bare = value.split(/\s+/)[0] as string;
  const color = PASSING_VALUE.test(bare)
    ? th.success
    : FAILING_VALUE.test(bare)
      ? th.error
      : th.outputMetric;
  return `${paint(th.outputLabel, key)}${paint(th.outputPunct, separator)}${paint(color, value)}`;
}

/** The status a result ends on, painted by whether the code is zero. */
function exitLine(line: string, th: PianoTheme): string | undefined {
  const bracket = EXIT_BRACKET.exec(line);
  const assignment = bracket === null ? EXIT_ASSIGN.exec(line) : null;
  // `Number("")` is 0, not NaN, so the captured digits are tested for presence
  // first: reading an absent capture as a zero exit code would paint every
  // unrelated line as a successful exit.
  const digits = bracket?.[1] ?? assignment?.[1];
  if (digits === undefined) return undefined;
  return paint(Number(digits) === 0 ? th.success : th.error, line);
}

/** An `ls -l` row: metadata and timestamps muted so the entry name stands out,
 * and the size in the number colour because it is the column a reader skims. */
function listingLine(line: string, th: PianoTheme): string | undefined {
  if (LISTING_TOTAL.test(line)) return paint(th.outputPunct, line);
  const matched = LISTING_ROW.exec(line);
  if (matched === null) return undefined;
  const [metadata, size, timestamp, name] = captures<[string, string, string, string]>(matched);
  return paint(th.outputPunct, metadata)
    + paint(th.outputNumber, size)
    + paint(th.dim, timestamp)
    + paint(th.outputString, name);
}

function diffLine(line: string, th: PianoTheme): string | undefined {
  if (DIFF_HUNK.test(line)) return paint(th.outputKey, line);
  if (DIFF_HEADER.test(line) || DIFF_FILE.test(line)) return paint(th.outputPunct, line);
  // The marker colours the whole line, which keeps the raw text contiguous so a
  // caller can still find the line by its literal content.
  if (line.startsWith("+")) return paint(th.outputAdded, line);
  if (line.startsWith("-")) return paint(th.outputRemoved, line);
  if (line.startsWith("\\")) return paint(th.outputPunct, line);
  return undefined;
}

function testLine(line: string, th: PianoTheme): string | undefined {
  if (TEST_FAIL.test(line)) return paint(th.error, line);
  if (TEST_PASS.test(line)) return paint(th.success, line);
  if (TEST_SUMMARY.test(line)) return paint(th.outputMetric, line);
  return undefined;
}

function numberedLine(line: string, th: PianoTheme): string | undefined {
  const matched = NUMBERED_LINE.exec(line);
  if (matched === null) return undefined;
  const [number, gutter, content] = captures<[string, string, string]>(matched);
  return `${paint(th.outputLabel, number)}${paint(th.outputPunct, gutter)}${content}`;
}

/** Colour one already-classified line.
 *
 * Order is the design: the shape-specific parsers run before the generic prefix
 * rules, because a regular file in an `ls -l` row also starts with `-` and a
 * metrics line also contains `=`. Letting the diff rule see an `ls -l` row
 * first painted every ordinary file as a removed diff line. */
function formatLine(line: string, th: PianoTheme): string {
  return exitLine(line, th)
    ?? listingLine(line, th)
    ?? numberedLine(line, th)
    ?? diffLine(line, th)
    ?? metricLine(line, th)
    ?? testLine(line, th)
    ?? paint(th.toolOutput, line);
}

/**
 * Format a tool result body for the expanded transcript view.
 *
 * The result may span several lines; the caller renders it into one padded
 * block, so every continuation line keeps the detail column.
 */
export function formatToolOutput(text: string, th: PianoTheme): string {
  if (text === "" || HAS_ANSI.test(text)) return text;
  const lines = text.split("\n");
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const block = jsonBlockAt(lines, index);
    if (block === undefined) {
      out.push(formatLine(lineAt(lines, index), th));
      index += 1;
      continue;
    }
    out.push(jsonValueText(block.value, th, 0));
    // Resume after the lines the block consumed.
    index = block.end + 1;
  }
  return out.join("\n");
}
