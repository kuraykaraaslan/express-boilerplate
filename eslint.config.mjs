import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import unusedImports from "eslint-plugin-unused-imports";

export default [
  { files: ["**/*.{js,mjs,cjs,ts}", "server.ts", "index.ts"] },

  { languageOptions: { globals: {
    ...globals.node,
    ...globals.jest,
  }, } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "__tests__/**/*",
      "dictionaries/**/*",
      "utils/**/*",
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
      "@typescript-eslint/no-unsafe-declaration-merging": "off",
      "@typescript-eslint/no-unused-vars": [
        "off",
        {
          varsIgnorePattern: "^_|_|request|response|error|userSession",
          argsIgnorePattern: "^_|_|request|response|error|userSession",
          caughtErrorsIgnorePattern: "^_|error",
        },
      ],
      // no-explicit-any is too strict for some cases. ignore "error" values.
      "@typescript-eslint/no-explicit-any": ["off"],
      "unused-imports/no-unused-imports": "warn",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_|_|request|response|error|userSession",
          args: "after-used",
          argsIgnorePattern: "^_|_|request|response|error|userSession",
        },
      ],
    },
  },
];
