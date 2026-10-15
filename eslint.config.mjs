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
  { ignores: ["**/dist/", "scripts/"] }
);
