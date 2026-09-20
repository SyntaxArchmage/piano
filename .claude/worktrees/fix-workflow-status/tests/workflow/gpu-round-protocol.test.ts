import { describe, expect, it } from "vitest";
import {
  gpuRoundMaterializationProtocol,
  type GpuRoundMaterializationProtocol,
} from "../../packages/orchestrator/src/gpu-round-protocol.js";
import type {
  ContractProjection,
  ContractProjectionDeclaration,
} from "@piano/contract";

const benchmark = {
  name: "tflops",
  unit: "TFLOP/s",
  direction: "higher",
  samples: [10, 11],
  best: 11,
  median: 10.5,
  runs: 2,
  warmup: 1,
};

type ProtocolOverrides = {
  readonly iteration?: unknown;
  readonly decision?: string;
  readonly verification?: { readonly compile_passed: boolean; readonly verify_passed: boolean };
  readonly promotion?: { readonly promoted: boolean };
  readonly benchmark?: Record<string, unknown>;
};

function declarations(prefix = ""): readonly ContractProjectionDeclaration[] {
  const pointer = (path: string) => `${prefix}${path}`;
  return [
    { id: "round.materialization-v1", pointer: prefix === "" ? "" : prefix, format: "json", required: true },
    { id: "round.iteration", pointer: pointer("/iteration"), format: "number", required: true },
    { id: "round.decision", pointer: pointer("/decision"), format: "string", required: true },
    { id: "round.candidate", pointer: pointer("/candidate"), format: "json", required: true },
    { id: "round.current-best", pointer: pointer("/current-best"), format: "json", required: true },
    { id: "round.verification", pointer: pointer("/verification"), format: "json", required: true },
    { id: "round.promotion", pointer: pointer("/promotion"), format: "json", required: true },
    { id: "round.records", pointer: pointer("/records"), format: "json", required: true },
    { id: "benchmark.evidence", pointer: pointer("/benchmark"), format: "json", required: false },
  ];
}

function protocolFor(
  overrides: ProtocolOverrides = {},
  prefix = "",
): { readonly declarations: readonly ContractProjectionDeclaration[]; readonly projections: readonly ContractProjection[] } {
  const selectedDeclarations = declarations(prefix);
  const values: Record<string, unknown> = {
    "round.materialization-v1": { protocol: "test" },
    "round.iteration": overrides.iteration ?? 0,
    "round.decision": overrides.decision ?? "KEEP",
    "round.candidate": { path: "candidate.py" },
    "round.current-best": { path: "state/current-best.py" },
    "round.verification": overrides.verification ?? { compile_passed: true, verify_passed: true },
    "round.promotion": {
      promoted: overrides.promotion?.promoted ?? true,
      resulting_best: { path: "state/current-best.py" },
    },
    "round.records": { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
  };
  if ("benchmark" in overrides) {
    if (overrides.benchmark !== undefined) values["benchmark.evidence"] = overrides.benchmark;
  } else {
    values["benchmark.evidence"] = benchmark;
  }
  return {
    declarations: selectedDeclarations,
    projections: selectedDeclarations.flatMap((declaration) => {
      const value = values[declaration.id];
      return value === undefined
        ? []
        : [{ id: declaration.id, pointer: declaration.pointer, format: declaration.format, value }];
    }),
  };
}

function protocol(overrides: ProtocolOverrides = {}, prefix = ""): GpuRoundMaterializationProtocol | undefined {
  const input = protocolFor(overrides, prefix);
  return gpuRoundMaterializationProtocol(input.declarations, input.projections);
}

describe("GPU round materialization protocol", () => {
  it.each([-1, 1.5, Number.POSITIVE_INFINITY, Number.NaN])(
    "requires a finite non-negative integer iteration (%s)",
    (iteration) => {
      expect(() => protocol({ iteration })).toThrow(/round\.iteration must be a finite non-negative integer/);
    },
  );

  it("accepts an integer beyond Number.MAX_SAFE_INTEGER for legacy parity", () => {
    expect(protocol({ iteration: Number.MAX_SAFE_INTEGER + 1 })).toBeDefined();
  });

  it("accepts both the legacy metric shape and the name/unit metric shape", () => {
    const legacy = protocol({
      benchmark: {
        metric: "tflops",
        direction: "higher",
        samples: [10, 11],
        best: 11,
        median: 10.5,
        runs: 2,
        warmup: 1,
      },
    });
    const modern = protocol({ benchmark });

    expect(legacy?.benchmark).toMatchObject({ metric: "tflops", best: 11 });
    expect(modern?.benchmark).toMatchObject({ name: "tflops", unit: "TFLOP/s", best: 11 });
  });

  it("enforces builtin verification, benchmark, and promotion invariants", () => {
    expect(() => protocol({
      decision: "KEEP",
      verification: { compile_passed: false, verify_passed: true },
    })).toThrow(/requires round\.decision COMPILE_FAIL/);

    expect(protocol({
      decision: "VERIFY_FAIL",
      verification: { compile_passed: true, verify_passed: false },
      benchmark: undefined,
      promotion: { promoted: false },
    })).toBeDefined();
    expect(() => protocol({
      decision: "VERIFY_FAIL",
      verification: { compile_passed: true, verify_passed: false },
      benchmark,
      promotion: { promoted: false },
    })).toThrow(/VERIFY_FAIL must not include benchmark\.evidence/);

    expect(() => protocol({
      decision: "COMPILE_FAIL",
      verification: { compile_passed: true, verify_passed: true },
      benchmark: undefined,
      promotion: { promoted: false },
    })).toThrow(/successful verification requires KEEP, DISCARD, or BLOCKED/);

    expect(protocol({
      decision: "DISCARD",
      promotion: { promoted: false },
    })).toBeDefined();
    expect(() => protocol({ decision: "KEEP", benchmark: undefined })).toThrow(/KEEP requires benchmark\.evidence/);
    expect(() => protocol({ decision: "DISCARD", benchmark: undefined, promotion: { promoted: false } }))
      .toThrow(/DISCARD requires benchmark\.evidence/);
    expect(protocol({ decision: "BLOCKED", benchmark: undefined, promotion: { promoted: false } }))
      .toBeDefined();
    expect(() => protocol({ decision: "BLOCKED", promotion: { promoted: false }, benchmark }))
      .toThrow(/BLOCKED must not include benchmark\.evidence/);
    expect(() => protocol({ decision: "KEEP", promotion: { promoted: false } }))
      .toThrow(/promoted must be true exactly for KEEP/);
    expect(() => protocol({ decision: "DISCARD", promotion: { promoted: true } }))
      .toThrow(/promoted must be true exactly for KEEP/);
  });

  it("allows the canonical root marker and a marker envelope around its payload", () => {
    expect(protocol()).toBeDefined();
    expect(protocol({}, "/report")).toBeDefined();
  });

  it("rejects overlapping semantic replacement pointers but permits independent pointers", () => {
    const independent = protocol();
    expect(independent).toBeDefined();

    const overlapping = protocolFor();
    const altered = overlapping.declarations.map((declaration) =>
      declaration.id === "round.candidate"
        ? { ...declaration, pointer: "/round" }
        : declaration.id === "round.current-best"
          ? { ...declaration, pointer: "/round/incumbent" }
          : declaration,
    );
    const alteredProjections = overlapping.projections.map((projection) => {
      const declaration = altered.find((candidate) => candidate.id === projection.id)!;
      return { ...projection, pointer: declaration.pointer };
    });
    expect(() => gpuRoundMaterializationProtocol(altered, alteredProjections))
      .toThrow(/round\.candidate.*round\.current-best.*overlap|round\.current-best.*round\.candidate.*overlap/);
  });
});
