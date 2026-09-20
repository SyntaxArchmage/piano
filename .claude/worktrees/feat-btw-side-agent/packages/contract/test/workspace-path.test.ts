import { sep } from "node:path";
import { describe, expect, it } from "vitest";
import { workspaceRelativePathViolation } from "../src/workspace-path.js";

describe("workspace-relative path semantics", () => {
  it("treats backslash as an ordinary POSIX filename character", () => {
    const paths = ["..\\outside", "a\\..\\b", "C:relative", "C:\\absolute", "\\\\server\\share\\file"];
    const result = paths.map(workspaceRelativePathViolation);

    if (sep === "\\") {
      expect(result).toEqual(["segment", "segment", "absolute", "absolute", "absolute"]);
    } else {
      expect(result).toEqual([undefined, undefined, undefined, undefined, undefined]);
    }
  });

  it("recognizes slash traversal and absolute paths on every host", () => {
    expect(workspaceRelativePathViolation("../outside")).toBe("segment");
    expect(workspaceRelativePathViolation("src/../outside")).toBe("segment");
    expect(workspaceRelativePathViolation("/outside")).toBe("absolute");
  });
});
