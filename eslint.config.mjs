import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Apostrophes in JSX text are valid HTML and read better than &apos; everywhere.
      "react/no-unescaped-entities": "off",
    },
  },
  {
    // Test helpers wrap loosely typed JSON responses.
    files: ["tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "src/generated/**", "coverage/**", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
