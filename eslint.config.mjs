import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierCompat from "eslint-config-prettier/flat";

import { clienthqPlugin } from "./tools/eslint/no-raw-db-import.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // The load bearing rule of the whole design, from spec 0001: nothing outside
  // the tenant scoping data access layer may import the raw database handle.
  // Without it, "tenant safe by construction" is really just discipline.
  {
    name: "clienthq/tenant-isolation",
    plugins: { clienthq: clienthqPlugin },
    rules: { "clienthq/no-raw-db-import": "error" },
  },

  // The data access layer itself. `src/db/` is where the raw handle lives and
  // where feature 4 builds the scoping helper every other query goes through,
  // so this is the one directory that is allowed to reach it.
  {
    name: "clienthq/tenant-isolation-data-access-layer",
    files: ["src/db/**"],
    rules: { "clienthq/no-raw-db-import": "off" },
  },

  // Two sanctioned exceptions, both connection checks documented in
  // `src/db/AGENTS.md`. Neither reads a tenant scoped table: one runs
  // `select 1`, the other `select version()`. Adding a third entry here is a
  // decision about the tenant boundary, so it belongs in a pull request
  // discussion rather than a quiet edit.
  {
    name: "clienthq/tenant-isolation-health-checks",
    files: ["src/app/api/health/db/route.ts", "scripts/db-check.ts"],
    rules: { "clienthq/no-raw-db-import": "off" },
  },

  // Last, so it wins: turns off every ESLint rule that would argue with
  // Prettier about formatting. ESLint judges code, Prettier decides layout.
  prettierCompat,

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
