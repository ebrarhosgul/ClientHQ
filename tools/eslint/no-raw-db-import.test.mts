// @vitest-environment node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "eslint";
import { describe, it } from "vitest";

import rule from "./no-raw-db-import.mjs";

/**
 * The rule that makes tenant isolation mechanical instead of merely intended.
 * It resolves specifiers to real paths, so these cases care about every way the
 * same file can be spelled, not about string matching.
 */

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const file = (relative: string) => path.join(ROOT, relative);

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const rawDbImport = [{ messageId: "rawDbImport" }];

describe("clienthq/no-raw-db-import", () => {
  it("catches every spelling of the raw handle and leaves everything else alone", () => {
    ruleTester.run("no-raw-db-import", rule, {
      valid: [
        // Other modules under `src/db/` are fine; only `client` is guarded.
        {
          code: `import * as schema from "@/db/schema";`,
          filename: file("src/invoices/queries.ts"),
        },
        // A package whose name happens to end the same way is not this file.
        {
          code: `import { db } from "some-package/db/client";`,
          filename: file("src/invoices/queries.ts"),
        },
        // A different project file that merely shares the basename.
        {
          code: `import { client } from "@/lib/db/client";`,
          filename: file("src/invoices/queries.ts"),
        },
        // The data access layer's own neighbours reach it relatively. The
        // config, not the rule, is what exempts them, so the rule still
        // reports here; this case only proves an unrelated relative import is
        // left alone.
        {
          code: `import { env } from "../lib/env";`,
          filename: file("src/db/scoped.ts"),
        },
      ],

      invalid: [
        // The alias.
        {
          code: `import { db } from "@/db/client";`,
          filename: file("src/invoices/queries.ts"),
          errors: rawDbImport,
        },
        // A relative path, one level up.
        {
          code: `import { db } from "../db/client";`,
          filename: file("src/invoices/queries.ts"),
          errors: rawDbImport,
        },
        // A deeper relative path, from outside `src/` entirely.
        {
          code: `import { db } from "../src/db/client";`,
          filename: file("scripts/backfill.ts"),
          errors: rawDbImport,
        },
        // Spelled with its extension.
        {
          code: `import { db } from "@/db/client.ts";`,
          filename: file("src/invoices/queries.ts"),
          errors: rawDbImport,
        },
        // A dynamic import, which is how a route handler would reach it.
        {
          code: `export async function GET() { const { db } = await import("@/db/client"); return db; }`,
          filename: file("src/app/api/leak/route.ts"),
          errors: rawDbImport,
        },
        // Re-exporting it launders the import, so that is caught too.
        {
          code: `export { db } from "@/db/client";`,
          filename: file("src/invoices/index.ts"),
          errors: rawDbImport,
        },
        {
          code: `export * from "@/db/client";`,
          filename: file("src/invoices/index.ts"),
          errors: rawDbImport,
        },
        // CommonJS, for a config or script that is not ESM.
        {
          code: `const { db } = require("../src/db/client");`,
          filename: file("scripts/backfill.cjs"),
          errors: rawDbImport,
        },
      ],
    });
  });
});
