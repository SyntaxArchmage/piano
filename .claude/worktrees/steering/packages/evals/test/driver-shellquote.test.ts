import { describe, expect, it } from "vitest";
import { shellQuote, substituteCommand } from "../src/driver.js";

// ISSUE-018 regression: a prompt containing an apostrophe (e.g. "candidate's")
// used to be escaped as `'\"'\"'` which embedded stray backslashes and left an
// unbalanced single quote. bash then split one logical `-p <prompt>` argv into
// many tokens, so the CLI rejected the arg and bash raised "unexpected EOF".
describe("shellQuote (ISSUE-018)", () => {
  it("escapes a single quote with the POSIX close/reopen idiom", () => {
    expect(shellQuote("candidate's core")).toBe("'candidate'\\''s core'");
  });

  it("keeps a multi-line prompt with an apostrophe as ONE argv token", () => {
    const prompt = "do not edit the grader's\n`verify.py` files.";
    // Keep this unit test process-free: runShell exercises the real bash
    // boundary, while this deterministic contract also works in restricted
    // test runners that cannot create child processes.
    expect(shellQuote(prompt)).toBe("'do not edit the grader'\\''s\n`verify.py` files.'");
  });
});

// Same argv-integrity family as ISSUE-018: substituteCommand inserted the
// quoted prompt via String.replaceAll with a plain string replacement, so `$`
// patterns inside any case prompt (`$&` in sed/regex mission text, or a
// `$'` apostrophe idiom) were expanded — `$&` injected the matched
// `<prompt>` placeholder back into the launched command.
describe("substituteCommand", () => {
  it("substitutes placeholder keys with literal values", () => {
    expect(substituteCommand("piano --workflow <workflow> -p <prompt>", {
      workflow: "'/work/gpu.yml'",
      prompt: "'optimize GEMM'",
    })).toBe("piano --workflow '/work/gpu.yml' -p 'optimize GEMM'");
  });

  it("keeps dollar patterns in the substituted value literal", () => {
    const value = shellQuote("run `sed 's/x/y/'` then echo $& and $' quoting");
    const command = substituteCommand("piano -p <prompt>", { prompt: value });
    // The old string-replacement form expanded `$&` into the matched
    // `<prompt>` placeholder and dropped `` $` ``/`$'` semantics.
    expect(command).toBe(`piano -p ${value}`);
    expect(command).not.toContain("<prompt>");
    expect(command).toContain("$&");
  });

  it("never rescans substituted values for other placeholders", () => {
    const prompt = shellQuote("set the <workflow> placeholder explicitly");
    const command = substituteCommand("piano -p <prompt> --workflow <workflow>", {
      prompt,
      workflow: "'/work/gpu.yml'",
    });
    // Sequential per-key replacement would re-enter the prompt text on the
    // later <workflow> pass and silently rewrite the user's task.
    expect(command).toBe(`piano -p ${prompt} --workflow '/work/gpu.yml'`);
  });

  it("returns the template unchanged for an empty variable set", () => {
    expect(substituteCommand("piano -p <prompt>", {})).toBe("piano -p <prompt>");
  });
});
