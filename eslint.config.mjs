import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Standalone Node scripts executed as harness binaries (not through the
    // TS test environment) need the Node globals. That covers the test helpers
    // and the dsh plugin Piano ships: the latter runs inside the dsh launcher's
    // process, which imports Node ESM and compiles nothing.
    files: ["tests/**/*.mjs", "packages/harness/src/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly" },
    },
  },
  {
    // The dashboard server is a plain Node ESM sidecar, started outside tsx.
    files: ["packages/dashboard/server/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        fetch: "readonly",
        AbortSignal: "readonly",
      },
    },
  },
  {
    // The browser bundle is served as-is; it has no build step and no imports.
    files: ["packages/dashboard/server/public/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
        fetch: "readonly",
        location: "readonly",
        history: "readonly",
        URLSearchParams: "readonly",
        ResizeObserver: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        Intl: "readonly",
        Node: "readonly",
      },
    },
  },
  { ignores: ["**/dist/", "scripts/"] }
);
