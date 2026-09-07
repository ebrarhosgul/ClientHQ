/**
 * The only file in the project that reaches the raw database handle.
 *
 * Spec 0003, AC-13 and the key invariants: `src/db/client.ts` is imported here
 * and in the two health checks, nowhere else. Everything above this line goes
 * through `tenantDb()`.
 *
 * The import is deliberately dynamic. `src/db/client.ts` reads `DATABASE_URL`
 * at module scope, so a static import would make merely *loading* the tenant
 * layer require a live connection string. That would drag a database
 * credential into unit tests and into any prerendered page, which
 * `src/db/AGENTS.md` explicitly warns against. Every method here is already
 * async, so awaiting the module costs nothing after the first call.
 */
import type { Database } from "../client";

/** An open transaction, exactly as Drizzle hands it to a `transaction()` callback. */
export type TransactionExecutor = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

/**
 * Whatever the accessor runs its statements on: the pooled handle, or a
 * transaction. Both carry the same query surface, which is what lets a
 * transactional accessor apply predicates identical to the ordinary one.
 */
export type Executor = Database | TransactionExecutor;

let cached: Database | undefined;

/** The pooled handle, loaded on first use. */
export async function pooledDb(): Promise<Database> {
  cached ??= (await import("../client")).db;
  return cached;
}
