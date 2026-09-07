/**
 * The second door: unscoped database access, for the two callers that have no
 * tenant at all.
 *
 * A Stripe or Clerk webhook arrives with a provider's event, not a session. The
 * daily cron sweeps across every organization by design. Neither can resolve a
 * tenant, so neither can use the accessor, and pretending otherwise would mean
 * a fake context that other code could copy.
 *
 * Reaching this is deliberately awkward. It is importable only from the webhook
 * and cron route files (ESLint enforces that, see `eslint.config.mjs`), it
 * demands a reason in writing, and every grant is logged. If you are reading
 * this because you want it somewhere else, you want `tenantDb` or
 * `unsafeTenantQuery` instead (spec 0003, AC-12).
 */
import type { Database } from "../client";
import { pooledDb } from "./executor";
import { logSystemAccess } from "./log";

/**
 * Run something against the whole database, with the reason recorded.
 *
 * @param reason why this caller has no tenant, in a few plain words
 * @param fn what to run
 */
export async function withSystemAccess<T>(
  reason: string,
  fn: (db: Database) => Promise<T>,
): Promise<T> {
  if (reason.trim() === "") {
    throw new Error(
      "withSystemAccess needs a reason: say why this caller has no tenant.",
    );
  }

  logSystemAccess(reason);

  return fn(await pooledDb());
}
