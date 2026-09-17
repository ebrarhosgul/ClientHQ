/**
 * The Drizzle schema, one file per area. `src/db/client.ts` hands this whole
 * module to `drizzle()`, so every table here is queryable through `db.query`.
 *
 * Spec 0002 settles every table, column, constraint, index and cascade. Change
 * a table here, then run `pnpm db:generate`; never hand edit the SQL under
 * `drizzle/`.
 */
export * from "./identity";
export * from "./clients";
export * from "./projects";
export * from "./invoices";
export * from "./webhooks";
export * from "./cron";
export * from "./relations";
export * from "./zod";
