import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "build/**",
      ".react-router/**",
      ".wrangler/**",
      "worker-configuration.d.ts",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: [
      "scripts/auth-values.mjs",
      "scripts/bootstrap.mjs",
      "scripts/install.mjs",
      "scripts/installer/**/*.mjs",
      "scripts/assert-deploy-ready-config.mjs",
      "scripts/verify-production-artifact.mjs",
    ],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      // React Router deliberately throws Response objects for redirects/statuses.
      "@typescript-eslint/only-throw-error": "off",
      // Assertions on Response.json() document the expected wire shape; the DOM
      // declaration currently returns any, so this rule reports false positives.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
);
