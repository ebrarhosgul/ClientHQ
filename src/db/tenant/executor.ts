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

/**
 * The handle's type, re export only.
 *
 * `withSystemAccess` hands a `Database` to the webhook and cron routes, and a
 * handler those routes call has to be able to name the thing it was given. The
 * ESLint fence blocks every import of `src/db/client.ts` outside this folder,
 * including a type only one, so the type is offered here instead.
 *
 * A type is not a capability: nothing that imports this can reach the handle,
 * only describe one it was already handed. The fence still holds.
 */
export type { Database };

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
