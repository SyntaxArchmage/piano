import { describe, expect, it } from "vitest";
import { darkTheme, highContrastTheme, lightTheme } from "../../packages/cli/src/theme.js";
import { formatToolOutput } from "../../packages/cli/src/tool-output.js";

const th = darkTheme;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** The visible text with every colour removed, for content assertions. */
function plain(text: string): string {
  return text.replace(ANSI, "");
}

/** Assert the segment is painted with exactly this token and reset after. */
function painted(token: string, text: string): string {
  return `${token}${text}\x1b[0m`;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Every fixture below is a real tool result captured from ~/.piano/runs; the run
// id is recorded with each so a reviewer can find the original.

/** run 20260903T225140-dd2469 — pi worker writing a setup record. */
const SETUP_RECORD = '{"stage": "setup", "entry": "setup.py", "digest": "sha256:e677aa6bdbab995a224edb81822ce75e2c523388083800637d505265921ac696", "timestamp": "2026-09-03T22:52:14.061651+00:00"}';

/** run 20260905T144132-848406 — a measured round. Exercises nested objects,
 * numbers, booleans and a string that itself contains a newline. */
const MEASURED_ROUND = `{
  "version": 1,
  "target": {
    "operator": "matmul",
    "shape": "512x512x512",
    "dtype": "f32"
  },
  "compile": {
    "passed": true,
    "exit_code": 0,
    "command": "nvcc -O3 -std=c++17 -o .piano-build/matmul matmul.cu"
  },
  "numeric_check": {
    "passed": true,
    "tolerance": 1.0,
    "max_error": 0.0047783549,
    "method": "combined abs+rel (torch.allclose semantics) vs CPU reference"
  },
  "output": "max_rel_error=0.0047783549\\nVERIFY: PASS",
  "verdict": "pass",
  "measured_at": "2026-09-05T14:49:38.932528+00:00"
}`;

/** run 20260903T183827-7723fd — metrics, then JSON, then a lowercase exit
 * marker: one result, three data kinds. */
const MIXED_METRICS_JSON_EXIT = [
  "max_rel_error=0.0047783549",
  "VERIFY: PASS",
  '{"status": "ready", "target": {"operator": "matmul", "shape": "512x512x512", "dtype": "f32"}, "device": {"name": "NVIDIA GeForce RTX 3070", "architecture": "8.6"}}',
  "exit=0",
].join("\n");

/** run 20260903T183827-7723fd — `ls -l` of the workspace root. */
const LISTING = [
  "total 964",
  "drwxr-xr-x 2 albert albert   4096 Sep  4 02:38 .",
  "drwxr-xr-x 3 albert albert   4096 Sep  4 02:38 ..",
  "-rwxr-xr-x 1 albert albert 977088 Sep  4 02:38 matmul",
].join("\n");

/** run 20260903T183827-7723fd — `cat -n` of the workspace Makefile. */
const NUMBERED_FILE = [
  "1\t.PHONY: setup compile verify bench profile",
  "2\t",
  "3\tsetup:",
  "4\t\tpython3 setup.py",
  "5\t",
  "6\tcompile:",
].join("\n");

/** run 20260906T020130-113f51 — a diff with pi's exit trailer. */
const DIFF = [
  "--- state/current-best.cu\t2026-09-06 10:19:21.099551467 +0800",
  "+++ candidates/iter-003.cu\t2026-09-06 10:13:12.978565047 +0800",
  "@@ -25,7 +25,7 @@",
  " __global__ void matmul_kernel(const float* __restrict__ a,",
  "-  __shared__ float tile_a[kTile][kStageK + 1];",
  "+  __shared__ float tile_a[kTile][kStageK];",
  "   __shared__ float tile_b[kStageK][kTile];",
  "[exit code: 1]",
].join("\n");

/** run 20260909T143908-590fe9 — vitest output from a focused run. */
const TEST_SUMMARY = [
  " RUN  v2.1.9 /home/albert/workspace/piano",
  "",
  " \u2713 tests/tui/pause-exit-resume.test.ts (3 tests) 2297ms",
  " \u00d7 tests/tui/broken.test.ts (1 test) 40ms",
  "",
  " Test Files  2 passed (2)",
  "      Tests  19 passed (19)",
].join("\n");

describe("formatToolOutput JSON", () => {
  it("expands a real single-line record into readable lines", () => {
    const out = formatToolOutput(SETUP_RECORD, th);
    const lines = plain(out).split("\n");
    // The recorded body is one 173-character line; the rendering must break it
    // at its structure rather than at the terminal width.
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toBe("{");
    expect(lines.at(-1)).toBe("}");
    expect(plain(out)).toContain('"stage": "setup"');
    expect(out).not.toContain(SETUP_RECORD);
  });

  it("indents nested objects by depth", () => {
    const lines = plain(formatToolOutput(MEASURED_ROUND, th)).split("\n");
    expect(lines).toContain('  "target": {');
    expect(lines).toContain('    "operator": "matmul",');
    const close = lines.indexOf("  },");
    expect(close).toBeGreaterThan(0);
  });

  it("gives keys, strings, numbers, literals and punctuation their own colours", () => {
    const out = formatToolOutput('{"version": 1, "passed": true, "name": "x", "none": null}', th);
    expect(out).toContain(painted(th.outputKey, '"version"'));
    expect(out).toContain(painted(th.outputNumber, "1"));
    expect(out).toContain(painted(th.outputLiteral, "true"));
    expect(out).toContain(painted(th.outputString, '"x"'));
    expect(out).toContain(painted(th.outputLiteral, "null"));
    expect(out).toContain(painted(th.outputPunct, "{"));
    // Four distinct colour roles, not one flat colour for the whole body.
    const tokens = new Set([th.outputKey, th.outputNumber, th.outputLiteral, th.outputString]);
    expect(tokens.size).toBe(4);
  });

  it("keeps a newline inside a JSON string escaped on one line", () => {
    // The real `output` field is "max_rel_error=...\nVERIFY: PASS". Splitting on
    // that newline would fabricate structure the payload does not have.
    const lines = plain(formatToolOutput(MEASURED_ROUND, th)).split("\n");
    const outputLine = lines.find((line) => line.includes("VERIFY: PASS"));
    expect(outputLine).toBeDefined();
    expect(outputLine).toContain('"output": "max_rel_error=0.0047783549\\nVERIFY: PASS"');
  });

  it("inlines a short array of primitives and expands a longer one", () => {
    const short = formatToolOutput('{"kernels": ["naive", "tiled"]}', th);
    expect(plain(short)).toContain('"kernels": ["naive", "tiled"]');
    // Past the readability budget the array expands instead of wrapping: an
    // inlined array that the TUI has to wrap reads worse than an expanded one.
    const long = formatToolOutput(`{"rows": [${Array.from({ length: 40 }, (_, i) => i).join(", ")}]}`, th);
    expect(plain(long).split("\n").length).toBeGreaterThan(3);
    expect(plain(long)).not.toContain("[0, 1, 2");
  });

  it("expands an array that holds objects", () => {
    const out = formatToolOutput('{"strategies": [{"id": "a"}, {"id": "b"}]}', th);
    expect(plain(out)).toContain('"strategies": [');
    expect(plain(out)).toContain('"id": "a"');
  });

  it("renders empty containers compactly", () => {
    const out = formatToolOutput('{"a": {}, "b": []}', th);
    expect(plain(out)).toContain('"a": {}');
    expect(plain(out)).toContain('"b": []');
    expect(formatToolOutput("{}", th)).toBe(painted(th.outputPunct, "{}"));
    expect(formatToolOutput("[]", th)).toBe(painted(th.outputPunct, "[]"));
  });

  it("renders a top-level array", () => {
    const out = formatToolOutput('["alpha", "beta"]', th);
    expect(plain(out)).toBe('["alpha", "beta"]');
    expect(out).toContain(painted(th.outputString, '"alpha"'));
  });

  it("stops at the payload's end so a trailing marker keeps its own colour", () => {
    const out = formatToolOutput(`${SETUP_RECORD}\nexit=0`, th);
    const lines = plain(out).split("\n");
    expect(lines.at(-1)).toBe("exit=0");
    expect(out).toContain(painted(th.success, "exit=0"));
    // The JSON above it is still expanded.
    expect(lines.length).toBeGreaterThan(2);
  });

  it("leaves an unbalanced brace as plain output", () => {
    const broken = '{"stage": "setup", "entry": "setup.py"';
    const out = formatToolOutput(broken, th);
    expect(out).toBe(painted(th.toolOutput, broken));
  });

  it("leaves braces that never parse as JSON to the line rules", () => {
    // Closing braces are not enough: an unquoted key is not JSON, and treating
    // it as such would drop the separators and reflow unrelated output.
    const notJson = "{not: valid json}";
    expect(formatToolOutput(notJson, th)).toBe(painted(th.toolOutput, notJson));
  });

  it("does not let a brace inside a string end the payload early", () => {
    // The corpus has shell commands and CUDA source inside JSON strings, so the
    // brace scan has to track string state.
    const out = formatToolOutput('{"cmd": "echo } | tee", "escaped": "say \\"hi\\""}', th);
    expect(plain(out)).toContain('"cmd": "echo } | tee"');
    expect(plain(out)).toContain('"escaped": "say \\"hi\\""');
    expect(plain(out).split("\n").at(-1)).toBe("}");
  });

  it("renders two consecutive payloads as two blocks", () => {
    const out = formatToolOutput('{"a": 1}\n{"b": 2}', th);
    expect(plain(out).split("\n")).toEqual(["{", '  "a": 1', "}", "{", '  "b": 2', "}"]);
  });
});

describe("formatToolOutput non-JSON kinds", () => {
  it("colours a real diff by line role and keeps added lines findable", () => {
    const out = formatToolOutput(DIFF, th);
    expect(out).toContain(painted(th.outputAdded, "+  __shared__ float tile_a[kTile][kStageK];"));
    expect(out).toContain(painted(th.outputRemoved, "-  __shared__ float tile_a[kTile][kStageK + 1];"));
    expect(out).toContain(painted(th.outputKey, "@@ -25,7 +25,7 @@"));
    expect(out).toContain(painted(th.outputPunct, "--- state/current-best.cu\t2026-09-06 10:19:21.099551467 +0800"));
    expect(out).toContain(painted(th.outputPunct, "+++ candidates/iter-003.cu\t2026-09-06 10:13:12.978565047 +0800"));
    // The context line stays in the neutral body colour.
    expect(out).toContain(painted(th.toolOutput, "   __shared__ float tile_b[kStageK][kTile];"));
    // A non-zero exit trailer is an error, not a metric.
    expect(out).toContain(painted(th.error, "[exit code: 1]"));
  });

  it("colours metric lines and single out pass/fail verdicts", () => {
    const out = formatToolOutput("max_rel_error=0.0047783549\nVERIFY: PASS\nVERIFY_EXIT=0", th);
    expect(out).toContain(painted(th.outputLabel, "max_rel_error") + painted(th.outputPunct, "=") + painted(th.outputMetric, "0.0047783549"));
    expect(out).toContain(painted(th.outputLabel, "VERIFY") + painted(th.outputPunct, ": ") + painted(th.success, "PASS"));
    // A `*_EXIT` assignment is an exit status, so the whole line carries it —
    // the same treatment `exit=0` gets.
    expect(out).toContain(painted(th.success, "VERIFY_EXIT=0"));
  });

  it("keeps a metric colour when the key only contains the letters of exit", () => {
    // `nonexits` must not be read as an exit status just because it embeds
    // `exit`; only a key ending in exit/exit_code is one.
    const out = formatToolOutput("nonexits=5", th);
    expect(out).toContain(painted(th.outputLabel, "nonexits") + painted(th.outputPunct, "=") + painted(th.outputMetric, "5"));
    expect(out).not.toBe(painted(th.error, "nonexits=5"));
  });

  it("marks failing verdicts and non-zero exits as errors", () => {
    const out = formatToolOutput("VERIFY: FAIL\nEXIT=1", th);
    expect(out).toContain(painted(th.error, "FAIL"));
    expect(out).toContain(painted(th.error, "EXIT=1"));
  });

  it("mutes listing metadata and highlights the entry name", () => {
    const out = formatToolOutput(LISTING, th);
    expect(out).toContain(painted(th.outputPunct, "total 964"));
    expect(out).toContain(painted(th.outputString, "matmul"));
    // Permissions, ownership and the timestamp are metadata; the size is the
    // column a reader skims, so it gets the number colour.
    expect(out).toContain(painted(th.outputPunct, "-rwxr-xr-x 1 albert albert "));
    expect(out).toContain(painted(th.outputNumber, "977088"));
    expect(out).toContain(painted(th.dim, " Sep  4 02:38 "));
    // A regular file starts with `-`; it must not be read as a diff removal.
    expect(out).not.toContain(painted(th.outputRemoved, "-rwxr-xr-x"));
  });

  it("reads an ls row whose timestamp column is a year, and an @ permission suffix", () => {
    // GNU `ls` prints a year instead of HH:MM for entries older than six months,
    // and appends `@` when a file carries extended attributes.
    const out = formatToolOutput("-rw-r--r--@ 1 albert albert 1024 Dec 14  2025 old.log", th);
    expect(out).toContain(painted(th.outputNumber, "1024"));
    expect(out).toContain(painted(th.outputString, "old.log"));
    expect(out).toContain(painted(th.outputPunct, "-rw-r--r--@ 1 albert albert "));
  });

  it("mutes cat -n line numbers and keeps the source line uncoloured", () => {
    const out = formatToolOutput(NUMBERED_FILE, th);
    expect(out).toContain(`${painted(th.outputLabel, "1")}${painted(th.outputPunct, "\t")}.PHONY: setup compile verify bench profile`);
    // The Makefile recipe's own leading tab belongs to the content, not the
    // line-number gutter.
    expect(out).toContain(`${painted(th.outputLabel, "4")}${painted(th.outputPunct, "\t")}\tpython3 setup.py`);
  });

  it("mutes a section header line and still formats the payload under it", () => {
    // The real corpus wraps report payloads in `===== path =====` banners; the
    // banner must not stop the JSON underneath from being read.
    const out = formatToolOutput("===== reports/verify.json =====\n{\"verdict\": \"pass\"}", th);
    const lines = plain(out).split("\n");
    expect(lines[0]).toBe("===== reports/verify.json =====");
    expect(lines[1]).toBe("{");
    expect(out).toContain(painted(th.outputKey, '"verdict"'));
  });

  it("colours diff file headers, index lines and the no-newline marker", () => {
    const out = formatToolOutput([
      "diff --git a/matmul.cu b/matmul.cu",
      "index 20d316d..87fb8d5 100644",
      "--- a/matmul.cu",
      "+++ b/matmul.cu",
      "\\ No newline at end of file",
    ].join("\n"), th);
    expect(out).toContain(painted(th.outputPunct, "diff --git a/matmul.cu b/matmul.cu"));
    expect(out).toContain(painted(th.outputPunct, "index 20d316d..87fb8d5 100644"));
    expect(out).toContain(painted(th.outputPunct, "\\ No newline at end of file"));
  });

  it("colours test output by pass/fail and mutes the summary", () => {
    const out = formatToolOutput(TEST_SUMMARY, th);
    expect(out).toContain(painted(th.success, " \u2713 tests/tui/pause-exit-resume.test.ts (3 tests) 2297ms"));
    expect(out).toContain(painted(th.error, " \u00d7 tests/tui/broken.test.ts (1 test) 40ms"));
    expect(out).toContain(painted(th.success, "      Tests  19 passed (19)"));
  });

  it("treats a count line with no verdict as a summary, not a result", () => {
    // A runner that reports a count without a pass/fail word must not be read
    // as either verdict; the muted metric colour is the fallback.
    const out = formatToolOutput("Tests 42 total", th);
    expect(out).toBe(painted(th.outputMetric, "Tests 42 total"));
  });

  it("falls back to the neutral body colour for ordinary text", () => {
    const out = formatToolOutput("Makefile\nmatmul.cu", th);
    expect(out).toBe(`${painted(th.toolOutput, "Makefile")}\n${painted(th.toolOutput, "matmul.cu")}`);
  });

  it("formats each kind independently in one mixed result", () => {
    // This is the shape that decides the design: a whole-body classifier would
    // label the payload one thing and miss the other two.
    const out = formatToolOutput(MIXED_METRICS_JSON_EXIT, th);
    const lines = plain(out).split("\n");
    expect(lines[0]).toBe("max_rel_error=0.0047783549");
    expect(lines[1]).toBe("VERIFY: PASS");
    expect(lines.at(-1)).toBe("exit=0");
    expect(lines.length).toBeGreaterThan(4);
    expect(out).toContain(painted(th.outputMetric, "0.0047783549"));
    expect(out).toContain(painted(th.outputKey, '"status"'));
    expect(out).toContain(painted(th.success, "exit=0"));
  });
});

describe("formatToolOutput passthrough", () => {
  it("returns an empty body unchanged", () => {
    expect(formatToolOutput("", th)).toBe("");
  });

  it("does not re-colour a body that already carries escapes", () => {
    // Piano did not author these codes; wrapping them would corrupt the width
    // bookkeeping the TUI's wrapper depends on.
    const authored = "\x1b[32mgreen\x1b[0m\n-rwxr-xr-x 1 a b 1 Jan  1 00:00 x";
    expect(formatToolOutput(authored, th)).toBe(authored);
  });

  it("preserves blank lines", () => {
    expect(plain(formatToolOutput("a\n\nb", th))).toBe("a\n\nb");
  });
});

describe("tool output palette", () => {
  it("defines every output role in all three themes", () => {
    const roles = [
      "outputKey", "outputString", "outputNumber", "outputLiteral",
      "outputPunct", "outputAdded", "outputRemoved", "outputMetric", "outputLabel",
    ] as const;
    for (const theme of [darkTheme, lightTheme, highContrastTheme]) {
      for (const role of roles) {
        expect(theme[role]).toBeTruthy();
      }
      // The four JSON scalar roles carry the per-type colouring, so they must
      // stay distinguishable from each other in every theme.
      const jsonRoles = [theme.outputKey, theme.outputString, theme.outputNumber, theme.outputLiteral];
      expect(new Set(jsonRoles).size).toBe(4);
      // Added and removed must never share a colour, or a diff reads as one
      // block. `outputString`/`outputAdded` and `outputNumber`/`outputMetric`
      // are intentionally the same role seen twice.
      expect(theme.outputAdded).not.toBe(theme.outputRemoved);
    }
  });
});
