import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Vendored agent skills and generated artefacts. These are third party
    // sources and generated SQL, not code this project holds to its own rules.
    ".agents/**",
    ".claude/**",
    "docs/**",
    "drizzle/**",
  ]),
]);

export default eslintConfig;
