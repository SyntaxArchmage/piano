import { describe, expect, it } from "vitest";
import { maskLangfusePayload } from "../src/mask.js";

/** Only what leaves the machine is masked. The sink masks the payload where it
 * is still structured — the processor's own `mask` hook sees `input`/`output`
 * already stringified, which hides the key names a secret hides behind. */
describe("maskLangfusePayload", () => {
  it("redacts a secret-named field wherever it is nested", () => {
    expect(maskLangfusePayload({
      data: { command: "curl", args: { apiKey: "hunter2" } },
    })).toEqual({ command: "curl", args: { apiKey: "[redacted]" } });
  });

  it("redacts a secret-named field inside an array", () => {
    expect(maskLangfusePayload({
      data: [{ authorization: "Bearer abc" }, { keep: "visible" }],
    })).toEqual([{ authorization: "[redacted]" }, { keep: "visible" }]);
  });

  it("redacts secret-shaped values wherever they appear", () => {
    expect(maskLangfusePayload({ data: "token sk-abcdef123456 here" }))
      .toBe("token [redacted] here");
    expect(maskLangfusePayload({ data: { note: "use pk-abcdef123456" } }))
      .toEqual({ note: "use [redacted]" });
  });

  it("leaves plain text and non-secret fields alone", () => {
    expect(maskLangfusePayload({ data: "measured 12.3 ops/s" })).toBe("measured 12.3 ops/s");
    expect(maskLangfusePayload({ data: { path: "a.ts" } })).toEqual({ path: "a.ts" });
  });

  it("cuts off a deeply nested payload rather than walking it", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: "x" } } } } } } } } } };
    expect(maskLangfusePayload({ data: deep })).toEqual(
      { a: { b: { c: { d: { e: { f: { g: { h: { i: "[redacted]" } } } } } } } } },
    );
  });
});
