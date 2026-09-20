import { readFile, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileWorkerContract,
  validateWorkerContract,
  workerContractGuidance,
  WorkerContractLoadError,
} from "../src/worker-contract.js";
import {
  VALIDATION_EXAMPLES,
  isContractName,
  validateContract,
  type ContractName,
} from "../src/index.js";

function mutationPaths(value: unknown, prefix: readonly string[] = []): readonly (readonly string[])[] {
  if (typeof value !== "object" || value === null) return [];
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry] as const)
    : Object.entries(value);
  return entries.flatMap(([key, entry]) => {
    const path = [...prefix, key];
    return [path, ...mutationPaths(entry, path)];
  });
}

function objectPaths(value: unknown, prefix: readonly string[] = []): readonly (readonly string[])[] {
  if (typeof value !== "object" || value === null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => objectPaths(entry, [...prefix, String(index)]));
  }
  return [
    prefix,
    ...Object.entries(value).flatMap(([key, entry]) => objectPaths(entry, [...prefix, key])),
  ];
}

function containerAt(value: unknown, path: readonly string[]): Record<string, unknown> | unknown[] {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (typeof current === "object" && current !== null) current = (current as Record<string, unknown>)[segment];
    else throw new Error(`invalid mutation path /${path.join("/")}`);
  }
  if (typeof current !== "object" || current === null) throw new Error(`invalid mutation container /${path.join("/")}`);
  return current as Record<string, unknown> | unknown[];
}

function setAt(value: unknown, path: readonly string[], replacement: unknown): void {
  const parent = containerAt(value, path.slice(0, -1));
  const key = path.at(-1)!;
  if (Array.isArray(parent)) parent[Number(key)] = replacement;
  else parent[key] = replacement;
}

/** Frozen from the pre-worker-contract implementation validator. Keep this
 * independent of VALIDATION_EXAMPLES: changing the current legacy schema must
 * not silently change this migration oracle. */
const HISTORICAL_TOPSOP_IMPLEMENTATION_FIXTURE = {
  status: "compiled",
  variable: "pass2-pass1-row-interleave-2deep",
  diff_summary: "interleave pass2 over pass1; kernel + bench updated",
  changed_files: ["lib/op/normalize/sgl_add_add_rms_norm/gcu400/add_add_rms_norm_dte_load_impl.h"],
  compile: {
    passed: true,
    target: "topssglAddAddRmsNorm",
    so_commit: "90487eb6fa",
    so_mtime: "2026-08-31T00:00:00Z",
  },
} as const;

const HISTORICAL_CHANGED_FILE_CASES: ReadonlyArray<readonly [path: string, accepted: boolean]> = [
  ["C:foo", true],
  ["a/./b", true],
  ["a//b", true],
  ["a\\..\\b", true],
  ["..\\outside", true],
  ["\\\\server\\share\\file", true],
  ["file\0name", true],
  ["", false],
  ["   ", false],
  ["/absolute", false],
  ["C:/absolute", false],
  ["C:\\absolute", false],
  ["../outside", false],
  ["a/../outside", false],
  ["a/..", false],
];

function manifest(required = true): string {
  return JSON.stringify({
    version: 1,
    id: "latency-result",
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: ["measurement"],
      properties: {
        measurement: {
          type: "object",
          required: ["name", "unit", "direction", "samples", "best", "median", "runs", "warmup"],
          properties: {
            name: { type: "string" },
            unit: { type: "string" },
            direction: { enum: ["higher", "lower"] },
            samples: { type: "array", minItems: 1, items: { type: "number" } },
            best: { type: "number" },
            median: { type: "number" },
            runs: { type: "integer", minimum: 1 },
            warmup: { type: "integer", minimum: 0 },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    example: {
      measurement: {
        name: "latency",
        unit: "ms",
        direction: "lower",
        samples: [3, 1, 2],
        best: 1,
        median: 2,
        runs: 3,
        warmup: 1,
      },
    },
    outputs: { metrics: [{ pointer: "/measurement", format: "benchmark/v1", required }] },
  });
}

function projectionManifest(
  projections: readonly Record<string, unknown>[],
  example: unknown,
): string {
  return JSON.stringify({
    version: 1,
    id: "projection-result",
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: true,
    },
    example,
    outputs: { projections },
  });
}

function stripManifest(
  schema: Record<string, unknown>,
  example: unknown,
  id = "strip-dialect",
): string {
  return JSON.stringify({
    version: 1,
    id,
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      "x-piano-unknown-properties": "strip",
      ...schema,
    },
    example,
    outputs: { metrics: [] },
  });
}

describe("worker-local contracts", () => {
  it("validates JSON Schema and projects a direction-aware benchmark", () => {
    const contract = compileWorkerContract(manifest(), "/recipes/latency/contract.json");
    const result = validateWorkerContract(contract, {
      measurement: {
        name: "latency",
        unit: "ms",
        direction: "lower",
        samples: [8, 5, 6],
        best: 5,
        median: 6,
        runs: 3,
        warmup: 2,
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.metrics).toEqual([{
      pointer: "/measurement",
      format: "benchmark/v1",
      value: {
        protocol: "benchmark/v1",
        name: "latency",
        unit: "ms",
        direction: "lower",
        samples: [8, 5, 6],
        best: 5,
        median: 6,
        runs: 3,
        warmup: 2,
      },
    }]);
  });

  it("opts into recursive unknown-field stripping on a clone", () => {
    const contract = compileWorkerContract(JSON.stringify({
      version: 1,
      id: "normalized-result",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        "x-piano-unknown-properties": "strip",
        type: "object",
        required: ["measurement", "nested"],
        properties: {
          measurement: {
            type: "object",
            required: ["name", "unit", "direction", "samples", "best", "median", "runs", "warmup"],
            properties: {
              name: { type: "string" },
              unit: { type: "string" },
              direction: { enum: ["higher", "lower"] },
              samples: { type: "array", minItems: 1, items: { type: "number" } },
              best: { type: "number" },
              median: { type: "number" },
              runs: { type: "integer", minimum: 1 },
              warmup: { type: "integer", minimum: 0 },
            },
            additionalProperties: false,
          },
          nested: {
            type: "object",
            required: ["kept"],
            properties: { kept: { type: "string" } },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      example: {
        measurement: {
          name: "latency",
          unit: "ms",
          direction: "lower",
          samples: [3],
          best: 3,
          median: 3,
          runs: 1,
          warmup: 0,
        },
        nested: { kept: "example" },
      },
      outputs: {
        metrics: [{ pointer: "/measurement", format: "benchmark/v1" }],
        projections: [{ id: "nested", pointer: "/nested", format: "json" }],
      },
    }), "/recipes/normalized-result/contract.json");
    const payload = {
      measurement: {
        name: "latency",
        unit: "ms",
        direction: "lower",
        samples: [8, 5, 6],
        best: 5,
        median: 6,
        runs: 3,
        warmup: 2,
        ignored: "remove me",
      },
      nested: { kept: "worker", ignored: { deeply: true } },
      rootIgnored: ["remove me"],
    };
    const original = structuredClone(payload);
    const result = validateWorkerContract(contract, payload);

    expect(result).toMatchObject({
      success: true,
      value: {
        measurement: {
          name: "latency",
          unit: "ms",
          direction: "lower",
          samples: [8, 5, 6],
          best: 5,
          median: 6,
          runs: 3,
          warmup: 2,
        },
        nested: { kept: "worker" },
      },
      projections: [{ id: "nested", pointer: "/nested", format: "json", value: { kept: "worker" } }],
    });
    expect(result.success && result.metrics).toEqual([{
      pointer: "/measurement",
      format: "benchmark/v1",
      value: {
        protocol: "benchmark/v1",
        name: "latency",
        unit: "ms",
        direction: "lower",
        samples: [8, 5, 6],
        best: 5,
        median: 6,
        runs: 3,
        warmup: 2,
      },
    }]);
    expect(payload).toEqual(original);
  });

  it("strips unknown properties recursively when nested objects use default additionalProperties", () => {
    const contract = compileWorkerContract(JSON.stringify({
      version: 1,
      id: "default-recursive-strip",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        "x-piano-unknown-properties": "strip",
        type: "object",
        required: ["nested", "rows"],
        properties: {
          nested: {
            type: "object",
            required: ["kept"],
            properties: { kept: { type: "string" } },
          },
          rows: {
            type: "array",
            items: {
              type: "object",
              required: ["kept"],
              properties: { kept: { type: "number" } },
            },
          },
        },
      },
      example: { nested: { kept: "example" }, rows: [{ kept: 1 }] },
      outputs: { metrics: [] },
    }), "/recipes/default-recursive-strip/contract.json");

    const result = validateWorkerContract(contract, {
      nested: { kept: "worker", ignored: true },
      rows: [{ kept: 2, ignored: true }],
      rootIgnored: true,
    });

    expect(result).toMatchObject({
      success: true,
      value: { nested: { kept: "worker" }, rows: [{ kept: 2 }] },
    });
  });

  it("stores and guides from the normalized example while retaining the source example", () => {
    const sourceExample = {
      kept: "example",
      nested: { kept: true, removed_nested: "must not be guided" },
      removed_root: "must not be guided",
    };
    const contract = compileWorkerContract(stripManifest({
      type: "object",
      required: ["kept", "nested"],
      properties: {
        kept: { type: "string" },
        nested: {
          type: "object",
          required: ["kept"],
          properties: { kept: { type: "boolean" } },
        },
      },
    }, sourceExample, "normalized-guidance"), "/recipes/normalized-guidance/contract.json");

    expect(contract.manifest.example).toEqual(sourceExample);
    expect(JSON.parse(contract.source).example).toEqual(sourceExample);
    expect(contract.normalizedExample).toEqual({ kept: "example", nested: { kept: true } });
    expect(workerContractGuidance(contract)).toBe(JSON.stringify(contract.normalizedExample, null, 2));
    expect(workerContractGuidance(contract)).not.toContain("removed_nested");
    expect(workerContractGuidance(contract)).not.toContain("removed_root");
  });

  it("normalizes recursive root refs without losing the root object shape", () => {
    const contract = compileWorkerContract(stripManifest({
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        child: { $ref: "#" },
      },
    }, {
      name: "root",
      child: { name: "nested", ignored: true },
      ignored: true,
    }, "root-ref"), "/recipes/root-ref/contract.json");

    expect(contract.normalizedExample).toEqual({
      name: "root",
      child: { name: "nested" },
    });
    const result = validateWorkerContract(contract, {
      name: "root",
      child: { name: "nested", ignored: true },
      ignored: true,
    });
    expect(result).toMatchObject({
      success: true,
      value: { name: "root", child: { name: "nested" } },
    });
  });

  it("normalizes prefixItems using tuple schemas and the items fallback", () => {
    const contract = compileWorkerContract(stripManifest({
      type: "array",
      minItems: 2,
      prefixItems: [
        {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
        },
        {
          type: "object",
          required: ["count"],
          properties: { count: { type: "number" } },
        },
      ],
      items: {
        type: "object",
        required: ["tail"],
        properties: { tail: { type: "boolean" } },
      },
    }, [
      { name: "first", ignored: true },
      { count: 2, ignored: true },
      { tail: true, ignored: true },
    ], "prefix-items"), "/recipes/prefix-items/contract.json");

    expect(contract.normalizedExample).toEqual([
      { name: "first" },
      { count: 2 },
      { tail: true },
    ]);
    const result = validateWorkerContract(contract, [
      { name: "worker", ignored: true },
      { count: 3, ignored: true },
      { tail: false, ignored: true },
    ]);
    expect(result).toMatchObject({
      success: true,
      value: [{ name: "worker" }, { count: 3 }, { tail: false }],
    });
  });

  it("fails closed for strip schemas whose normalization cannot preserve JSON Schema semantics", () => {
    const cases: ReadonlyArray<readonly [label: string, schema: Record<string, unknown>, example: unknown, message: RegExp]> = [
      ["external ref", { properties: { value: { $ref: "other.json#/value" } } }, {}, /external or anchor \$ref/],
      ["anchor ref", { properties: { value: { $ref: "#node" } } }, {}, /external or anchor \$ref/],
      ["array contains", { type: "array", contains: { type: "string" } }, ["value"], /array-shape contains/],
      ["dependent schemas", { type: "object", dependentSchemas: { flag: { required: ["value"] } } }, {}, /dependentSchemas normalization/],
      ["unevaluated items", { type: "array", unevaluatedItems: false }, [], /unevaluatedItems is not supported/],
      ["predicate property count", {
        type: "object",
        properties: { known: { type: "string" }, other: { type: "string" } },
        if: { minProperties: 2 },
        then: { required: ["other"], properties: { other: {} } },
        else: { required: ["known"], properties: { known: {} } },
      }, { known: "example" }, /predicate minProperties/],
      ["predicate unique items", {
        type: "array",
        items: { type: "object", properties: { id: { type: "string" } } },
        if: { uniqueItems: true },
        then: {},
      }, [{ id: "example" }], /predicate uniqueItems/],
      ["predicate composite const", {
        type: "object",
        properties: { value: { type: "object", properties: { kept: { type: "string" } } } },
        if: { properties: { value: { const: { kept: "example" } } } },
        then: {},
      }, { value: { kept: "example" } }, /composite const predicates/],
      ["predicate composite enum", {
        type: "object",
        properties: { value: { type: "array", items: { type: "string" } } },
        if: { properties: { value: { enum: [["example"]] } } },
        then: {},
      }, { value: ["example"] }, /composite enum predicates/],
      ["undeclared predicate field", {
        allOf: [{ if: { properties: { hidden: { const: true } } }, then: {} }],
      }, {}, /predicates over undeclared fields/],
      ["conditional new field", {
        type: "object",
        properties: { kind: { type: "string" } },
        allOf: [{
          if: { properties: { kind: { const: "special" } }, required: ["kind"] },
          then: { properties: { only_for_special: { type: "string" } } },
        }],
      }, { kind: "ordinary" }, /conditional fields not declared/],
      ["conditional array shape", {
        allOf: [{
          if: { const: "special" },
          then: { items: { type: "string" } },
        }],
      }, "ordinary", /shape-changing conditional items/],
    ];

    for (const [label, schema, example, message] of cases) {
      expect(
        () => compileWorkerContract(stripManifest(schema, example, `strip-${label.replaceAll(" ", "-")}`), `/recipes/strip-${label}/contract.json`),
        label,
      ).toThrow(message);
    }
  });

  it("does not apply the strip dialect gate to ordinary JSON Schema contracts", () => {
    expect(() => compileWorkerContract(JSON.stringify({
      version: 1,
      id: "ordinary-contains",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "array",
        contains: { type: "string" },
      },
      example: ["value"],
      outputs: { metrics: [] },
    }), "/recipes/ordinary-contains/contract.json")).not.toThrow();

    expect(() => compileWorkerContract(JSON.stringify({
      version: 1,
      id: "ordinary-dependent-schemas",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { flag: { type: "boolean" }, value: { type: "string" } },
        dependentSchemas: { flag: { required: ["value"] } },
      },
      example: { flag: true, value: "present" },
      outputs: { metrics: [] },
    }), "/recipes/ordinary-dependent-schemas/contract.json")).not.toThrow();

  });

  it("fails closed when strip assertions depend on fields the normalizer removes", () => {
    expect(() => compileWorkerContract(stripManifest({
      type: "object",
      properties: { kept: { type: "string" } },
      "x-piano-assertions": [{
        path: "/ghost",
        message: "ghost must be bad when present",
        when: { op: "present", args: [{ path: "/ghost" }] },
        test: { op: "eq", args: [{ path: "/ghost" }, "bad"] },
      }],
    }, { kept: "example" }, "strip-assertion-unknown-field"), "/recipes/strip-assertion-unknown-field/contract.json"))
      .toThrow(/assertions\[0\] references undeclared property \/ghost/);
  });

  it("rejects unsupported nested strip keywords and unevaluatedProperties at compile time", () => {
    const nestedKeyword = JSON.parse(manifest()) as { schema: Record<string, unknown> };
    nestedKeyword.schema.properties = {
      measurement: { type: "object", "x-piano-unknown-properties": "strip" },
    };
    expect(() => compileWorkerContract(JSON.stringify(nestedKeyword), "/recipes/nested-strip/contract.json"))
      .toThrow(/only supported at the schema root/);

    const unevaluated = JSON.parse(manifest()) as { schema: Record<string, unknown> };
    unevaluated.schema["x-piano-unknown-properties"] = "strip";
    unevaluated.schema.unevaluatedProperties = false;
    expect(() => compileWorkerContract(JSON.stringify(unevaluated), "/recipes/unevaluated/contract.json"))
      .toThrow(/unevaluatedProperties is not supported/);
  });

  it("normalizes inline unions against each branch and returns the first success", () => {
    const contract = compileWorkerContract(JSON.stringify({
      version: 1,
      id: "inline-union",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        "x-piano-unknown-properties": "strip",
        anyOf: [
          {
            type: "object",
            required: ["a"],
            properties: { a: { type: "string" } },
            additionalProperties: false,
          },
          {
            type: "object",
            required: ["b"],
            properties: { b: { type: "string" } },
            additionalProperties: false,
          },
        ],
      },
      example: { a: "example" },
      outputs: { metrics: [] },
    }), "/recipes/inline-union/contract.json");
    const payload = { a: "first", b: "second", ignored: true };
    const original = structuredClone(payload);
    const result = validateWorkerContract(contract, payload);

    expect(result).toMatchObject({ success: true, value: { a: "first" } });
    expect(result.success && Object.keys(result.value as object)).toEqual(["a"]);
    expect(payload).toEqual(original);
  });

  it("keeps additionalProperties false dominant across allOf", () => {
    const contract = compileWorkerContract(JSON.stringify({
      version: 1,
      id: "all-of-additional-properties",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        "x-piano-unknown-properties": "strip",
        allOf: [
          {
            type: "object",
            properties: { kept: { type: "string" } },
            additionalProperties: false,
          },
          { type: "object", additionalProperties: true },
        ],
      },
      example: { kept: "example" },
      outputs: { metrics: [] },
    }), "/recipes/all-of-additional-properties/contract.json");
    const payload = { kept: "value", ignored: true };
    const original = structuredClone(payload);
    const result = validateWorkerContract(contract, payload);

    expect(result).toMatchObject({ success: true, value: { kept: "value" } });
    expect(payload).toEqual(original);
  });

  it("preserves an own __proto__ key without changing object prototypes", () => {
    const protoSchema = {
      type: "object",
      required: ["kept"],
      properties: { kept: { type: "string" } },
      additionalProperties: false,
    };
    const contract = compileWorkerContract(JSON.stringify({
      version: 1,
      id: "prototype-key",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        "x-piano-unknown-properties": "strip",
        type: "object",
        patternProperties: { "^__proto__$": protoSchema },
        additionalProperties: false,
      },
      example: JSON.parse('{"__proto__":{"kept":"example"}}'),
      outputs: { metrics: [] },
    }), "/recipes/prototype-key/contract.json");
    const payload = JSON.parse('{"__proto__":{"kept":"value","ignored":true},"ignored":true}') as Record<string, unknown>;
    const original = structuredClone(payload);
    const result = validateWorkerContract(contract, payload);

    expect(result.success).toBe(true);
    if (!result.success) return;
    const normalized = result.value as Record<string, unknown>;
    expect(Object.getPrototypeOf(normalized)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(normalized, "__proto__")).toBe(true);
    expect(Object.keys(normalized)).toEqual(["__proto__"]);
    expect(normalized["__proto__"]).toEqual({ kept: "value" });
    expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(payload, "__proto__")).toBe(true);
    expect(payload).toEqual(original);
  });

  it("matches legacy Zod normalization for a migrated topsop contract", async () => {
    const path = join(process.cwd(), "recipes", "topsop-setup-env", "contract.json");
    const contract = compileWorkerContract(await readFile(path, "utf8"), path);
    const payload = structuredClone(VALIDATION_EXAMPLES["topsop-env-report"]) as Record<string, unknown>;
    (payload.target as Record<string, unknown>).unknown_nested = true;
    payload.unknown_root = { ignored: true };
    const original = structuredClone(payload);
    const legacy = validateContract("topsop-env-report", payload);
    const worker = validateWorkerContract(contract, payload);

    expect(legacy.success).toBe(true);
    expect(worker.success).toBe(true);
    if (legacy.success && worker.success) expect(worker.value).toEqual(legacy.value);
    expect(payload).toEqual(original);
  });

  it("keeps unknown fields rejected when stripping is not declared", () => {
    const contract = compileWorkerContract(manifest(), "/recipes/no-normalization/contract.json");
    const payload = {
      measurement: {
        name: "latency",
        unit: "ms",
        direction: "lower",
        samples: [3],
        best: 3,
        median: 3,
        runs: 1,
        warmup: 0,
        ignored: true,
      },
      rootIgnored: true,
    };
    const original = structuredClone(payload);
    const result = validateWorkerContract(contract, payload);

    expect(result.success).toBe(false);
    expect(payload).toEqual(original);
  });

  it("projects all domain-neutral output formats", () => {
    const contract = compileWorkerContract(projectionManifest([
      { id: "message", pointer: "/message", format: "string" },
      { id: "count", pointer: "/count", format: "number" },
      { id: "enabled", pointer: "/enabled", format: "boolean" },
      { id: "tags", pointer: "/tags", format: "string-list" },
      { id: "files", pointer: "/files", format: "workspace-relative-path-list" },
      { id: "metadata", pointer: "/metadata", format: "json" },
    ], {
      message: "ok",
      count: 3,
      enabled: true,
      tags: ["one", "two"],
      files: ["src/index.ts"],
      metadata: { source: "worker" },
    }), "/recipes/projection/contract.json");

    const result = validateWorkerContract(contract, {
      message: "done",
      count: 4,
      enabled: false,
      tags: ["changed"],
      files: ["src/index.ts", "test/index.ts"],
      metadata: { source: "worker", round: 2 },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.projections).toEqual([
      { id: "message", pointer: "/message", format: "string", value: "done" },
      { id: "count", pointer: "/count", format: "number", value: 4 },
      { id: "enabled", pointer: "/enabled", format: "boolean", value: false },
      { id: "tags", pointer: "/tags", format: "string-list", value: ["changed"] },
      { id: "files", pointer: "/files", format: "workspace-relative-path-list", value: ["src/index.ts", "test/index.ts"] },
      { id: "metadata", pointer: "/metadata", format: "json", value: { source: "worker", round: 2 } },
    ]);
  });

  it("omits an optional projection when its pointer is absent", () => {
    const contract = compileWorkerContract(projectionManifest([
      { id: "optional-value", pointer: "/optional", format: "string", required: false },
    ], {}), "/recipes/projection-optional/contract.json");

    expect(contract.manifest.outputs.projections).toEqual([{
      id: "optional-value",
      pointer: "/optional",
      format: "string",
      required: false,
    }]);
    const result = validateWorkerContract(contract, {});
    expect(result).toMatchObject({ success: true, projections: [] });
  });

  it("rejects a missing required projection", () => {
    expect(() => compileWorkerContract(projectionManifest([
      { id: "required-value", pointer: "/required", format: "string" },
    ], {}), "/recipes/projection-required-example/contract.json"))
      .toThrow(/required projection "required-value"/);

    const contract = compileWorkerContract(projectionManifest([
      { id: "required-value", pointer: "/required", format: "string" },
    ], { required: "present" }), "/recipes/projection-required/contract.json");

    const result = validateWorkerContract(contract, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('required projection "required-value"');
  });

  it("rejects a projection whose value does not match its declared format", () => {
    const contract = compileWorkerContract(projectionManifest([
      { id: "count", pointer: "/count", format: "number" },
    ], { count: 1 }), "/recipes/projection-type/contract.json");

    const result = validateWorkerContract(contract, { count: "one" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('projection "count"');
  });

  it("rejects duplicate projection ids when loading a manifest", () => {
    expect(() => compileWorkerContract(projectionManifest([
      { id: "same", pointer: "/first", format: "string" },
      { id: "same", pointer: "/second", format: "string" },
    ], { first: "one", second: "two" }), "/recipes/projection-duplicate/contract.json"))
      .toThrow(/duplicate projection id/);
  });

  it("rejects unsafe workspace-relative path lists", () => {
    const contract = compileWorkerContract(projectionManifest([
      { id: "files", pointer: "/files", format: "workspace-relative-path-list" },
    ], { files: ["src/index.ts"] }), "/recipes/projection-path/contract.json");

    expect(validateWorkerContract(contract, { files: [] }).success).toBe(true);
    const unsafeFiles = [
      [""],
      ["   "],
      ["/tmp/file"],
      ["../outside"],
      ["src/../outside"],
      ["src\0file"],
      ...(sep === "\\" ? [
        ["C:relative"],
        ["..\\outside"],
        ["src\\..\\outside"],
        ["\\\\server\\share\\file"],
        ["C:\\tmp\\file"],
      ] : []),
    ];
    for (const files of unsafeFiles) {
      const result = validateWorkerContract(contract, { files });
      expect(result.success, JSON.stringify(files)).toBe(false);
    }
  });

  it("keeps topsop implementation changed_files parity with the legacy validator", async () => {
    const path = join(process.cwd(), "recipes", "topsop-implement", "contract.json");
    const contract = compileWorkerContract(await readFile(path, "utf8"), path);
    const paths = [
      "topsop/lib/kernel.tops",
      "topsop\\lib\\kernel.tops",
      "../outside.tops",
      "..\\outside.tops",
      "src/../outside.tops",
      "src\\..\\outside.tops",
      "C:relative.tops",
      "C:\\outside.tops",
    ];

    for (const changedFile of paths) {
      const payload = {
        ...(structuredClone(VALIDATION_EXAMPLES["topsop-implementation-report"]) as Record<string, unknown>),
        changed_files: [changedFile],
      };
      const legacy = validateContract("topsop-implementation-report", payload);
      const worker = validateWorkerContract(contract, payload);
      expect(worker.success, `${changedFile} worker result`).toBe(legacy.success);
      if (legacy.success && worker.success) expect(worker.value).toEqual(legacy.value);
    }
  });

  it("preserves the frozen historical topsop path acceptance set, normalization, and projections", async () => {
    const path = join(process.cwd(), "recipes", "topsop-implement", "contract.json");
    const contract = compileWorkerContract(await readFile(path, "utf8"), path);

    for (const [changedFile, accepted] of HISTORICAL_CHANGED_FILE_CASES) {
      const payload = structuredClone(HISTORICAL_TOPSOP_IMPLEMENTATION_FIXTURE) as Record<string, unknown>;
      payload.changed_files = [changedFile];
      payload.ignored = "legacy zod and worker normalization must strip this";
      (payload.compile as Record<string, unknown>).ignored = true;
      const original = structuredClone(payload);

      const legacy = validateContract("topsop-implementation-report", payload);
      const worker = validateWorkerContract(contract, payload);
      expect(legacy.success, `${changedFile} historical legacy result`).toBe(accepted);
      expect(worker.success, `${changedFile} worker result`).toBe(accepted);
      expect(payload).toEqual(original);
      if (!accepted || !legacy.success || !worker.success) continue;

      const expectedValue = structuredClone(HISTORICAL_TOPSOP_IMPLEMENTATION_FIXTURE) as Record<string, unknown>;
      expectedValue.changed_files = [changedFile];
      expect(legacy.value).toEqual(expectedValue);
      expect(worker.value).toEqual(expectedValue);
      expect(worker.projections).toEqual([
        { id: "workflow.status", pointer: "/status", format: "string", value: "compiled" },
        { id: "workspace.changed-files", pointer: "/changed_files", format: "string-list", value: [changedFile] },
        { id: "build.target", pointer: "/compile/target", format: "string", value: "topssglAddAddRmsNorm" },
        { id: "change.summary", pointer: "/diff_summary", format: "string", value: "interleave pass2 over pass1; kernel + bench updated" },
      ]);
    }
  });

  it("rejects semantically inconsistent benchmark values", () => {
    const contract = compileWorkerContract(manifest(), "/recipes/latency/contract.json");
    const result = validateWorkerContract(contract, {
      measurement: {
        name: "latency",
        unit: "ms",
        direction: "lower",
        samples: [8, 5, 6],
        best: 8,
        median: 6,
        runs: 3,
        warmup: 2,
      },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.message).toContain("direction-aware best sample");
  });

  it("accepts display-rounded best/median and canonicalizes them to the exact sample values", () => {
    // Mirrors the tournament eval regression (run 20260904T040537-d76348,
    // tune/iter-4/tune.race/slot-1): the worker serialized median 6.085539
    // for the exact sample median 6.0855385, and the 16-ULP cross-check
    // burned a repair turn on that display rounding. Rounding-plausible
    // derived values (here 3- and 4-decimal-style rounding of median and
    // best) must pass, and the projected metric must carry the EXACT
    // recomputation so downstream comparison never sees rounded numbers.
    const contract = compileWorkerContract(manifest(), "/recipes/latency/contract.json");
    const result = validateWorkerContract(contract, {
      measurement: {
        name: "latency",
        unit: "ms",
        direction: "lower",
        samples: [6.0, 6.0855385, 7.0],
        best: 6.0001,
        median: 6.086,
        runs: 3,
        warmup: 2,
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.metrics).toEqual([{
      pointer: "/measurement",
      format: "benchmark/v1",
      value: {
        protocol: "benchmark/v1",
        name: "latency",
        unit: "ms",
        direction: "lower",
        samples: [6.0, 6.0855385, 7.0],
        best: 6.0,
        median: 6.0855385,
        runs: 3,
        warmup: 2,
      },
    }]);
  });

  it("rejects a median fabricated beyond display-rounding plausibility", () => {
    // The guard's real domain: a derived value that is not the sample
    // recomputation at any display precision stays rejected.
    const contract = compileWorkerContract(manifest(), "/recipes/latency/contract.json");
    const result = validateWorkerContract(contract, {
      measurement: {
        name: "latency",
        unit: "ms",
        direction: "lower",
        samples: [6.0, 6.0855385, 7.0],
        best: 6.0,
        median: 6.09,
        runs: 3,
        warmup: 2,
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.message).toContain("median does not match samples");
  });

  it("checks examples while compiling and permits an absent optional metric", () => {
    const invalidExample = JSON.parse(manifest()) as Record<string, unknown>;
    invalidExample.example = {};
    expect(() => compileWorkerContract(JSON.stringify(invalidExample), "/recipes/bad/contract.json"))
      .toThrow(WorkerContractLoadError);

    delete invalidExample.example;
    expect(() => compileWorkerContract(JSON.stringify(invalidExample), "/recipes/missing-example/contract.json"))
      .toThrow(WorkerContractLoadError);

    const missingDialect = JSON.parse(manifest()) as { schema: Record<string, unknown> };
    delete missingDialect.schema.$schema;
    expect(() => compileWorkerContract(JSON.stringify(missingDialect), "/recipes/missing-dialect/contract.json"))
      .toThrow(WorkerContractLoadError);

    const optional = JSON.parse(manifest(false)) as Record<string, unknown>;
    optional.schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {},
      additionalProperties: false,
    };
    optional.example = {};
    const contract = compileWorkerContract(JSON.stringify(optional), "/recipes/optional/contract.json");
    expect(validateWorkerContract(contract, {})).toMatchObject({ success: true, metrics: [] });
  });

  it("evaluates domain-neutral cross-field assertions declared by the worker", () => {
    const source = JSON.stringify({
      version: 1,
      id: "derived-total",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        required: ["left", "right", "total"],
        properties: {
          left: { type: "number" },
          right: { type: "number" },
          total: { type: "number" },
        },
        additionalProperties: false,
        "x-piano-assertions": [{
          path: "/total",
          message: "total must equal left + right",
          test: {
            op: "eq",
            args: [
              { path: "/total" },
              { op: "add", args: [{ path: "/left" }, { path: "/right" }] },
            ],
          },
        }],
      },
      example: { left: 2, right: 3, total: 5 },
      outputs: { metrics: [] },
    });
    const contract = compileWorkerContract(source, "/recipes/derived-total/contract.json");

    expect(validateWorkerContract(contract, { left: 2, right: 3, total: 5 }).success).toBe(true);
    const invalid = validateWorkerContract(contract, { left: 2, right: 3, total: 6 });
    expect(invalid.success).toBe(false);
    if (!invalid.success) expect(invalid.error.message).toContain("total must equal left + right");
  });

  it("does not let an inherited path hijack evaluation of an operation AST", () => {
    const contract = compileWorkerContract(JSON.stringify({
      version: 1,
      id: "polluted-operation-ast",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        required: ["left", "right", "total"],
        properties: {
          left: { type: "number" },
          right: { type: "number" },
          total: { type: "number" },
        },
        additionalProperties: false,
        "x-piano-assertions": [{
          path: "/total",
          message: "total must equal left + right",
          test: {
            op: "eq",
            args: [
              { path: "/total" },
              { op: "add", args: [{ path: "/left" }, { path: "/right" }] },
            ],
          },
        }],
      },
      example: { left: 2, right: 3, total: 5 },
      outputs: { metrics: [] },
    }), "/recipes/polluted-operation-ast/contract.json");
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "path");
    try {
      Object.defineProperty(Object.prototype, "path", { configurable: true, value: "/total" });
      expect(validateWorkerContract(contract, { left: 2, right: 3, total: 5 }).success).toBe(true);
    } finally {
      if (descriptor === undefined) delete (Object.prototype as Record<string, unknown>).path;
      else Object.defineProperty(Object.prototype, "path", descriptor);
    }
  });

  it("rejects malformed worker-declared assertion expressions at load time", () => {
    const source = JSON.parse(manifest()) as { schema: Record<string, unknown> };
    source.schema["x-piano-assertions"] = [{
      path: "/measurement",
      message: "invalid expression",
      test: { op: "divide", args: [{ path: "/measurement" }] },
    }];

    expect(() => compileWorkerContract(JSON.stringify(source), "/recipes/bad-assertion/contract.json"))
      .toThrow(/divide expects 2 argument/);

    source.schema["x-piano-assertions"] = [{
      path: "/measurement",
      message: "prototype property is not an operator",
      test: { op: "toString", args: [] },
    }];
    expect(() => compileWorkerContract(JSON.stringify(source), "/recipes/prototype-assertion/contract.json"))
      .toThrow(/op "toString" is not supported/);
  });

  it("requires assertion fields to be own properties", () => {
    const source = JSON.parse(manifest()) as { schema: Record<string, unknown> };
    source.schema["x-piano-assertions"] = [{
      path: "/measurement",
      message: "polluted test must not count",
    }];
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "test");
    try {
      Object.defineProperty(Object.prototype, "test", { configurable: true, value: true });
      expect(() => compileWorkerContract(JSON.stringify(source), "/recipes/polluted-assertion/contract.json"))
        .toThrow(/test is required/);
    } finally {
      if (descriptor === undefined) delete (Object.prototype as Record<string, unknown>).test;
      else Object.defineProperty(Object.prototype, "test", descriptor);
    }
  });

  it("does not enable root stripping from an inherited manifest keyword", () => {
    const source = JSON.stringify({
      version: 1,
      id: "inherited-strip-keyword",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        required: ["kept"],
        properties: { kept: { type: "string" } },
        additionalProperties: true,
      },
      example: { kept: "example", inheritedStripMustNotRemove: true },
      outputs: { metrics: [] },
    });
    const contract = compileWorkerContract(source, "/recipes/inherited-strip-keyword/contract.json");
    const keyword = "x-piano-unknown-properties";
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, keyword);
    try {
      Object.defineProperty(Object.prototype, keyword, { configurable: true, value: "strip" });
      const result = validateWorkerContract(contract, { kept: "value", inheritedStripMustNotRemove: true });
      expect(result).toMatchObject({
        success: true,
        value: { kept: "value", inheritedStripMustNotRemove: true },
      });
    } finally {
      if (descriptor === undefined) delete (Object.prototype as Record<string, unknown>)[keyword];
      else Object.defineProperty(Object.prototype, keyword, descriptor);
    }
  });

  it("fails closed when an applicable assertion condition cannot be evaluated", () => {
    const contract = compileWorkerContract(JSON.stringify({
      version: 1,
      id: "conditional-check",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { guard: { type: "number" } },
        additionalProperties: false,
        "x-piano-assertions": [{
          path: "/guard",
          message: "guarded invariant",
          when: { op: "gt", args: [{ path: "/guard" }, 0] },
          test: true,
        }],
      },
      example: { guard: 1 },
      outputs: { metrics: [] },
    }), "/recipes/conditional-check/contract.json");

    expect(validateWorkerContract(contract, { guard: 0 }).success).toBe(true);
    const missing = validateWorkerContract(contract, {});
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.message).toContain("condition could not be evaluated");
  });

  it("compiles every shipped worker contract", async () => {
    const recipes = join(process.cwd(), "recipes");
    const workers = await readdir(recipes, { withFileTypes: true });
    const contracts = workers
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(recipes, entry.name, "contract.json"));
    const loaded: string[] = [];
    for (const path of contracts) {
      try {
        loaded.push(compileWorkerContract(await readFile(path, "utf8"), path).manifest.id);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    expect(loaded).toContain("coding-candidate");
    expect(loaded).toContain("coding-review");
    expect(loaded).toContain("architecture-design");
    expect(loaded).toContain("cuda-round-result-v2");
    expect(loaded).toContain("triton-round-result");
    expect(loaded).toContain("tournament-optimization-proposal");
    for (const id of [
      "topsop-env-report",
      "topsop-explore-report",
      "topsop-implementation-report",
      "topsop-estimate-report",
      "topsop-optimize-report",
      "topsop-verify-report",
      "topsop-theory-report",
      "topsop-profile-report",
      "optimization-proposal",
      "topsop-round-result",
      "verification-report",
      "summary-report",
    ]) {
      expect(loaded).toContain(id);
    }
  });

  it("keeps every shipped worker reusing a legacy id equivalent to its named validator", async () => {
    const replacements: readonly unknown[] = [null, "", "wrong", -1, 0, 1.5, false, true, [], {}];
    const recipes = join(process.cwd(), "recipes");
    const workers = await readdir(recipes, { withFileTypes: true });
    const replacementsByLegacyId: Array<readonly [worker: string, legacy: ContractName]> = [];
    for (const entry of workers) {
      if (!entry.isDirectory()) continue;
      const path = join(recipes, entry.name, "contract.json");
      try {
        const contract = compileWorkerContract(await readFile(path, "utf8"), path);
        if (isContractName(contract.manifest.id)) {
          replacementsByLegacyId.push([entry.name, contract.manifest.id]);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    expect(replacementsByLegacyId.length).toBeGreaterThan(0);

    for (const [worker, legacy] of replacementsByLegacyId) {
      const path = join(process.cwd(), "recipes", worker, "contract.json");
      const contract = compileWorkerContract(await readFile(path, "utf8"), path);
      const payload = structuredClone(VALIDATION_EXAMPLES[legacy]);
      const cases: Array<readonly [label: string, value: unknown]> = [["example", payload]];
      for (const mutationPath of mutationPaths(payload)) {
        const parent = containerAt(payload, mutationPath.slice(0, -1));
        if (!Array.isArray(parent)) {
          const missing = structuredClone(payload);
          delete (containerAt(missing, mutationPath.slice(0, -1)) as Record<string, unknown>)[mutationPath.at(-1)!];
          cases.push([`delete /${mutationPath.join("/")}`, missing]);
        }
        for (const replacement of replacements) {
          const mutated = structuredClone(payload);
          setAt(mutated, mutationPath, structuredClone(replacement));
          cases.push([`set /${mutationPath.join("/")}=${JSON.stringify(replacement)}`, mutated]);
        }
      }
      for (const objectPath of objectPaths(payload)) {
        const mutated = structuredClone(payload);
        const object = containerAt(mutated, objectPath) as Record<string, unknown>;
        object.__piano_unknown_field__ = { nested: true };
        cases.push([`add unknown /${[...objectPath, "__piano_unknown_field__"].join("/")}`, mutated]);
      }
      if (legacy === "summary-report") {
        cases.push(["omit optional outcome and progress_record", { run_id: "run-id", summary: "done" }]);
      }

      for (const [label, value] of cases) {
        const legacyResult = validateContract(legacy, value);
        const workerResult = validateWorkerContract(contract, value);
        expect(workerResult.success, `${worker} must match ${legacy}: ${label}`).toBe(legacyResult.success);
        if (legacyResult.success && workerResult.success) {
          expect(workerResult.value, `${worker} accepted value must match ${legacy}: ${label}`).toEqual(legacyResult.value);
        }
      }
    }
  });

  it("keeps same-id shipped workers equivalent without using the legacy registry as an oracle", async () => {
    const recipes = join(process.cwd(), "recipes");
    const groups = new Map<string, Array<{
      worker: string;
      contract: ReturnType<typeof compileWorkerContract>;
    }>>();
    const workers = await readdir(recipes, { withFileTypes: true });
    for (const entry of workers) {
      if (!entry.isDirectory()) continue;
      const path = join(recipes, entry.name, "contract.json");
      try {
        const contract = compileWorkerContract(await readFile(path, "utf8"), path);
        const group = groups.get(contract.manifest.id) ?? [];
        group.push({ worker: entry.name, contract });
        groups.set(contract.manifest.id, group);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    for (const [id, group] of groups) {
      if (group.length < 2) continue;
      for (const source of group) {
        const payload = structuredClone(source.contract.manifest.example);
        const results = group.map((target) => ({
          target: target.worker,
          result: validateWorkerContract(target.contract, structuredClone(payload)),
        }));
        const reference = results[0]!.result;
        for (const { target, result } of results) {
          expect(result.success, `${id}: ${target} vs ${source.worker}`).toBe(reference.success);
          if (reference.success && result.success) {
            expect(result.value, `${id}: ${target} normalized value`).toEqual(reference.value);
            expect(result.projections, `${id}: ${target} projections`).toEqual(reference.projections);
          }
        }
      }
    }
  });

  it("reserves the semantic map-items projection on proposal contracts", async () => {
    const cases = [
      ["cuda-idea", true],
      ["triton-idea", true],
      ["topsop-idea", true],
      ["cuda-idea-tournament", true],
      ["topsop-optimize", false],
    ] as const;

    for (const [worker, required] of cases) {
      const path = join(process.cwd(), "recipes", worker, "contract.json");
      const contract = compileWorkerContract(await readFile(path, "utf8"), path);
      const declaration = contract.manifest.outputs.projections.find((projection) => projection.id === "workflow.map-items");
      expect(declaration, `${worker} must reserve workflow.map-items`).toMatchObject({
        pointer: "/strategies",
        format: "json",
        required,
      });
      const result = validateWorkerContract(contract, structuredClone(contract.manifest.example));
      expect(result.success, `${worker} example must project workflow.map-items`).toBe(true);
      if (result.success) {
        expect(result.projections).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: "workflow.map-items", pointer: "/strategies" }),
        ]));
      }
    }
  });

  it("rejects payloads from the other legacy mode at every split worker boundary", async () => {
    const cases: ReadonlyArray<readonly [worker: string, legacy: ContractName, other: ContractName]> = [
      ["topsop-theory", "topsop-theory-report", "topsop-profile-report"],
      ["topsop-profile", "topsop-profile-report", "topsop-theory-report"],
      ["topsop-idea", "optimization-proposal", "topsop-round-result"],
      ["topsop-measure", "topsop-round-result", "optimization-proposal"],
      ["topsop-verification", "verification-report", "summary-report"],
      ["topsop-summary", "summary-report", "verification-report"],
    ];

    for (const [worker, legacy, other] of cases) {
      const path = join(process.cwd(), "recipes", worker, "contract.json");
      const contract = compileWorkerContract(await readFile(path, "utf8"), path);
      const payload = structuredClone(VALIDATION_EXAMPLES[other]);
      expect(validateContract(legacy, payload).success, `${legacy} rejects ${other}`).toBe(false);
      expect(validateWorkerContract(contract, payload).success, `${worker} rejects ${other}`).toBe(false);
    }
  });

  it("keeps deprecated multi-mode topsop workers as compatibility unions", async () => {
    const cases: ReadonlyArray<readonly [worker: string, branches: readonly ContractName[]]> = [
      ["topsop-estimate", ["topsop-theory-report", "topsop-profile-report"]],
      ["topsop-optimize", ["optimization-proposal", "topsop-round-result"]],
      ["topsop-verify", ["verification-report", "summary-report"]],
    ];

    for (const [worker, branches] of cases) {
      const path = join(process.cwd(), "recipes", worker, "contract.json");
      const contract = compileWorkerContract(await readFile(path, "utf8"), path);
      for (const branch of branches) {
        expect(
          validateWorkerContract(contract, structuredClone(VALIDATION_EXAMPLES[branch])).success,
          `${worker} compatibility contract accepts ${branch}`,
        ).toBe(true);
      }
    }
  });

  it("normalizes unknown fields safely for the second branch of compatibility unions", async () => {
    const cases: ReadonlyArray<readonly [
      worker: string,
      legacy: ContractName,
      nestedPath: readonly string[],
      firstBranchOnlyField: string,
    ]> = [
      ["topsop-estimate", "topsop-profile-report", ["metrics", "unknown_nested"], "theory"],
      ["topsop-optimize", "topsop-round-result", ["candidate", "unknown_nested"], "strategies"],
      ["topsop-verify", "summary-report", ["progress_record", "unknown_nested"], "artifact"],
    ];

    for (const [worker, legacy, nestedPath, firstBranchOnlyField] of cases) {
      const path = join(process.cwd(), "recipes", worker, "contract.json");
      const contract = compileWorkerContract(await readFile(path, "utf8"), path);
      const payload = structuredClone(VALIDATION_EXAMPLES[legacy]) as Record<string, unknown>;
      setAt(payload, nestedPath, { ignored: true });
      payload[firstBranchOnlyField] = { ignored: true };
      payload.unknown_root = { ignored: true };
      const original = structuredClone(payload);
      const legacyResult = validateContract(legacy, payload);
      const workerResult = validateWorkerContract(contract, payload);

      expect(legacyResult.success, `${legacy} must accept its second-branch example`).toBe(true);
      expect(workerResult.success, `${worker} must accept its second-branch example`).toBe(true);
      if (legacyResult.success && workerResult.success) {
        expect(workerResult.value, `${worker} must preserve legacy normalized value`).toEqual(legacyResult.value);
      }
      expect(payload, `${worker} must not mutate caller payload`).toEqual(original);
    }
  });

  it("preserves the legacy topsop arithmetic gates in worker-owned declarations", async () => {
    const theoryPath = join(process.cwd(), "recipes", "topsop-theory", "contract.json");
    const profilePath = join(process.cwd(), "recipes", "topsop-profile", "contract.json");
    const compatibilityPath = join(process.cwd(), "recipes", "topsop-estimate", "contract.json");
    const theory = compileWorkerContract(await readFile(theoryPath, "utf8"), theoryPath);
    const profile = compileWorkerContract(await readFile(profilePath, "utf8"), profilePath);
    const compatibility = compileWorkerContract(await readFile(compatibilityPath, "utf8"), compatibilityPath);

    const theoryCases = [
      ["read_write_balanced", false],
      ["bandwidth_limit_gbps", 2500],
      ["bandwidth_utilization", 0.2],
      ["theory_min_us", 100],
    ] as const;
    for (const [field, value] of theoryCases) {
      const payload = structuredClone(VALIDATION_EXAMPLES["topsop-theory-report"]) as Record<string, unknown>;
      (payload.theory as Record<string, unknown>)[field] = value;
      expect(validateContract("topsop-theory-report", payload).success, `legacy theory rejects ${field}`).toBe(false);
      expect(validateWorkerContract(theory, payload).success, `worker theory rejects ${field}`).toBe(false);
      expect(validateWorkerContract(compatibility, payload).success, `compatibility theory rejects ${field}`).toBe(false);
    }

    const payload = structuredClone(VALIDATION_EXAMPLES["topsop-profile-report"]) as Record<string, unknown>;
    (payload.metrics as Record<string, unknown>).bandwidth_utilization = 0.2;
    expect(validateContract("topsop-profile-report", payload).success).toBe(false);
    expect(validateWorkerContract(profile, payload).success).toBe(false);
    expect(validateWorkerContract(compatibility, payload).success).toBe(false);

    const theoryBoundaryCases: Array<readonly [label: string, payload: unknown, accepted: boolean]> = [];
    const addTheoryCase = (
      label: string,
      mutate: (payload: Record<string, unknown>) => void,
      accepted: boolean,
    ): void => {
      const candidate = structuredClone(VALIDATION_EXAMPLES["topsop-theory-report"]) as Record<string, unknown>;
      mutate(candidate);
      theoryBoundaryCases.push([label, candidate, accepted]);
    };
    const setTheoryTraffic = (
      payload: Record<string, unknown>,
      read: number,
      write: number,
      limit: 2500 | 3000,
      balanced: boolean,
    ): void => {
      const profile = (payload.baseline as Record<string, unknown>).profile as Record<string, unknown>;
      const theory = payload.theory as Record<string, unknown>;
      profile.llc_read_bandwidth_gbps = read;
      profile.llc_write_bandwidth_gbps = write;
      profile.llc_rw_sum_gbps = read + write;
      theory.read_write_balanced = balanced;
      theory.bandwidth_limit_gbps = limit;
      theory.bandwidth_utilization = Math.min((read + write) / limit, 1);
      theory.theory_min_us = ((profile.llc_read_bytes as number) + (profile.llc_write_bytes as number)) / (limit * 1e3);
    };
    addTheoryCase("RD/WR exactly 3 is balanced", (candidate) => setTheoryTraffic(candidate, 3000, 1000, 3000, true), true);
    addTheoryCase("RD/WR just over 3 is one-directional", (candidate) => setTheoryTraffic(candidate, 3000.0001, 1000, 2500, false), true);
    addTheoryCase("zero read bandwidth keeps the historical arithmetic guard inactive", (candidate) => {
      const profile = (candidate.baseline as Record<string, unknown>).profile as Record<string, unknown>;
      profile.llc_read_bandwidth_gbps = 0;
      profile.llc_write_bandwidth_gbps = 1000;
    }, true);

    const baseTheory = VALIDATION_EXAMPLES["topsop-theory-report"] as {
      baseline: { profile: { llc_read_bandwidth_gbps: number; llc_write_bandwidth_gbps: number; llc_rw_sum_gbps: number; llc_read_bytes: number; llc_write_bytes: number } };
      theory: { bandwidth_limit_gbps: number; bandwidth_utilization: number; theory_min_us: number };
    };
    const expectedUtilization = baseTheory.baseline.profile.llc_rw_sum_gbps / baseTheory.theory.bandwidth_limit_gbps;
    for (const [label, delta, accepted] of [
      ["utilization -0.0199 boundary", -0.0199, true],
      ["utilization +0.0199 boundary", 0.0199, true],
      ["utilization -0.0201 rejection", -0.0201, false],
      ["utilization +0.0201 rejection", 0.0201, false],
    ] as const) {
      addTheoryCase(label, (candidate) => {
        (candidate.theory as Record<string, unknown>).bandwidth_utilization = expectedUtilization + delta;
      }, accepted);
    }
    const expectedTheoryMinUs = (baseTheory.baseline.profile.llc_read_bytes + baseTheory.baseline.profile.llc_write_bytes)
      / (baseTheory.theory.bandwidth_limit_gbps * 1e3);
    for (const [label, factor, accepted] of [
      ["theory minimum -2.99% boundary", 0.9701, true],
      ["theory minimum +2.99% boundary", 1.0299, true],
      ["theory minimum -3.01% rejection", 0.9699, false],
      ["theory minimum +3.01% rejection", 1.0301, false],
    ] as const) {
      addTheoryCase(label, (candidate) => {
        (candidate.theory as Record<string, unknown>).theory_min_us = expectedTheoryMinUs * factor;
      }, accepted);
    }

    for (const [label, candidate, accepted] of theoryBoundaryCases) {
      const legacyResult = validateContract("topsop-theory-report", candidate);
      const theoryResult = validateWorkerContract(theory, candidate);
      const compatibilityResult = validateWorkerContract(compatibility, candidate);
      expect(legacyResult.success, `${label}: legacy`).toBe(accepted);
      expect(theoryResult.success, `${label}: worker`).toBe(accepted);
      expect(compatibilityResult.success, `${label}: compatibility worker`).toBe(accepted);
      if (legacyResult.success && theoryResult.success && compatibilityResult.success) {
        expect(theoryResult.value, `${label}: theory normalization`).toEqual(legacyResult.value);
        expect(compatibilityResult.value, `${label}: compatibility normalization`).toEqual(legacyResult.value);
      }
    }
  });

  it.each(["cuda", "triton"])("enforces the %s round decision state machine", async (family) => {
    const path = join(process.cwd(), "recipes", `${family}-benchmark-store`, "contract.json");
    const contract = compileWorkerContract(await readFile(path, "utf8"), path);
    const example = structuredClone(contract.manifest.example) as Record<string, unknown>;
    const verification = example.verification as Record<string, unknown>;
    const promotion = example.promotion as Record<string, unknown>;

    verification.compile_passed = true;
    verification.verify_passed = true;
    example.decision = "COMPILE_FAIL";
    promotion.promoted = false;
    expect(validateWorkerContract(contract, example).success).toBe(false);

    example.decision = "BLOCKED";
    delete example.benchmark;
    expect(validateWorkerContract(contract, example).success).toBe(true);

    verification.compile_passed = true;
    verification.verify_passed = false;
    example.decision = "VERIFY_FAIL";
    expect(validateWorkerContract(contract, example).success).toBe(true);

    verification.compile_passed = false;
    verification.verify_passed = false;
    example.decision = "COMPILE_FAIL";
    expect(validateWorkerContract(contract, example).success).toBe(true);
  });
});
