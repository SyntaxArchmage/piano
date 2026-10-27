import { describe, expect, it } from "vitest";
import { resolveLangfuseConfig } from "../src/config.js";

describe("resolveLangfuseConfig", () => {
  it("is disabled when the three keys are missing", () => {
    expect(resolveLangfuseConfig({})).toBeUndefined();
    expect(resolveLangfuseConfig({ LANGFUSE_BASE_URL: "https://langfuse.internal" })).toBeUndefined();
    expect(
      resolveLangfuseConfig({
        LANGFUSE_BASE_URL: "https://langfuse.internal",
        LANGFUSE_PUBLIC_KEY: "pk_test",
      }),
    ).toBeUndefined();
  });

  it("is disabled when a key is only a template placeholder or whitespace", () => {
    expect(
      resolveLangfuseConfig({
        LANGFUSE_BASE_URL: "https://langfuse.internal",
        LANGFUSE_PUBLIC_KEY: "CHANGE_ME",
        LANGFUSE_SECRET_KEY: "  ",
      }),
    ).toBeUndefined();
  });

  it("resolves the native LANGFUSE_* keys and defaults mask on", () => {
    expect(
      resolveLangfuseConfig({
        LANGFUSE_BASE_URL: "https://langfuse.internal",
        LANGFUSE_PUBLIC_KEY: "pk_test",
        LANGFUSE_SECRET_KEY: "sk_test",
      }),
    ).toEqual({
      baseUrl: "https://langfuse.internal",
      publicKey: "pk_test",
      secretKey: "sk_test",
      mask: true,
    });
  });

  it("prefers PIANO_LANGFUSE_* over LANGFUSE_*", () => {
    expect(
      resolveLangfuseConfig({
        LANGFUSE_BASE_URL: "https://cloud.langfuse.com",
        LANGFUSE_PUBLIC_KEY: "pk_langfuse",
        LANGFUSE_SECRET_KEY: "sk_langfuse",
        PIANO_LANGFUSE_BASE_URL: "https://langfuse.internal",
        PIANO_LANGFUSE_PUBLIC_KEY: "pk_piano",
        PIANO_LANGFUSE_SECRET_KEY: "sk_piano",
        PIANO_LANGFUSE_ENVIRONMENT: "staging",
        PIANO_LANGFUSE_RELEASE: "piano@1",
      }),
    ).toEqual({
      baseUrl: "https://langfuse.internal",
      publicKey: "pk_piano",
      secretKey: "sk_piano",
      environment: "staging",
      release: "piano@1",
      mask: true,
    });
  });

  it("honours PIANO_LANGFUSE_ENABLED=0 even when the keys are present", () => {
    expect(
      resolveLangfuseConfig({
        PIANO_LANGFUSE_ENABLED: "0",
        LANGFUSE_BASE_URL: "https://langfuse.internal",
        LANGFUSE_PUBLIC_KEY: "pk_test",
        LANGFUSE_SECRET_KEY: "sk_test",
      }),
    ).toBeUndefined();
  });

  it("lets PIANO_LANGFUSE_MASK=0 turn masking off deliberately", () => {
    expect(
      resolveLangfuseConfig({
        PIANO_LANGFUSE_MASK: "0",
        LANGFUSE_BASE_URL: "https://langfuse.internal",
        LANGFUSE_PUBLIC_KEY: "pk_test",
        LANGFUSE_SECRET_KEY: "sk_test",
      })?.mask,
    ).toBe(false);
  });
});
