import type {
  ContractProjection,
  ContractProjectionDeclaration,
} from "@piano/contract";

const GPU_ROUND_MATERIALIZATION_MARKER = "round.materialization-v1";

const GPU_ROUND_PROJECTION_FORMATS = {
  [GPU_ROUND_MATERIALIZATION_MARKER]: "json",
  "round.iteration": "number",
  "round.decision": "string",
  "round.candidate": "json",
  "round.current-best": "json",
  "round.verification": "json",
  "round.promotion": "json",
  "round.records": "json",
  "benchmark.evidence": "json",
} as const;

/** The semantic projections every materializable round must carry — and whose
 * values materialization may replace. Leaf projections such as
 * verification.passed and benchmark.evidence intentionally do not participate:
 * they are derived observations under the aggregate protocol values, not
 * replacement roots. */
const REQUIRED_GPU_ROUND_VALUES = [
  GPU_ROUND_MATERIALIZATION_MARKER,
  "round.iteration",
  "round.decision",
  "round.candidate",
  "round.current-best",
  "round.verification",
  "round.promotion",
  "round.records",
] as const;

type JsonRecord = Record<string, unknown>;

export interface GpuRoundMaterializationProtocol {
  readonly marker: ContractProjection;
  readonly iteration: number;
  readonly decision: "KEEP" | "DISCARD" | "COMPILE_FAIL" | "VERIFY_FAIL" | "BLOCKED";
  readonly decisionProjection: ContractProjection;
  readonly candidate: JsonRecord & { readonly path: string };
  readonly candidateProjection: ContractProjection;
  readonly currentBest: JsonRecord & { readonly path: string };
  readonly currentBestProjection: ContractProjection;
  readonly verification: JsonRecord;
  readonly promotion: JsonRecord & {
    readonly promoted: boolean;
    readonly resulting_best: JsonRecord & { readonly path: string };
  };
  readonly promotionProjection: ContractProjection;
  readonly records: JsonRecord & {
    readonly round_path: string;
    readonly state_path: string;
  };
  readonly benchmark?: JsonRecord;
}

function record(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function protocolError(message: string): Error {
  return new Error(`invalid ${GPU_ROUND_MATERIALIZATION_MARKER} protocol: ${message}`);
}

function pointerIsPrefix(prefix: readonly string[], value: readonly string[]): boolean {
  return prefix.length < value.length && prefix.every((token, index) => token === value[index]);
}

/** Reject ambiguous replacement layouts while allowing the protocol marker
 * to be an envelope around its own payload (including the canonical root
 * marker pointer ""). The marker is metadata for the aggregate payload; it
 * is not treated as a conflicting replacement when it is a strict ancestor
 * of the protocol's semantic fields. */
function validateMaterializationPointerLayout(
  declarationsById: ReadonlyMap<string, ContractProjectionDeclaration>,
): void {
  const pointers = REQUIRED_GPU_ROUND_VALUES.map((id) => {
    const declaration = declarationsById.get(id);
    if (declaration === undefined) throw protocolError(`missing projection declaration "${id}"`);
    return { id, tokens: pointerTokens(declaration.pointer) };
  });
  const marker = pointers.find(({ id }) => id === GPU_ROUND_MATERIALIZATION_MARKER)!;

  for (let leftIndex = 0; leftIndex < pointers.length; leftIndex += 1) {
    const left = pointers[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < pointers.length; rightIndex += 1) {
      const right = pointers[rightIndex]!;
      const markerEnvelope = left.id === marker.id || right.id === marker.id;
      if (markerEnvelope) {
        const other = left.id === marker.id ? right : left;
        if (pointerIsPrefix(marker.tokens, other.tokens)) continue;
      }
      if (pointerIsPrefix(left.tokens, right.tokens) || pointerIsPrefix(right.tokens, left.tokens) ||
          (left.tokens.length === right.tokens.length && left.tokens.every((token, index) => token === right.tokens[index]))) {
        throw protocolError(`semantic projection pointers "${left.id}" and "${right.id}" overlap`);
      }
    }
  }
}

/**
 * Resolve the explicit GPU-round materialization capability from one
 * validated contract result. The marker is inert unless every protocol field
 * is declared with the expected projection format. This keeps similarly named
 * payload fields from granting file-write behavior accidentally.
 */
export function gpuRoundMaterializationProtocol(
  declarations: readonly ContractProjectionDeclaration[],
  projections: readonly ContractProjection[],
): GpuRoundMaterializationProtocol | undefined {
  if (!declarations.some((declaration) => declaration.id === GPU_ROUND_MATERIALIZATION_MARKER)) {
    return undefined;
  }

  const declarationsById = new Map(declarations.map((declaration) => [declaration.id, declaration]));
  for (const [id, format] of Object.entries(GPU_ROUND_PROJECTION_FORMATS)) {
    const declaration = declarationsById.get(id);
    if (declaration === undefined) throw protocolError(`missing projection declaration "${id}"`);
    if (declaration.format !== format) {
      throw protocolError(`projection "${id}" must use format "${format}"`);
    }
    if (id !== "benchmark.evidence" && declaration.required === false) {
      throw protocolError(`projection "${id}" must be required`);
    }
  }
  validateMaterializationPointerLayout(declarationsById);

  const projectionsById = new Map(projections.map((projection) => [projection.id, projection]));
  for (const id of REQUIRED_GPU_ROUND_VALUES) {
    if (!projectionsById.has(id)) throw protocolError(`missing projected value "${id}"`);
  }

  const projection = (id: string): ContractProjection => {
    const value = projectionsById.get(id);
    if (value === undefined) throw protocolError(`missing projected value "${id}"`);
    const declaration = declarationsById.get(id)!;
    if (value.pointer !== declaration.pointer || value.format !== declaration.format) {
      throw protocolError(`projection "${id}" is not bound to its contract declaration`);
    }
    return value;
  };

  const marker = projection(GPU_ROUND_MATERIALIZATION_MARKER);
  if (record(marker.value) === undefined) throw protocolError("materialization marker must project a JSON object");

  const iteration = projection("round.iteration").value;
  // Match both compatibility validators: Zod's integer check and JSON
  // Schema's `integer` type do not impose Number.isSafeInteger.
  if (typeof iteration !== "number" || !Number.isFinite(iteration) || !Number.isInteger(iteration) || iteration < 0) {
    throw protocolError("round.iteration must be a finite non-negative integer");
  }

  const decisionProjection = projection("round.decision");
  const decision = decisionProjection.value;
  if (decision !== "KEEP" && decision !== "DISCARD" && decision !== "COMPILE_FAIL" &&
      decision !== "VERIFY_FAIL" && decision !== "BLOCKED") {
    throw protocolError("round.decision is not a supported GPU round decision");
  }

  const candidateProjection = projection("round.candidate");
  const candidate = record(candidateProjection.value);
  if (candidate === undefined || !nonEmptyString(candidate.path)) {
    throw protocolError("round.candidate must contain a non-empty path");
  }

  const currentBestProjection = projection("round.current-best");
  const currentBest = record(currentBestProjection.value);
  if (currentBest === undefined || !nonEmptyString(currentBest.path)) {
    throw protocolError("round.current-best must contain a non-empty path");
  }

  const verification = record(projection("round.verification").value);
  if (verification === undefined || typeof verification.compile_passed !== "boolean" ||
      typeof verification.verify_passed !== "boolean") {
    throw protocolError("round.verification must contain boolean compile_passed and verify_passed values");
  }

  const promotionProjection = projection("round.promotion");
  const promotion = record(promotionProjection.value);
  const resultingBest = record(promotion?.resulting_best);
  if (promotion === undefined || typeof promotion.promoted !== "boolean" ||
      resultingBest === undefined || !nonEmptyString(resultingBest.path)) {
    throw protocolError("round.promotion must contain promoted and resulting_best.path");
  }

  const records = record(projection("round.records").value);
  if (records === undefined || !nonEmptyString(records.round_path) || !nonEmptyString(records.state_path)) {
    throw protocolError("round.records must contain non-empty round_path and state_path values");
  }

  const benchmarkValue = projectionsById.get("benchmark.evidence")?.value;
  const benchmark = benchmarkValue === undefined ? undefined : record(benchmarkValue);
  if (benchmarkValue !== undefined && benchmark === undefined) {
    throw protocolError("benchmark.evidence must be a JSON object when present");
  }
  if (benchmark !== undefined && (
    (!nonEmptyString(benchmark.name) && !nonEmptyString(benchmark.metric)) ||
    (benchmark.direction !== "higher" && benchmark.direction !== "lower") ||
    typeof benchmark.best !== "number" || !Number.isFinite(benchmark.best)
  )) {
    throw protocolError("benchmark.evidence must contain name or metric, direction, and finite best");
  }
  if ((decision === "KEEP" || decision === "DISCARD") && benchmark === undefined) {
    throw protocolError(`${decision} requires benchmark.evidence`);
  }
  const compilePassed = verification.compile_passed;
  const verifyPassed = verification.verify_passed;
  const expectedDecision = !compilePassed
    ? "COMPILE_FAIL"
    : !verifyPassed
      ? "VERIFY_FAIL"
      : undefined;
  if (expectedDecision !== undefined && decision !== expectedDecision) {
    throw protocolError(`verification state requires round.decision ${expectedDecision}`);
  }
  if (expectedDecision !== undefined && benchmark !== undefined) {
    throw protocolError(`${expectedDecision} must not include benchmark.evidence`);
  }
  if (compilePassed && verifyPassed && decision !== "KEEP" && decision !== "DISCARD" && decision !== "BLOCKED") {
    throw protocolError("successful verification requires KEEP, DISCARD, or BLOCKED");
  }
  if (decision === "BLOCKED" && benchmark !== undefined) {
    throw protocolError("BLOCKED must not include benchmark.evidence");
  }
  if (promotion === undefined || promotion.promoted !== (decision === "KEEP")) {
    throw protocolError("round.promotion.promoted must be true exactly for KEEP");
  }

  return {
    marker,
    iteration,
    decision,
    decisionProjection,
    candidate: candidate as GpuRoundMaterializationProtocol["candidate"],
    candidateProjection,
    currentBest: currentBest as GpuRoundMaterializationProtocol["currentBest"],
    currentBestProjection,
    verification,
    promotion: {
      ...promotion,
      promoted: promotion.promoted,
      resulting_best: resultingBest as GpuRoundMaterializationProtocol["promotion"]["resulting_best"],
    },
    promotionProjection,
    records: records as GpuRoundMaterializationProtocol["records"],
    ...(benchmark === undefined ? {} : { benchmark }),
  };
}

function pointerTokens(pointer: string): readonly string[] {
  if (pointer === "") return [];
  return pointer.slice(1).split("/").map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** Replace the value selected by a validated projection without assuming any
 * payload layout. Every traversed segment must already exist. */
export function replaceProjectedValue(
  payload: unknown,
  projection: ContractProjection,
  replacement: unknown,
): unknown {
  const tokens = pointerTokens(projection.pointer);
  const replace = (current: unknown, index: number): unknown => {
    if (index === tokens.length) return replacement;
    const token = tokens[index]!;
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(token)) {
        throw protocolError(`projection "${projection.id}" does not select an existing array element`);
      }
      const position = Number(token);
      if (!Number.isSafeInteger(position) || position >= current.length) {
        throw protocolError(`projection "${projection.id}" does not select an existing array element`);
      }
      const clone = [...current];
      clone[position] = replace(current[position], index + 1);
      return clone;
    }
    const currentRecord = record(current);
    if (currentRecord === undefined || !Object.prototype.hasOwnProperty.call(currentRecord, token)) {
      throw protocolError(`projection "${projection.id}" does not select an existing payload value`);
    }
    const clone = { ...currentRecord };
    Object.defineProperty(clone, token, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: replace(currentRecord[token], index + 1),
    });
    return clone;
  };
  return replace(payload, 0);
}
