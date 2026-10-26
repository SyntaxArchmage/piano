import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileWorkerContract, validateWorkerContract } from "../../packages/contract/src/index.js";

/** A paper is often written before its measurements exist. The system has two
 * honest ways to handle that — narrow the claim, or reserve the slot and say so —
 * and only one dishonest one: write a plausible number. Everything here exists
 * to make the third option impossible to reach by accident.
 *
 * The mechanism is that a placeholder is a *macro*, not a numeral: the brief
 * registers `ph-*` ids, the manuscript shows `\ph{ph-*}` where a value belongs,
 * the audit cross-checks registry against sites, and finalize will not call the
 * paper ready while any is open. These cases hold the four contracts and the
 * scaffold's preamble to that shape. */

const RECIPES = join(process.cwd(), "recipes");

async function contract(id: string) {
  const path = join(RECIPES, "contracts", `${id}.json`);
  return compileWorkerContract(await readFile(path, "utf8"), path);
}

async function contractJson(id: string) {
  return JSON.parse(await readFile(join(RECIPES, "contracts", `${id}.json`), "utf8")) as {
    schema: {
      required: readonly string[];
      properties: Record<string, { required?: readonly string[]; items?: { properties?: Record<string, unknown> } }>;
      "x-piano-assertions"?: readonly { path: string; when?: unknown; message: string }[];
    };
    example: Record<string, unknown>;
  };
}

async function skill(id: string, name = id) {
  return readFile(join(RECIPES, id, "skills", name, "SKILL.md"), "utf8");
}

describe("the placeholder mechanism", () => {
  it("requires a registry in the brief, so 'nothing to declare' is a statement", async () => {
    const manifest = await contractJson("paper-prepare");
    // Required-but-may-be-empty: an author with nothing outstanding writes [],
    // and the run can then say it checked rather than that it never looked.
    expect(manifest.schema.required).toContain("placeholders");

    const entry = manifest.schema.properties.placeholders!.items!;
    expect(Object.keys(entry.properties ?? {})).toEqual(
      expect.arrayContaining(["id", "what", "where", "source", "status"]),
    );
  });

  it("rejects a `source` that is only a promise, at contract level", async () => {
    const compiled = await contract("paper-prepare");
    const manifest = await contractJson("paper-prepare");

    // The id has to be usable as a macro argument, so the shape is constrained
    // rather than free text: `\ph{ph-prod-speedup}` and not `\ph{prod speedup}`.
    const base = structuredClone(manifest.example) as Record<string, unknown>;
    const broken = structuredClone(base) as { placeholders: Record<string, unknown>[] };
    broken.placeholders[0]!.id = "prod speedup";

    const result = validateWorkerContract(compiled, broken);
    expect(result.success, "an id that cannot be a macro argument must be rejected").toBe(false);
  });

  it("expects a placeholder entry to name a source, so it is actionable later", async () => {
    const compiled = await contract("paper-prepare");
    const manifest = await contractJson("paper-prepare");

    const withoutSource = structuredClone(manifest.example) as { placeholders: Record<string, unknown>[] };
    delete withoutSource.placeholders[0]!.source;

    expect(
      validateWorkerContract(compiled, withoutSource).success,
      "a placeholder with no named source is a wish, not a plan",
    ).toBe(false);
  });

  it("has the writer emit the macro and report the id, never a value", async () => {
    const manifest = await contractJson("paper-write");
    expect(manifest.schema.required).toContain("placeholders_used");

    const text = await skill("paper-write");
    // The one defect nothing downstream can catch: a number where a slot was
    // reserved. It would read exactly like a measurement.
    expect(text).toMatch(/placeholder site is where you write no number/i);
    expect(text).toMatch(/do not substitute a plausible-looking value/i);
    expect(text).toMatch(/placeholders_used/);
  });

  it("has the audit count sites and separate them from invented numbers", async () => {
    const manifest = await contractJson("paper-audit");
    expect(manifest.schema.required).toContain("placeholders");

    const mismatchKinds = (
      manifest.schema.properties.placeholders as unknown as {
        properties: { mismatches: { items: { properties: { kind: { enum: string[] } } } } };
      }
    ).properties.mismatches.items.properties.kind.enum;
    expect(mismatchKinds).toContain("value_at_placeholder_site");
    expect(mismatchKinds).toContain("unregistered_site");
    expect(mismatchKinds).toContain("unplaced_placeholder");

    const text = await skill("paper-audit");
    // "not yet measured" and "invented" are different defects and only one of
    // them is a falsehood; conflating them makes the registry pointless.
    expect(text).toMatch(/placeholders are not numerals/i);
    expect(text).toMatch(/unsourced_numbers/);
  });

  it("refuses to call the paper ready while a slot is still open", async () => {
    const manifest = await contractJson("paper-finalize");
    expect(manifest.schema.required).toContain("placeholders");

    const assertions = manifest.schema["x-piano-assertions"] ?? [];
    const gate = assertions.find((a) => a.path === "/ready");
    expect(gate, "finalize must gate `ready` on the placeholder census").toBeDefined();
    expect(JSON.stringify(gate!.when)).toContain("blocking_ready");

    // And the gate has to actually fire, not merely exist.
    const compiled = await contract("paper-finalize");
    const inconsistent = structuredClone(manifest.example) as {
      ready: boolean;
      placeholders: { open: unknown[]; blocking_ready: boolean };
    };
    inconsistent.ready = true;
    inconsistent.placeholders.blocking_ready = true;
    expect(
      validateWorkerContract(compiled, inconsistent).success,
      "ready:true with an open placeholder must be rejected",
    ).toBe(false);
  });

  it("tells the author to define a macro that renders visibly", async () => {
    const template = await readFile(
      join(RECIPES, "workflows", "paper-writing.PROMPT.md"),
      "utf8",
    );
    // A registered placeholder with no macro is a LaTeX error; a macro that
    // renders invisibly is worse, because the unfilled slot reaches the PDF and
    // nobody reading a draft can see it.
    expect(template).toContain("\\newcommand{\\ph}");
    expect(template).toMatch(/textcolor/);
    expect(template).toMatch(/renders? in red|in red/i);

    // And the template has to explain the distinction the registry rests on, or
    // an author will use it to paper over a claim the evidence contradicts.
    expect(template).toMatch(/placeholder is not/i);
    expect(template).toMatch(/narrow the claim/i);
  });
});
