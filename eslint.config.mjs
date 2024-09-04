import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import unusedImports from "eslint-plugin-unused-imports";

export default [
  { files: ["src/*.{js,mjs,cjs,ts}"] },

  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "src/**/*.test.ts",
      "dist/**/*",
      "public/**/*",
      "node_modules/**/*",
      "prisma/**/*",
    ],
  },
  {
    plugins: {
      "unused-imports": unusedImports,
    },
    rules: {
      // Allow unused variables starting with exactly one underscore.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unsafe-declaration-merging": "off",
      "@typescript-eslint/no-unused-vars": [
        "off",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // no-explicit-any is too strict for some cases. ignore "error" values.
      "@typescript-eslint/no-explicit-any": ["off"],
    },
  },
];
