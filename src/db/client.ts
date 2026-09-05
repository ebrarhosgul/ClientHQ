import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * The raw database handle.
 *
 * WARNING, and this is the load bearing rule of the whole design: nothing
 * outside the tenant scoping data access layer may import `db`. A query against
 * a tenant scoped table without an `org_id` predicate leaks one agency's rows to
 * another, and nothing in the database stops it. Spec 0001 is explicit that this
 * scoping fails open.
 *
 * Two things are still owed and are tracked in the scope:
 *
 *   - Feature 4 builds the scoping layer that takes a resolved tenant context as
 *     a required argument and hands back a scoped query builder, so an unscoped
 *     query cannot be written by accident. Once it exists, this module stops
 *     being importable from anywhere else.
 *   - Feature 2 adds the ESLint rule that makes importing this file from outside
 *     that layer fail the build. Until that rule is in place, the guarantee is
 *     discipline rather than construction.
 *
 * Connection notes: this points at the Supabase transaction mode pooler on port
 * 6543, so prepared statements are switched off. PgBouncer hands each
 * transaction a different backend connection, and a named prepared statement
 * does not survive that. Leaving `prepare` on produces confusing runtime errors
 * that look nothing like their cause.
 */

const connectionString = env().DATABASE_URL;

// In development Next reloads modules on every edit. Caching the client on
// `globalThis` stops each reload opening another pool against Supabase, whose
// free tier connection budget is small.
const globalForDb = globalThis as unknown as {
  __clienthqSql?: ReturnType<typeof postgres>;
};

const sql =
  globalForDb.__clienthqSql ??
  postgres(connectionString, {
    prepare: false,
    // Serverless functions are short lived and many. Keep each one's pool tiny.
    max: 1,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__clienthqSql = sql;
}

export const db = drizzle(sql, { schema });

export type Database = typeof db;
