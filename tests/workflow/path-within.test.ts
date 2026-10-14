import { describe, expect, it } from "vitest";
import { pathWithin } from "../../packages/orchestrator/src/path-within.js";

describe("pathWithin", () => {
  it("counts the parent itself as inside unless the caller says otherwise", () => {
    expect(pathWithin("/root", "/root")).toBe(true);
    expect(pathWithin("/root", "/root", false)).toBe(false);
  });

  it("counts a nested path as inside and a sibling or an escape as outside", () => {
    expect(pathWithin("/root", "/root/sub/file")).toBe(true);
    expect(pathWithin("/root/sub", "/root/sibling")).toBe(false);
    expect(pathWithin("/root", "/root/../elsewhere")).toBe(false);
    expect(pathWithin("/root", "/elsewhere")).toBe(false);
  });

  it("resolves relative inputs before comparing, so a traversal cannot hide", () => {
    expect(pathWithin("a/b", "a/b/c")).toBe(true);
    expect(pathWithin("a/b", "a/b/../c")).toBe(false);
    expect(pathWithin("a/b", "a/c")).toBe(false);
  });

  it("counts a directory whose name merely starts with dots as inside", () => {
    expect(pathWithin("/root", "/root/..cache/.git/config")).toBe(true);
    expect(pathWithin("/root", "/root/..cache")).toBe(true);
    expect(pathWithin("/root", "/root/..")).toBe(false);
  });

  it("fails a NUL byte the same way an escape fails", () => {
    expect(pathWithin("/root", "/root/\0bad")).toBe(false);
  });
});
