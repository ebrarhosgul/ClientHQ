import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierCompat from "eslint-config-prettier/flat";

import { clienthqPlugin } from "./tools/eslint/plugin.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // The load bearing rules of the whole design, from specs 0001 and 0003.
  // Nothing outside the tenant scoping data access layer may import the raw
  // database handle, and nothing outside the webhook and cron routes may import
  // the unscoped system access door. Without these two, "tenant safe by
  // construction" is really just discipline.
  {
    name: "clienthq/tenant-isolation",
    plugins: { clienthq: clienthqPlugin },
    rules: {
      "clienthq/no-raw-db-import": "error",
      "clienthq/no-system-access-import": "error",
    },
  },

  // The data access layer itself, and nothing wider. Spec 0003 narrowed this
  // from `src/db/**`: the schema modules never needed the handle, and leaving
  // them exempt left a hole the rule could not see. `src/db/tenant/` is the one
  // directory that reaches it, through `src/db/tenant/executor.ts`.
  {
    name: "clienthq/tenant-isolation-data-access-layer",
    files: ["src/db/tenant/**"],
    rules: { "clienthq/no-raw-db-import": "off" },
  },

  // Three sanctioned exceptions, each an exact path. The first two are the
  // connection checks documented in `src/db/AGENTS.md`; neither reads a tenant
  // scoped table, one runs `select 1` and the other `select version()`. The
  // third is the handle module's own test, which cannot test a module it may
  // not import. Adding a fourth entry here is a decision about the tenant
  // boundary, so it belongs in a pull request discussion rather than a quiet
  // edit, and `tools/eslint/tenant-isolation-config.test.mts` fails if this
  // list and spec 0003 stop agreeing.
  {
    name: "clienthq/tenant-isolation-health-checks",
    files: [
      "src/app/api/health/db/route.ts",
      "scripts/db-check.ts",
      "src/db/client.test.ts",
    ],
    rules: { "clienthq/no-raw-db-import": "off" },
  },

  // The webhook and cron routes are the two callers with no tenant to resolve:
  // a signed provider event, and a sweep that crosses every organization by
  // design. Spec 0001 fixes these three paths, and nothing else may reach
  // `withSystemAccess`. The tenant layer itself is exempt so `system.ts` can be
  // written and tested at all.
  {
    name: "clienthq/system-access-callers",
    files: [
      "src/app/api/webhooks/stripe/route.ts",
      "src/app/api/webhooks/clerk/route.ts",
      "src/app/api/cron/daily/route.ts",
      "src/db/tenant/**",
    ],
    rules: { "clienthq/no-system-access-import": "off" },
  },

  // Plain hygiene, not a custom rule (spec 0011): only the storage port and
  // its setup script talk to R2. Everything else reaches storage through
  // `src/storage/`'s four functions, the same shape the in memory fake
  // stands in for in every test.
  {
    name: "clienthq/aws-sdk-boundary",
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@aws-sdk/*"],
              message:
                'Import the storage port from "@/storage" instead of the AWS SDK directly.',
            },
          ],
        },
      ],
    },
  },
  {
    name: "clienthq/aws-sdk-boundary-storage",
    files: ["src/storage/**", "scripts/r2-setup.ts"],
    rules: { "no-restricted-imports": "off" },
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
