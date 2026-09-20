import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { parseCaseConfig } from "../src/case-config.js";

const workloads = join(process.cwd(), "evals", "workloads");

describe("native CUDA eval case", () => {
  it("is an independent CUDA case and leaves the Triton matmul case intact", async () => {
    const nativePath = join(workloads, "cuda-matmul-tuning-pi-dsv4f", "case.yaml");
    const tritonPath = join(workloads, "matmul-512", "case.yaml");
    const [nativeSource, tritonSource] = await Promise.all([
      readFile(nativePath, "utf8"),
      readFile(tritonPath, "utf8"),
    ]);
    const native = Effect.runSyncExit(parseCaseConfig(nativeSource, nativePath));
    const triton = Effect.runSyncExit(parseCaseConfig(tritonSource, tritonPath));
    expect(Exit.isSuccess(native)).toBe(true);
    expect(Exit.isSuccess(triton)).toBe(true);
    if (!Exit.isSuccess(native) || !Exit.isSuccess(triton)) return;

    expect(native.value.id).toBe("cuda-matmul-tuning-pi-dsv4f");
    expect(native.value.workload).toMatchObject({ operator: "matmul", language: "cuda" });
    expect(native.value.workflow).toBe("../../../recipes/workflows/gpu-cuda-tuning.yml");
    expect(native.value.readout.compileCommand).toBe("python3 verify.py --compile");
    expect(native.value.readout.metricPattern).toBe("TFLOPS: ([0-9.]+)");
    expect(triton.value.id).toBe("matmul-512");
    expect(triton.value.workload).toMatchObject({ operator: "matmul", language: "python" });
  });

  it("ships the native source and -owned harness entrypoints", async () => {
    const files = await readdir(join(workloads, "cuda-matmul-tuning-pi-dsv4f", "workspace"));
    expect(files).toEqual(expect.arrayContaining([
      "Makefile",
      "README.md",
      "matmul.cu",
      "profile.py",
      "setup.py",
      "verify.py",
    ]));
  });
});
