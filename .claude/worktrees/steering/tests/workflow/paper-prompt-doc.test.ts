import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileWorkerContract, validateWorkerContract } from "../../packages/contract/src/index.js";

/** The author writes `PROMPT.md` once, by hand, and `paper-prepare` reads it as
 * the answer key for the whole run. That makes it a second copy of the brief
 * contract, and a second copy is only safe if something checks it: a template
 * that has drifted from the schema is worse than no template, because the agent
 * would take the drifted values verbatim. These cases validate the template's
 * embedded `prompt.json` block against the real contract, and assert that every
 * field the contract *requires* is a field the template tells the author to
 * fill in. */
const TEMPLATE = join(process.cwd(), "recipes", "workflows", "paper-writing.PROMPT.md");

async function loadTemplate() {
  return readFile(TEMPLATE, "utf8");
}

/** The fenced `json` block that is the machine-readable answer key. It is the
 * one after the "machine-readable answer key" heading: the prose sections above
 * it also carry small `json` snippets to show the reader a shape, and taking the
 * first block would silently validate one of those instead. */
function embeddedJson(source: string): unknown {
  const heading = source.indexOf("machine-readable answer key");
  if (heading === -1) throw new Error("the template has no answer-key section");
  const open = source.indexOf("```json", heading);
  if (open === -1) throw new Error("the answer-key section has no fenced json block");
  const start = open + "```json\n".length;
  const end = source.indexOf("\n```", start);
  if (end === -1) throw new Error("the answer key's fenced json block is not closed");
  return JSON.parse(source.slice(start, end));
}

describe("the paper-writing preparation document", () => {
  it("carries a prompt.json that satisfies the real paper-brief contract", async () => {
    const contractPath = join(process.cwd(), "recipes", "paper-prepare", "contract.json");
    const compiled = compileWorkerContract(await readFile(contractPath, "utf8"), contractPath);

    const result = validateWorkerContract(compiled, embeddedJson(await loadTemplate()));
    if (!result.success) {
      const message = (result as unknown as { error?: { message?: string } }).error?.message;
      expect.fail(`PROMPT.md's prompt.json is not a valid paper-brief: ${message ?? JSON.stringify(result)}`);
    }
  });

  it("lists the brief's required fields as things the author must fill in", async () => {
    const contractPath = join(process.cwd(), "recipes", "paper-prepare", "contract.json");
    const manifest = JSON.parse(await readFile(contractPath, "utf8")) as {
      schema: { required: readonly string[] };
    };
    const source = await loadTemplate();
    const prompt = embeddedJson(source) as Record<string, unknown>;

    // Every required field has to be named somewhere in the template, or an
    // author following it produces a brief that cannot validate.
    for (const field of manifest.schema.required) {
      expect(prompt, `required field "${field}" is missing from prompt.json`).toHaveProperty(field);
    }

    // Three of those fields belong to the agent, not the author, and the
    // template must say so: an author who edits `open_assumptions` is writing a
    // claim about the run rather than an instruction to it.
    expect(await loadTemplate()).toMatch(/agent's report, not yours/i);

    // The two fields whose absence is unrecoverable later in the run, because
    // nothing downstream can invent them: the state directory the loop keeps its
    // memory in, and the reference papers it optimizes against.
    expect(prompt.manuscript).toHaveProperty("state_dir");
    expect(prompt.reference_papers).toBeInstanceOf(Array);
    expect((prompt.reference_papers as unknown[]).length).toBeGreaterThan(0);
  });

  it("explains the run to its reader, not only the schema", async () => {
    const source = await loadTemplate();

    // A field list is not a document. The template has to say why each value
    // matters, or an author cannot judge what to put in it.
    for (const explanation of [
      "state_dir",
      "compile",
      "experiment_commands",
      "methodology",
      "evaluation",
      "figure grammar",
    ]) {
      expect(source, `the template never explains ${explanation}`).toContain(explanation);
    }
    // And it has to warn about the failure the whole workflow was built to
    // avoid: an uncheckable contribution, and a number with no source.
    expect(source).toMatch(/no evaluation artifact/i);
    expect(source).toMatch(/no source|no command or file/i);
  });

  it("keeps the reference papers and the write target apart", async () => {
    const source = await loadTemplate();
    const prompt = embeddedJson(source) as {
      manuscript: { root: string };
      reference_papers: readonly { path: string; why: string; read_only?: boolean }[];
      scaffold: Record<string, unknown>;
    };

    // The failure this guards: a run pointed at a finished paper "improves" it
    // for hours, every contract validates, and the output reads as a lightly
    // edited duplicate of the reference. Nothing downstream can tell a new paper
    // from someone else's paper, so the separation has to be asserted here.
    for (const reference of prompt.reference_papers) {
      expect(reference.read_only, `${reference.path} must be declared read-only`).toBe(true);
      // A `why` that says what to take invites content reuse; it must say what
      // the paper is a standard *for*.
      expect(reference.why).toMatch(/standard|grammar|arc|budget|layout|prose/i);
      expect(
        reference.path.startsWith(prompt.manuscript.root),
        `${reference.path} must not live inside the write target ${prompt.manuscript.root}`,
      ).toBe(false);
    }

    // The write target must be somewhere the agent creates, not "." — a root of
    // "." makes the reference papers' parent directory the manuscript, which is
    // how they end up inside the write scope.
    expect(prompt.manuscript.root).not.toBe(".");
    expect(prompt.scaffold).toHaveProperty("reference_disjoint");
    expect(prompt.scaffold).toHaveProperty("build_verified");
  });

  it("tells the agent to find the template and prove the scaffold builds", async () => {
    const source = await readFile(
      join(process.cwd(), "recipes", "paper-prepare", "skills", "paper-prepare", "SKILL.md"),
      "utf8",
    );
    // Scaffolding is a job, not an incidental: it needs its own procedure, the
    // instruction to follow the reference repos' *construction method*, the rule
    // against copying their content, and a build that is verified to work.
    expect(source).toMatch(/prepare the workspace/i);
    expect(source).toMatch(/find the template/i);
    expect(source).toMatch(/construction method/i);
    expect(source).toMatch(/copy the template, never a reference paper/i);
    expect(source).toMatch(/build works|build_verified/i);
    expect(source).toMatch(/read-only/i);
  });

  it("states the standard-versus-content distinction in prepare's agents.md", async () => {
    const agents = await readFile(
      join(process.cwd(), "recipes", "paper-prepare", "agents.md"),
      "utf8",
    );
    // The worker's context file is the one place that is always loaded, so the
    // distinction has to be there and has to be blunt.
    expect(agents).toMatch(/reference papers are standards, not content/i);
    expect(agents).toMatch(/read-only/i);
    expect(agents).toMatch(/disjoint/i);
    expect(agents).toMatch(/prepare the workspace/i);
  });

  it("says where the agent put the document, so the run can be audited", async () => {
    const source = await readFile(
      join(process.cwd(), "recipes", "paper-prepare", "skills", "paper-prepare", "SKILL.md"),
      "utf8",
    );
    // The skill must look for the document before it asks anything, and must
    // record the outcome either way — "nobody wrote one" is information.
    expect(source).toContain("PROMPT.md");
    expect(source).toMatch(/before anything else/i);
    expect(source).toContain("prompt_doc");
  });
});
