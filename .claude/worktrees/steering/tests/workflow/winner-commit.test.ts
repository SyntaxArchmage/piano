import { describe, expect, it } from "vitest";
import { sep } from "node:path";
import { safeChangedFiles } from "../../packages/orchestrator/src/winner-commit.js";

describe("winner commit path guard", () => {
  it("uses host path semantics for workspace-relative filenames", () => {
    expect(safeChangedFiles(["../outside", "src/../outside"], new Set())).toEqual([]);

    const backslashPaths = ["..\\outside", "src\\..\\outside", "C:relative", "C:\\outside", "\\\\server\\share\\outside"];
    expect(safeChangedFiles(backslashPaths, new Set())).toEqual(
      sep === "\\" ? ["C:relative"] : backslashPaths,
    );
  });

  it("keeps ordinary workspace-relative paths", () => {
    expect(safeChangedFiles(["src/kernel.tops", "src\\kernel.tops"], new Set())).toEqual([
      "src/kernel.tops",
      "src\\kernel.tops",
    ]);
  });
});
