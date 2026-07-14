import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";
import noUnsanitized from "eslint-plugin-no-unsanitized";
import globals from "globals";

// Flat config (ESLint 10 / typescript-eslint 8) — one shared config at
// the repo root rather than six near-identical per-workspace copies.
// ESLint's flat-config loader searches upward from cwd for
// eslint.config.* , so each workspace's own "lint" script (just
// `eslint src`, run with that workspace as cwd) picks this file up
// without needing an explicit --config path.
//
// Scope (§44): the four type-aware rules named in the issue
// (no-floating-promises/no-misused-promises catch the unhandled/misused
// async bug class behind a prior "side-effect failure flips a SUCCESS
// run to FAILED" incident; require-await/no-unnecessary-condition catch
// dead logic), plus eslint-plugin-security everywhere and
// eslint-plugin-no-unsanitized on the frontend only. Deliberately not
// adopting the full strict-type-checked rule sets — that would pull in
// many additional rules with no relationship to this issue and a much
// larger existing-violation surface to fix.
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "packages/shared/prisma/generated/**",
      "packages/pdf-service/dist/**",
    ],
  },
  {
    files: ["packages/*/src/**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommended, security.configs.recommended],
    languageOptions: {
      parserOptions: {
        // Auto-discovers the nearest tsconfig.json per linted file
        // (each workspace has its own) instead of hand-listing all six.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      // This codebase already uses a leading underscore for intentionally
      // unused params (e.g. Express's 4-arg error-handler signature, or a
      // predicate kept structurally symmetric with its siblings).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Browser globals for the frontend workspace only — the rest are
    // Node services.
    files: ["packages/frontend/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ["packages/frontend/src/**/*.{ts,tsx}"],
    plugins: { "no-unsanitized": noUnsanitized },
    rules: noUnsanitized.configs.recommended.rules,
  },
);
