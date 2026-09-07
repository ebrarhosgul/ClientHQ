import { createGuardedImportRule } from "./guarded-import-rule.mjs";

/**
 * `clienthq/no-raw-db-import`
 *
 * The load bearing rule of the whole design, made mechanical.
 *
 * Nothing outside the tenant scoping data access layer may import the raw
 * Drizzle handle from `src/db/client.ts`. A query against a tenant scoped table
 * with no `org_id` predicate leaks one agency's rows to another, and nothing in
 * the database stops it: spec 0001 is explicit that this scoping fails open.
 * Until this rule existed the guarantee was discipline; now a stray import fails
 * the build.
 *
 * The exemption list lives in `eslint.config.mjs`, and spec 0003 fixes it at
 * `src/db/tenant/**`, the two connection checks, and the handle's own test.
 */
const rule = createGuardedImportRule({
  guarded: ["db", "client"],
  description:
    "Disallow importing the raw database handle outside the tenant scoping data access layer",
  messageId: "rawDbImport",
  message:
    "Do not import the raw database handle from `src/db/client.ts` here. " +
    "A query with no `org_id` predicate leaks one agency's rows to another, " +
    "and nothing in the database stops it. Go through the tenant scoping " +
    "data access layer in `src/db/tenant/` instead.",
});

export default rule;
