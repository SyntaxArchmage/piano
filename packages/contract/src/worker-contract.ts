import { basename } from "node:path";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { z } from "zod";
import { workspaceRelativePathViolation } from "./workspace-path.js";

const JSON_POINTER = /^(?:\/(?:[^~/]|~[01])*)*$/;
const CONTRACT_ID = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const JSON_SCHEMA_DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";
const ASSERTION_KEYWORD = "x-piano-assertions";
const UNKNOWN_PROPERTIES_KEYWORD = "x-piano-unknown-properties";

type AssertionOperator =
  | "all"
  | "any"
  | "not"
  | "present"
  | "eq"
  | "lte"
  | "gt"
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "min"
  | "abs"
  | "if";

type AssertionExpression =
  | string
  | number
  | boolean
  | null
  | { readonly path: string }
  | { readonly op: AssertionOperator; readonly args: readonly AssertionExpression[] };

interface ContractAssertion {
  readonly path: string;
  readonly message: string;
  readonly when?: AssertionExpression;
  readonly test: AssertionExpression;
}

const ASSERTION_ARITY: Readonly<Record<AssertionOperator, readonly [minimum: number, maximum: number]>> = {
  all: [1, Number.POSITIVE_INFINITY],
  any: [1, Number.POSITIVE_INFINITY],
  not: [1, 1],
  present: [1, 1],
  eq: [2, 2],
  lte: [2, 2],
  gt: [2, 2],
  add: [1, Number.POSITIVE_INFINITY],
  subtract: [2, 2],
  multiply: [1, Number.POSITIVE_INFINITY],
  divide: [2, 2],
  min: [1, Number.POSITIVE_INFINITY],
  abs: [1, 1],
  if: [3, 3],
};

const metricOutputSchema = z.object({
  pointer: z.string().regex(JSON_POINTER, "must be an RFC 6901 JSON Pointer"),
  format: z.literal("benchmark/v1"),
  required: z.boolean().optional().default(true),
}).strict();

export type ProjectionFormat =
  | "json"
  | "string"
  | "number"
  | "boolean"
  | "string-list"
  | "workspace-relative-path-list";

export interface ContractProjectionDeclaration {
  readonly id: string;
  readonly pointer: string;
  readonly format: ProjectionFormat;
  readonly required?: boolean;
}

export interface ContractProjection {
  readonly id: string;
  readonly pointer: string;
  readonly format: ProjectionFormat;
  readonly value: unknown;
}

const projectionOutputSchema = z.object({
  id: z.string().regex(CONTRACT_ID, "must be a stable projection identifier"),
  pointer: z.string().regex(JSON_POINTER, "must be an RFC 6901 JSON Pointer"),
  format: z.enum([
    "json",
    "string",
    "number",
    "boolean",
    "string-list",
    "workspace-relative-path-list",
  ]),
  required: z.boolean().optional().default(true),
}).strict();

/** Piano-owned schema for a user-authored worker contract manifest. */
export const workerContractManifestSchema = z.object({
  schema: z.record(z.unknown()).refine(
    (schema) => schema.$schema === JSON_SCHEMA_DRAFT_2020_12,
    `must declare $schema as ${JSON_SCHEMA_DRAFT_2020_12}`,
  ),
  // `z.unknown()` accepts `undefined`; JSON cannot encode that value, so this
  // refinement also makes an omitted manifest key fail instead of silently
  // becoming an unusable guidance example.
  example: z.unknown().refine((value) => value !== undefined, "is required"),
  outputs: z.object({
    metrics: z.array(metricOutputSchema).optional().default([]),
    projections: z.array(projectionOutputSchema).optional().default([]).superRefine((declarations, context) => {
      const seen = new Map<string, number>();
      for (const [index, declaration] of declarations.entries()) {
        const previous = seen.get(declaration.id);
        if (previous !== undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "id"],
            message: `duplicate projection id "${declaration.id}" (already declared at index ${previous})`,
          });
        } else {
          seen.set(declaration.id, index);
        }
      }
    }),
  }).strict().optional().default({ metrics: [] }),
}).strict();

export type WorkerContractManifest = z.infer<typeof workerContractManifestSchema>;
export type WorkerMetricOutput = WorkerContractManifest["outputs"]["metrics"][number];

export const benchmarkMetricV1Schema = z.object({
  name: z.string().min(1),
  unit: z.string().min(1),
  direction: z.enum(["higher", "lower"]),
  samples: z.array(z.number().finite()).min(1),
  best: z.number().finite(),
  median: z.number().finite(),
  runs: z.number().int().safe().min(1),
  warmup: z.number().int().safe().min(0),
  raw_path: z.string().min(1).optional(),
}).passthrough();

export interface BenchmarkMetricV1 {
  readonly protocol: "benchmark/v1";
  readonly name: string;
  readonly unit: string;
  readonly direction: "higher" | "lower";
  readonly samples: readonly number[];
  readonly best: number;
  readonly median: number;
  readonly runs: number;
  readonly warmup: number;
  readonly rawPath?: string;
}

export interface ContractMetric {
  readonly pointer: string;
  readonly format: "benchmark/v1";
  readonly value: BenchmarkMetricV1;
}

export interface CompiledWorkerContract {
  readonly path: string;
  /** The worker this contract belongs to: the manifest file's base name. */
  readonly worker: string;
  readonly source: string;
  readonly manifest: WorkerContractManifest;
  /** The example after the same strip normalization applied to worker output. */
  readonly normalizedExample: unknown;
  readonly validate: ValidateFunction;
}

export class WorkerContractLoadError extends Error {
  readonly _tag = "WorkerContractLoadError" as const;

  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkerContractLoadError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface WorkerContractValidationSuccess {
  readonly success: true;
  readonly value: unknown;
  readonly metrics: readonly ContractMetric[];
  readonly projections: readonly ContractProjection[];
}

interface WorkerContractValidationFailure {
  readonly success: false;
  readonly error: ContractValidationError;
}

export type WorkerContractValidationResult =
  | WorkerContractValidationSuccess
  | WorkerContractValidationFailure;

/** A worker result or declared output failed its resolved contract. */
export class ContractValidationError extends Error {
  readonly _tag = "ContractValidationError" as const;
  readonly contract: string;

  constructor(details: { readonly contract: string; readonly message: string }) {
    super(details.message);
    this.name = "ContractValidationError";
    this.contract = details.contract;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function formatJsonSchemaErrors(errors: readonly ErrorObject[] | null | undefined): string {
  if (errors === undefined || errors === null || errors.length === 0) return "unknown schema failure";
  return errors
    .map((error) => `${error.instancePath || "(root)"}: ${error.message ?? error.keyword}`)
    .join("; ");
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function roundingPlausible(reported: number, exact: number): boolean {
  // Display rounding (a worker serializing to a few decimals) must not burn
  // a repair turn; the guard's domain is derived values that are not the
  // sample recomputation at any display precision (fabrication). 1e-4
  // relative covers rounding to roughly 4 decimals / 7 significant digits.
  const scale = Math.max(1, Math.abs(reported), Math.abs(exact));
  return Math.abs(reported - exact) <= scale * 1e-4;
}

function normalizeBenchmarkMetric(
  contract: string,
  pointer: string,
  input: unknown,
): BenchmarkMetricV1 | ContractValidationError {
  const parsed = benchmarkMetricV1Schema.safeParse(input);
  if (!parsed.success) {
    return new ContractValidationError({
      contract,
      message: `metric output ${pointer} failed benchmark/v1: ${formatZodIssues(parsed.error)}`,
    });
  }
  const metric = parsed.data;
  if (metric.runs !== metric.samples.length) {
    return new ContractValidationError({
      contract,
      message: `metric output ${pointer} failed benchmark/v1: runs must equal samples.length`,
    });
  }
  const expectedBest = metric.direction === "higher"
    ? Math.max(...metric.samples)
    : Math.min(...metric.samples);
  if (!roundingPlausible(metric.best, expectedBest)) {
    return new ContractValidationError({
      contract,
      message: `metric output ${pointer} failed benchmark/v1: best must be the direction-aware best sample`,
    });
  }
  const expectedMedian = median(metric.samples);
  if (!roundingPlausible(metric.median, expectedMedian)) {
    return new ContractValidationError({
      contract,
      message: `metric output ${pointer} failed benchmark/v1: median does not match samples`,
    });
  }
  return {
    protocol: "benchmark/v1",
    name: metric.name,
    unit: metric.unit,
    direction: metric.direction,
    samples: metric.samples,
    // Project the exact recomputation, not the worker's (possibly rounded)
    // reporting: tournament comparison and durable state must see one
    // canonical value derived from the accepted sample list.
    best: expectedBest,
    median: expectedMedian,
    runs: metric.runs,
    warmup: metric.warmup,
    ...(metric.raw_path === undefined ? {} : { rawPath: metric.raw_path }),
  };
}

const MISSING = Symbol("missing JSON Pointer value");

function jsonPointer(input: unknown, pointer: string): unknown | typeof MISSING {
  if (pointer === "") return input;
  let current = input;
  for (const rawToken of pointer.slice(1).split("/")) {
    const token = rawToken.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(token)) return MISSING;
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= current.length) return MISSING;
      current = current[index];
      continue;
    }
    if (typeof current !== "object" || current === null || !Object.prototype.hasOwnProperty.call(current, token)) return MISSING;
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

const PROJECTION_FORMATS: ReadonlySet<string> = new Set([
  "json",
  "string",
  "number",
  "boolean",
  "string-list",
  "workspace-relative-path-list",
]);

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;
  const nextAncestors = new Set(ancestors).add(value);
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, nextAncestors));
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Object.values(value).every((entry) => isJsonValue(entry, nextAncestors));
}

function projectionTypeError(format: ProjectionFormat, value: unknown): string | undefined {
  switch (format) {
    case "json":
      return isJsonValue(value) ? undefined : "must be a JSON value";
    case "string":
      return typeof value === "string" ? undefined : "must be a string";
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? undefined : "must be a finite number";
    case "boolean":
      return typeof value === "boolean" ? undefined : "must be a boolean";
    case "string-list":
      return Array.isArray(value) && value.every((entry) => typeof entry === "string")
        ? undefined
        : "must be a list of strings";
    case "workspace-relative-path-list": {
      if (!Array.isArray(value)) return "must be a list of workspace-relative paths";
      for (const entry of value) {
        if (typeof entry !== "string") return "must contain only non-empty path strings";
        switch (workspaceRelativePathViolation(entry)) {
          case "empty": return "must contain only non-empty path strings";
          case "nul": return "must not contain NUL bytes";
          case "absolute":
          case "blank": return "must contain only relative paths";
          case "segment": return "must not contain empty, dot, or parent path segments";
        }
      }
      return undefined;
    }
  }
}

export function projectContractProjections(
  contractId: string,
  declarations: readonly ContractProjectionDeclaration[],
  payload: unknown,
): readonly ContractProjection[] | ContractValidationError {
  const projections: ContractProjection[] = [];
  const seen = new Set<string>();
  for (const declaration of declarations) {
    if (!CONTRACT_ID.test(declaration.id)) {
      return new ContractValidationError({
        contract: contractId,
        message: `projection id "${declaration.id}" is not a stable identifier`,
      });
    }
    if (!JSON_POINTER.test(declaration.pointer)) {
      return new ContractValidationError({
        contract: contractId,
        message: `projection "${declaration.id}" pointer is not an RFC 6901 JSON Pointer`,
      });
    }
    if (!PROJECTION_FORMATS.has(declaration.format)) {
      return new ContractValidationError({
        contract: contractId,
        message: `projection "${declaration.id}" has unsupported format "${String(declaration.format)}"`,
      });
    }
    if (seen.has(declaration.id)) {
      return new ContractValidationError({
        contract: contractId,
        message: `duplicate projection id "${declaration.id}"`,
      });
    }
    seen.add(declaration.id);

    const projected = jsonPointer(payload, declaration.pointer);
    if (projected === MISSING) {
      if (declaration.required !== false) {
        return new ContractValidationError({
          contract: contractId,
          message: `required projection "${declaration.id}" at ${declaration.pointer || "(root)"} is missing`,
        });
      }
      continue;
    }
    const typeError = projectionTypeError(declaration.format, projected);
    if (typeError !== undefined) {
      return new ContractValidationError({
        contract: contractId,
        message: `projection "${declaration.id}" at ${declaration.pointer || "(root)"} ${typeError}`,
      });
    }
    projections.push({
      id: declaration.id,
      pointer: declaration.pointer,
      format: declaration.format,
      value: projected,
    });
  }
  return projections;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
  return hasOwn(record, key) ? record[key] : undefined;
}

function isAssertionPathExpression(value: object): value is { readonly path: string } {
  return Object.prototype.hasOwnProperty.call(value, "path");
}

function parseAssertionExpression(value: unknown, location: string): AssertionExpression {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const record = schemaRecord(value);
  if (record === undefined) throw new Error(`${location} must be a JSON primitive, path, or operation`);
  const keys = Object.keys(record);
  const path = ownValue(record, "path");
  if (keys.length === 1 && typeof path === "string") {
    if (!JSON_POINTER.test(path)) throw new Error(`${location}.path must be an RFC 6901 JSON Pointer`);
    return { path };
  }
  const op = ownValue(record, "op");
  const args = ownValue(record, "args");
  if (keys.length !== 2 || typeof op !== "string" || !Array.isArray(args)) {
    throw new Error(`${location} operation must contain exactly op and args`);
  }
  if (!Object.prototype.hasOwnProperty.call(ASSERTION_ARITY, op)) {
    throw new Error(`${location}.op "${op}" is not supported`);
  }
  const operator = op as AssertionOperator;
  const [minimum, maximum] = ASSERTION_ARITY[operator];
  if (args.length < minimum || args.length > maximum) {
    const expected = minimum === maximum ? String(minimum) : `at least ${minimum}`;
    throw new Error(`${location}.${operator} expects ${expected} argument(s)`);
  }
  return {
    op: operator,
    args: args.map((argument, index) => parseAssertionExpression(argument, `${location}.args[${index}]`)),
  };
}

function parseContractAssertions(value: unknown): readonly ContractAssertion[] {
  if (!Array.isArray(value)) throw new Error(`${ASSERTION_KEYWORD} must be an array`);
  return value.map((entry, index) => {
    const location = `${ASSERTION_KEYWORD}[${index}]`;
    const record = schemaRecord(entry);
    if (record === undefined) throw new Error(`${location} must be an object`);
    const allowed = new Set(["path", "message", "when", "test"]);
    const unknown = Object.keys(record).filter((key) => !allowed.has(key));
    if (unknown.length > 0) throw new Error(`${location} has unknown field(s): ${unknown.join(", ")}`);
    const path = ownValue(record, "path");
    const message = ownValue(record, "message");
    if (typeof path !== "string" || !JSON_POINTER.test(path)) {
      throw new Error(`${location}.path must be an RFC 6901 JSON Pointer`);
    }
    if (typeof message !== "string" || message.trim() === "") {
      throw new Error(`${location}.message must be a non-empty string`);
    }
    if (!hasOwn(record, "test")) throw new Error(`${location}.test is required`);
    const test = ownValue(record, "test");
    return {
      path,
      message,
      ...(hasOwn(record, "when") ? { when: parseAssertionExpression(ownValue(record, "when"), `${location}.when`) } : {}),
      test: parseAssertionExpression(test, `${location}.test`),
    };
  });
}

const INVALID_ASSERTION_VALUE = Symbol("invalid assertion value");

function assertionNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function evaluateAssertionExpression(
  expression: AssertionExpression,
  root: unknown,
): unknown | typeof MISSING | typeof INVALID_ASSERTION_VALUE {
  if (expression === null || typeof expression !== "object") return expression;
  if (isAssertionPathExpression(expression)) return jsonPointer(root, expression.path);
  if (expression.op === "present") {
    const value = evaluateAssertionExpression(expression.args[0]!, root);
    return value === INVALID_ASSERTION_VALUE ? INVALID_ASSERTION_VALUE : value !== MISSING;
  }
  if (expression.op === "if") {
    const condition = evaluateAssertionExpression(expression.args[0]!, root);
    if (typeof condition !== "boolean") return INVALID_ASSERTION_VALUE;
    return evaluateAssertionExpression(expression.args[condition ? 1 : 2]!, root);
  }
  if (expression.op === "all" || expression.op === "any") {
    let sawInvalid = false;
    for (const argument of expression.args) {
      const value = evaluateAssertionExpression(argument, root);
      if (value === MISSING || value === INVALID_ASSERTION_VALUE || typeof value !== "boolean") {
        sawInvalid = true;
        continue;
      }
      if (expression.op === "all" && !value) return false;
      if (expression.op === "any" && value) return true;
    }
    if (sawInvalid) return INVALID_ASSERTION_VALUE;
    return expression.op === "all";
  }
  const values = expression.args.map((argument) => evaluateAssertionExpression(argument, root));
  if (values.some((value) => value === MISSING || value === INVALID_ASSERTION_VALUE)) {
    return INVALID_ASSERTION_VALUE;
  }
  switch (expression.op) {
    case "not":
      return typeof values[0] === "boolean" ? !values[0] : INVALID_ASSERTION_VALUE;
    case "eq":
      return values[0] === values[1];
    case "lte":
    case "gt": {
      const [left, right] = values;
      if (!assertionNumber(left) || !assertionNumber(right)) return INVALID_ASSERTION_VALUE;
      if (expression.op === "lte") return left <= right;
      return left > right;
    }
    case "add":
    case "multiply":
    case "min": {
      if (!values.every(assertionNumber)) return INVALID_ASSERTION_VALUE;
      if (expression.op === "add") return values.reduce<number>((total, value) => total + value, 0);
      if (expression.op === "multiply") return values.reduce<number>((total, value) => total * value, 1);
      return Math.min(...values);
    }
    case "subtract":
    case "divide": {
      const [left, right] = values;
      if (!assertionNumber(left) || !assertionNumber(right) || (expression.op === "divide" && right === 0)) {
        return INVALID_ASSERTION_VALUE;
      }
      const result = expression.op === "subtract" ? left - right : left / right;
      return Number.isFinite(result) ? result : INVALID_ASSERTION_VALUE;
    }
    case "abs":
      return assertionNumber(values[0]) ? Math.abs(values[0]) : INVALID_ASSERTION_VALUE;
  }
}

function addAssertionKeyword(ajv: Ajv2020): void {
  ajv.addKeyword({
    keyword: ASSERTION_KEYWORD,
    schemaType: "array",
    errors: true,
    compile: (schema: unknown) => {
      const assertions = parseContractAssertions(schema);
      const validate = (data: unknown): boolean => {
        const errors: ErrorObject[] = [];
        for (const assertion of assertions) {
          if (assertion.when !== undefined) {
            const condition = evaluateAssertionExpression(assertion.when, data);
            if (condition === false) continue;
            if (condition !== true) {
              errors.push({
                instancePath: assertion.path,
                schemaPath: `#/${ASSERTION_KEYWORD}`,
                keyword: ASSERTION_KEYWORD,
                params: {},
                message: `${assertion.message} (condition could not be evaluated)`,
              });
              continue;
            }
          }
          if (evaluateAssertionExpression(assertion.test, data) === true) continue;
          errors.push({
            instancePath: assertion.path,
            schemaPath: `#/${ASSERTION_KEYWORD}`,
            keyword: ASSERTION_KEYWORD,
            params: {},
            message: assertion.message,
          });
        }
        validate.errors = errors.length === 0 ? undefined : errors;
        return errors.length === 0;
      };
      validate.errors = undefined as ErrorObject[] | undefined;
      return validate;
    },
  });
}

function addUnknownPropertiesKeyword(ajv: Ajv2020): void {
  ajv.addKeyword({
    keyword: UNKNOWN_PROPERTIES_KEYWORD,
    schemaType: "string",
    metaSchema: { enum: ["strip"] },
    compile: () => () => true,
  });
}

function cloneForValidation(value: unknown): unknown {
  return structuredClone(value);
}

function stripsUnknownProperties(manifest: WorkerContractManifest): boolean {
  return Object.prototype.hasOwnProperty.call(manifest.schema, UNKNOWN_PROPERTIES_KEYWORD)
    && manifest.schema[UNKNOWN_PROPERTIES_KEYWORD] === "strip";
}

type JsonSchema = Record<string, unknown>;

/** The JSON Schema keywords whose values are arrays of subschemas. */
const JSON_SCHEMA_COMBINATORS = ["allOf", "anyOf", "oneOf"] as const;

function schemaRecord(value: unknown): JsonSchema | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonSchema
    : undefined;
}

function ownSchemaValue(record: JsonSchema | undefined, key: string): unknown {
  return record !== undefined && Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

function defineOwnProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function schemaPointer(root: JsonSchema, reference: string): unknown {
  if (reference === "#") return root;
  if (!reference.startsWith("#/")) return undefined;
  return jsonPointer(root, reference.slice(1));
}

function schemaPath(path: readonly string[]): string {
  return path.length === 0 ? "(root)" : path.join(".");
}

function structuralPropertyNames(schema: unknown, root: JsonSchema, seen = new Set<object>()): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = schemaRecord(value);
    if (record === undefined || seen.has(record)) return;
    seen.add(record);
    if (typeof record.$ref === "string") visit(schemaPointer(root, record.$ref));
    const properties = schemaRecord(record.properties);
    if (properties !== undefined) {
      for (const name of Object.keys(properties)) names.add(name);
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === "if" || key === "then" || key === "else" || key === "not" || key === "contains") continue;
      visit(child);
    }
  };
  visit(schema);
  return names;
}

/** Return data-property pointers that the strip normalizer can retain as
 * declared object properties. Custom assertions run after normalization, so
 * an assertion may not depend on an undeclared property: strip would erase it
 * before the assertion evaluates and could change contract acceptance. */
function structuralPropertyPaths(schema: JsonSchema): ReadonlySet<string> {
  const paths = new Set<string>();
  const seen = new WeakMap<object, Set<string>>();
  const visit = (value: unknown, path: string, ancestors = new Set<object>()): void => {
    const record = schemaRecord(value);
    if (record === undefined) return;
    if (ancestors.has(record)) return;
    const pathsAtSchema = seen.get(record) ?? new Set<string>();
    if (pathsAtSchema.has(path)) return;
    pathsAtSchema.add(path);
    seen.set(record, pathsAtSchema);
    const nextAncestors = new Set(ancestors).add(record);

    if (typeof record.$ref === "string") {
      const referenced = schemaPointer(schema, record.$ref);
      if (referenced !== undefined) visit(referenced, path, nextAncestors);
    }
    const properties = schemaRecord(record.properties);
    if (properties !== undefined) {
      for (const [name, child] of Object.entries(properties)) {
        const childPath = `${path}/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`;
        paths.add(childPath);
        visit(child, childPath, nextAncestors);
      }
    }
    for (const keyword of JSON_SCHEMA_COMBINATORS) {
      const branches = record[keyword];
      if (Array.isArray(branches)) for (const branch of branches) visit(branch, path, nextAncestors);
    }
  };
  visit(schema, "");
  return paths;
}

function assertionExpressionPaths(expression: AssertionExpression, paths: Set<string>): void {
  if (typeof expression !== "object" || expression === null) return;
  if (isAssertionPathExpression(expression)) {
    paths.add(expression.path);
    return;
  }
  for (const argument of expression.args) assertionExpressionPaths(argument, paths);
}

function validateStripAssertionPaths(schema: JsonSchema): void {
  const structuralPaths = structuralPropertyPaths(schema);
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = schemaRecord(value);
    if (record === undefined || seen.has(record)) return;
    seen.add(record);
    if (hasOwn(record, ASSERTION_KEYWORD)) {
      for (const [index, assertion] of parseContractAssertions(record[ASSERTION_KEYWORD]).entries()) {
        const referencedPaths = new Set<string>();
        if (assertion.when !== undefined) assertionExpressionPaths(assertion.when, referencedPaths);
        assertionExpressionPaths(assertion.test, referencedPaths);
        for (const reference of referencedPaths) {
          if (reference === "") continue;
          const segments = reference.slice(1).split("/");
          let prefix = "";
          for (const segment of segments) {
            prefix += `/${segment}`;
            if (!structuralPaths.has(prefix)) {
              throw new Error(`${ASSERTION_KEYWORD}[${index}] references undeclared property ${reference}; strip normalization could change its result`);
            }
          }
        }
      }
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(schema);
}

/** Validate the subset of JSON Schema for which the custom strip pass can
 * preserve JSON-schema acceptance and normalization semantics. The ordinary
 * (non-strip) path deliberately does not use this dialect gate. */
function validateStripSchemaDialect(schema: JsonSchema): void {
  const structuralNames = structuralPropertyNames(schema, schema);
  validateStripAssertionPaths(schema);
  const seen = new WeakMap<object, Set<string>>();
  const visit = (
    value: unknown,
    path: readonly string[],
    predicateContext: boolean,
    conditionalBranch: boolean,
  ): void => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, [...path, String(index)], predicateContext, conditionalBranch));
      return;
    }
    const record = schemaRecord(value);
    if (record === undefined) return;
    const state = `${predicateContext ? "predicate" : "structural"}:${conditionalBranch ? "conditional" : "ordinary"}`;
    const states = seen.get(record) ?? new Set<string>();
    if (states.has(state)) return;
    states.add(state);
    seen.set(record, states);

    if (typeof record.$ref === "string" && record.$ref !== "#" && !record.$ref.startsWith("#/")) {
      throw new Error(`${UNKNOWN_PROPERTIES_KEYWORD} does not support external or anchor $ref "${record.$ref}" at ${schemaPath(path)}`);
    }
    for (const keyword of ["$anchor", "$dynamicAnchor", "$dynamicRef", "$recursiveRef"] as const) {
      if (hasOwn(record, keyword)) {
        throw new Error(`${UNKNOWN_PROPERTIES_KEYWORD} does not support ${keyword} at ${schemaPath(path)}`);
      }
    }
    for (const keyword of ["dependentSchemas", "dependentRequired", "propertyNames"] as const) {
      if (hasOwn(record, keyword)) {
        throw new Error(`${UNKNOWN_PROPERTIES_KEYWORD} does not support ${keyword} normalization at ${schemaPath(path)}`);
      }
    }
    if (predicateContext) {
      // The normalizer recursively removes unknown object properties before
      // AJV evaluates the schema.  These predicates observe object/array
      // shape, or can compare a composite value, so their truth value cannot
      // be preserved by the strip pass.  Keep this dialect deliberately
      // conservative: a new predicate keyword must be added here only after
      // proving that recursive stripping cannot affect it.
      for (const keyword of [
        "additionalProperties",
        "patternProperties",
        "items",
        "prefixItems",
        "unevaluatedItems",
        "minProperties",
        "maxProperties",
        "minItems",
        "maxItems",
        "uniqueItems",
        "minContains",
        "maxContains",
      ] as const) {
        if (hasOwn(record, keyword)) {
          throw new Error(`${UNKNOWN_PROPERTIES_KEYWORD} does not support predicate ${keyword} at ${schemaPath(path)} because stripping can change its result`);
        }
      }
      if (hasOwn(record, "const") && record.const !== null && typeof record.const === "object") {
        throw new Error(`${UNKNOWN_PROPERTIES_KEYWORD} does not support composite const predicates at ${schemaPath(path)} because stripping can change equality`);
      }
      if (hasOwn(record, "enum") && Array.isArray(record.enum)
        && record.enum.some((candidate) => candidate !== null && typeof candidate === "object")) {
        throw new Error(`${UNKNOWN_PROPERTIES_KEYWORD} does not support composite enum predicates at ${schemaPath(path)} because stripping can change equality`);
      }
      const predicateProperties = schemaRecord(record.properties);
      if (predicateProperties !== undefined) {
        const introduced = Object.keys(predicateProperties).filter((name) => !structuralNames.has(name));
        if (introduced.length > 0) {
          throw new Error(`${UNKNOWN_PROPERTIES_KEYWORD} does not support predicates over undeclared fields at ${schemaPath(path)}: ${introduced.join(", ")}`);
        }
      }
      const required = record.required;
      if (Array.isArray(required)) {
        const undeclared = required.filter((name): name is string => typeof name === "string" && !structuralNames.has(name));
        if (undeclared.length > 0) {
          throw new Error(`${UNKNOWN_PROPERTIES_KEYWORD} does not support predicates over undeclared fields at ${schemaPath(path)}: ${undeclared.join(", ")}`);
        }
      }
    }
    if (hasOwn(record, "contains") && !predicateContext) {
      throw new Error(`${UNKNOWN_PROPERTIES_KEYWORD} only supports contains as a predicate; array-shape contains at ${schemaPath(path)} cannot be normalized safely`);
    }
    if (conditionalBranch) {
      for (const keyword of [
        "additionalProperties",
        "patternProperties",
        "items",
        "prefixItems",
        "contains",
        "dependentSchemas",
        "dependentRequired",
        "propertyNames",
        "unevaluatedProperties",
        "unevaluatedItems",
      ] as const) {
        if (hasOwn(record, keyword)) {
          throw new Error(`${UNKNOWN_PROPERTIES_KEYWORD} does not support shape-changing conditional ${keyword} at ${schemaPath(path)}`);
        }
      }
      const properties = schemaRecord(record.properties);
      if (properties !== undefined) {
        const introduced = Object.keys(properties).filter((name) => !structuralNames.has(name));
        if (introduced.length > 0) {
          throw new Error(`${UNKNOWN_PROPERTIES_KEYWORD} does not support conditional fields not declared by the surrounding schema at ${schemaPath(path)}: ${introduced.join(", ")}`);
        }
      }
    }

    const properties = schemaRecord(record.properties);
    if (properties !== undefined) {
      for (const [key, child] of Object.entries(properties)) visit(child, [...path, "properties", key], predicateContext, false);
    }
    const patternProperties = schemaRecord(record.patternProperties);
    if (patternProperties !== undefined) {
      for (const [key, child] of Object.entries(patternProperties)) visit(child, [...path, "patternProperties", key], predicateContext, false);
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === "properties" || key === "patternProperties" || key === "$ref") continue;
      if (key === "if") {
        visit(child, [...path, key], true, false);
      } else if (key === "then" || key === "else") {
        visit(child, [...path, key], predicateContext, true);
      } else if (key === "not" || key === "contains") {
        visit(child, [...path, key], true, false);
      } else {
        visit(child, [...path, key], predicateContext, false);
      }
    }
  };
  visit(schema, [], false, false);
}

/** The custom strip mode is deliberately a root-only policy. It recursively
 * strips objects whose schema leaves `additionalProperties` at its JSON
 * Schema default (`true`), while explicit `additionalProperties` remains
 * authoritative. `unevaluatedProperties` is rejected in this mode because
 * deciding which properties were evaluated across applicators would otherwise
 * require a second JSON Schema evaluator. */
function validateUnknownPropertySemantics(schema: JsonSchema, strip: boolean): void {
  const seen = new Set<object>();
  const visit = (value: unknown, root: boolean): void => {
    if (Array.isArray(value)) {
      value.forEach((child) => visit(child, false));
      return;
    }
    const record = schemaRecord(value);
    if (record === undefined || seen.has(record)) return;
    seen.add(record);
    if (!root && hasOwn(record, UNKNOWN_PROPERTIES_KEYWORD)) {
      throw new Error(`${UNKNOWN_PROPERTIES_KEYWORD} is only supported at the schema root`);
    }
    if (strip && hasOwn(record, "unevaluatedProperties")) {
      throw new Error(`unevaluatedProperties is not supported with ${UNKNOWN_PROPERTIES_KEYWORD}: "strip"`);
    }
    if (strip && hasOwn(record, "unevaluatedItems")) {
      throw new Error(`unevaluatedItems is not supported with ${UNKNOWN_PROPERTIES_KEYWORD}: "strip"`);
    }
    for (const child of Object.values(record)) visit(child, false);
  };
  visit(schema, true);
}

/** Collect structural declarations reachable inside one schema context.
 * `normalize` selects a direct anyOf/oneOf branch on isolated candidates
 * before object reconstruction; this helper resolves refs/intersections and
 * gathers declarations but never decides which alternative succeeds. */
function schemaFragments(
  schema: unknown,
  root: JsonSchema,
  seen = new Set<object>(),
  includePredicates = false,
): readonly JsonSchema[] {
  const record = schemaRecord(schema);
  if (record === undefined || seen.has(record)) return [];
  const nextSeen = new Set(seen).add(record);
  const fragments: JsonSchema[] = [record];
  if (typeof record.$ref === "string") {
    fragments.push(...schemaFragments(schemaPointer(root, record.$ref), root, nextSeen, includePredicates));
  }
  for (const keyword of JSON_SCHEMA_COMBINATORS) {
    if (Array.isArray(record[keyword])) {
      for (const branch of record[keyword]) fragments.push(...schemaFragments(branch, root, nextSeen, includePredicates));
    }
  }
  // `if` is a predicate, not a declaration of the instance shape. Including
  // its properties here would make a conditional anyOf look like a data
  // union and could strip valid sibling fields while normalizing. Branch
  // consequences can contribute declarations; predicates are handled only by
  // AJV's final validation.
  const conditionalKeywords: readonly ("if" | "then" | "else")[] = includePredicates
    ? ["if", "then", "else"]
    : ["then", "else"];
  for (const keyword of conditionalKeywords) {
    fragments.push(...schemaFragments(record[keyword], root, nextSeen, includePredicates));
  }
  return fragments;
}

const unknownPropertyNormalizers = new WeakMap<object, (value: unknown) => unknown>();

function normalizeUnknownProperties(value: unknown, schema: JsonSchema): unknown {
  const cached = unknownPropertyNormalizers.get(schema);
  if (cached !== undefined) return cached(value);
  const root = schema;
  const branchAjv = new Ajv2020({ allErrors: true, strict: true, strictTuples: false });
  addAssertionKeyword(branchAjv);
  addUnknownPropertiesKeyword(branchAjv);
  const branchValidators = new WeakMap<object, WeakMap<object, ValidateFunction>>();
  const acceptsBranch = (
    branch: unknown,
    candidate: unknown,
    owner: object,
    branchKey: object,
  ): boolean => {
    let validate: ValidateFunction;
    const record = schemaRecord(branch);
    let validators = branchValidators.get(owner);
    if (validators === undefined) {
      validators = new WeakMap<object, ValidateFunction>();
      branchValidators.set(owner, validators);
    }
    validate = validators.get(branchKey) as ValidateFunction;
    if (record === undefined) {
      try {
        validate = branchAjv.compile(branch as boolean);
      } catch {
        return false;
      }
    } else {
      validate ??= (() => {
        try {
          // Local $refs in a branch point at the migrated contract's $defs.
          // Carry those definitions into the branch-only validator so branch
          // attempts remain isolated without losing schema resolution.
          const branchWithDefinitions = root.$defs === undefined || record.$defs !== undefined
            ? record
            : { ...record, $defs: root.$defs };
          const compiled = branchAjv.compile(branchWithDefinitions);
          validators!.set(branchKey, compiled);
          return compiled;
        } catch {
          return undefined;
        }
      })() as ValidateFunction;
      if (validate === undefined) return false;
    }
    return validate(candidate);
  };

  const branchSchemas = (
    currentSchema: JsonSchema,
    keyword: "anyOf" | "oneOf",
    branch: unknown,
  ): readonly [normalization: unknown, validation: unknown] => {
    const base = { ...currentSchema };
    delete base[keyword];
    const branchRecord = schemaRecord(branch);
    const branchProperties: Record<string, unknown> = {};
    const parentProperties = schemaRecord(currentSchema.properties);
    for (const fragment of schemaFragments(branch, root, new Set(), true)) {
      const properties = schemaRecord(fragment.properties);
      if (properties === undefined) continue;
      for (const [key, child] of Object.entries(properties)) {
        defineOwnProperty(branchProperties, key, ownSchemaValue(parentProperties, key) ?? child);
      }
    }
    // A $ref branch owns its object shape in $defs. Keeping the parent
    // union's properties here would reintroduce fields from sibling branches.
    const allOf = Array.isArray(base.allOf) ? [...base.allOf, branch] : [branch];
    const branchLocal = { ...base, allOf };
    const normalization = branchRecord?.$ref === undefined
      ? branchLocal
      : { ...branchRecord, properties: branchProperties };
    return [normalization, branchLocal];
  };

  const normalize = (
    current: unknown,
    currentSchema: unknown,
    ancestors = new Set<object>(),
    forceStripObjects = false,
  ): unknown => {
    const currentRecord = schemaRecord(currentSchema);
    let failedCombinator: "anyOf" | "oneOf" | undefined;
    for (const keyword of ["anyOf", "oneOf"] as const) {
      const branches = currentRecord?.[keyword];
      if (!Array.isArray(branches)) continue;
      failedCombinator = keyword;
      for (const branch of branches) {
        const [normalizationSchema, validationSchema] = branchSchemas(currentRecord!, keyword, branch);
        const branchRecord = schemaRecord(branch);
        const candidate = normalize(
          current,
          normalizationSchema,
          ancestors,
          forceStripObjects || branchRecord?.$ref !== undefined,
        );
        if (acceptsBranch(
          validationSchema,
          candidate,
          currentRecord!,
          branchRecord ?? schemaRecord(validationSchema)!,
        )) return candidate;
      }
      break;
    }
    // No branch succeeded: retain the base schema's declarations only and
    // let strict AJV report the actual union failure. Never fall back to a
    // sibling-branch union allowlist here.
    const fallbackSchema = failedCombinator === undefined || currentRecord === undefined
      ? currentSchema
      : (() => {
        const base = { ...currentRecord };
        delete base[failedCombinator];
        return base;
      })();
    const fragments = schemaFragments(fallbackSchema, root);
    if (typeof current !== "object" || current === null || ancestors.has(current)) return current;
    const nextAncestors = new Set(ancestors).add(current);

    if (Array.isArray(current)) {
      const itemSchemas = fragments.flatMap((fragment) => {
        const prefixItems = Array.isArray(fragment.prefixItems) ? fragment.prefixItems : [];
        const items = fragment.items;
        return [
          ...prefixItems,
          ...(items === undefined || typeof items === "boolean" ? [] : [items]),
        ];
      });
      return current.map((entry, index) => {
        const itemSchema = itemSchemas[index] ?? itemSchemas.at(-1);
        return itemSchema === undefined ? entry : normalize(entry, itemSchema, nextAncestors, forceStripObjects);
      });
    }

    const object = current as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    const knownProperties = new Set<string>();
    const patternSchemas: Array<readonly [RegExp, unknown]> = [];
    const additionalSchemas: unknown[] = [];
    let rejectsAdditional = false;
    let explicitlyHandlesAdditional = false;
    for (const fragment of fragments) {
      const properties = schemaRecord(fragment.properties);
      if (properties !== undefined) for (const key of Object.keys(properties)) knownProperties.add(key);
      const patterns = schemaRecord(fragment.patternProperties);
      if (patterns !== undefined) {
        for (const [pattern, child] of Object.entries(patterns)) {
          try {
            patternSchemas.push([new RegExp(pattern), child]);
          } catch {
            // AJV reports malformed patterns during compilation.
          }
        }
      }
      if (fragment.additionalProperties === false) rejectsAdditional = true;
      else if (fragment.additionalProperties === true) explicitlyHandlesAdditional = true;
      else if (fragment.additionalProperties !== undefined && fragment.additionalProperties !== true) {
        explicitlyHandlesAdditional = true;
        additionalSchemas.push(fragment.additionalProperties);
      }
    }
    if (forceStripObjects && !explicitlyHandlesAdditional) rejectsAdditional = true;

    for (const [key, entry] of Object.entries(object)) {
      const children = fragments.flatMap((fragment) => {
        const properties = schemaRecord(fragment.properties);
        const direct = ownSchemaValue(properties, key);
        const patterns = schemaRecord(fragment.patternProperties);
        const patternChildren = patterns === undefined
          ? []
          : Object.entries(patterns).flatMap(([pattern, child]) => {
            try {
              return new RegExp(pattern).test(key) ? [child] : [];
            } catch {
              return [];
            }
          });
        return [
          ...(direct === undefined ? [] : [direct]),
          ...patternChildren,
        ];
      });
      if (children.length > 0 || knownProperties.has(key)) {
        const childSchema = children.length === 0
          ? undefined
          : children.length === 1
            ? children[0]
            : { allOf: children };
        defineOwnProperty(normalized, key, childSchema === undefined
          ? entry
          : normalize(entry, childSchema, nextAncestors, forceStripObjects));
        continue;
      }
      const matchingPatterns = patternSchemas.filter(([pattern]) => pattern.test(key)).map(([, child]) => child);
      if (matchingPatterns.length > 0) {
        const childSchema = matchingPatterns.length === 1 ? matchingPatterns[0] : { allOf: matchingPatterns };
        defineOwnProperty(normalized, key, normalize(entry, childSchema, nextAncestors, forceStripObjects));
        continue;
      }
      if (rejectsAdditional) continue;
      const additionalSchema = additionalSchemas.length === 0
        ? undefined
        : additionalSchemas.length === 1
          ? additionalSchemas[0]
          : { allOf: additionalSchemas };
      defineOwnProperty(normalized, key, additionalSchema === undefined
        ? entry
        : normalize(entry, additionalSchema, nextAncestors, forceStripObjects));
    }
    return normalized;
  };
  const normalizer = (input: unknown): unknown => normalize(input, schema, new Set(), true);
  unknownPropertyNormalizers.set(schema, normalizer);
  return normalizer(value);
}

function projectMetrics(
  contract: CompiledWorkerContract,
  value: unknown,
): readonly ContractMetric[] | ContractValidationError {
  const metrics: ContractMetric[] = [];
  for (const output of contract.manifest.outputs.metrics) {
    const projected = jsonPointer(value, output.pointer);
    if (projected === MISSING || projected === null) {
      if (!output.required) continue;
      return new ContractValidationError({
        contract: contract.worker,
        message: `required metric output ${output.pointer || "(root)"} is missing`,
      });
    }
    const normalized = normalizeBenchmarkMetric(contract.worker, output.pointer, projected);
    if (normalized instanceof ContractValidationError) return normalized;
    metrics.push({ pointer: output.pointer, format: output.format, value: normalized });
  }
  return metrics;
}

export function compileWorkerContract(source: string, path: string): CompiledWorkerContract {
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch (cause) {
    throw new WorkerContractLoadError(path, `contract is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const parsed = workerContractManifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new WorkerContractLoadError(path, `invalid contract manifest: ${formatZodIssues(parsed.error)}`);
  }
  let validate: ValidateFunction;
  const stripUnknownProperties = stripsUnknownProperties(parsed.data);
  try {
    validateUnknownPropertySemantics(parsed.data.schema, stripUnknownProperties);
    if (stripUnknownProperties) validateStripSchemaDialect(parsed.data.schema);
    const ajv = new Ajv2020({
      allErrors: true,
      strict: true,
      ...(stripUnknownProperties ? { strictTuples: false } : {}),
    });
    addAssertionKeyword(ajv);
    addUnknownPropertiesKeyword(ajv);
    validate = ajv.compile(parsed.data.schema);
  } catch (cause) {
    throw new WorkerContractLoadError(path, `invalid JSON Schema: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  let normalizedExample: unknown = parsed.data.example;
  if (stripUnknownProperties) {
    try {
      normalizedExample = cloneForValidation(normalizedExample);
      normalizedExample = normalizeUnknownProperties(normalizedExample, parsed.data.schema);
    } catch (cause) {
      throw new WorkerContractLoadError(path, `contract example cannot be cloned for normalization: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  if (!validate(normalizedExample)) {
    throw new WorkerContractLoadError(path, `contract example fails schema: ${formatJsonSchemaErrors(validate.errors)}`);
  }
  const contract: CompiledWorkerContract = {
    path,
    worker: basename(path, ".json"),
    source,
    manifest: parsed.data,
    normalizedExample,
    validate,
  };
  const exampleMetrics = projectMetrics(contract, normalizedExample);
  if (exampleMetrics instanceof ContractValidationError) {
    throw new WorkerContractLoadError(path, `contract example has invalid outputs: ${exampleMetrics.message}`);
  }
  const exampleProjections = projectContractProjections(
    contract.worker,
    parsed.data.outputs.projections,
    normalizedExample,
  );
  if (exampleProjections instanceof ContractValidationError) {
    throw new WorkerContractLoadError(path, `contract example has invalid projections: ${exampleProjections.message}`);
  }
  return contract;
}

export function validateWorkerContract(
  contract: CompiledWorkerContract,
  payload: unknown,
): WorkerContractValidationResult {
  const normalized = stripsUnknownProperties(contract.manifest)
    ? (() => {
      try {
        const cloned = cloneForValidation(payload);
        return { value: normalizeUnknownProperties(cloned, contract.manifest.schema) };
      } catch (cause) {
        return { error: cause instanceof Error ? cause.message : String(cause) };
      }
    })()
    : { value: payload };
  if ("error" in normalized) {
    return {
      success: false,
      error: new ContractValidationError({
        contract: contract.worker,
        message: `validation payload could not be cloned for normalization: ${normalized.error}`,
      }),
    };
  }
  if (!contract.validate(normalized.value)) {
    return {
      success: false,
      error: new ContractValidationError({
        contract: contract.worker,
        message: `validation result failed contract "${contract.worker}": ${formatJsonSchemaErrors(contract.validate.errors)}`,
      }),
    };
  }
  const metrics = projectMetrics(contract, normalized.value);
  if (metrics instanceof ContractValidationError) return { success: false, error: metrics };
  const projections = projectContractProjections(
    contract.worker,
    contract.manifest.outputs.projections,
    normalized.value,
  );
  if (projections instanceof ContractValidationError) return { success: false, error: projections };
  return { success: true, value: normalized.value, metrics, projections };
}

export function workerContractGuidance(contract: CompiledWorkerContract): string {
  return JSON.stringify(contract.normalizedExample, null, 2);
}
