/**
 * The first door: a query shape the accessor cannot express, still tenant
 * scoped, with the predicate written by hand.
 *
 * The context is a required argument so the organization is right there in the
 * call, and the reason is required so the next person reading it knows why the
 * accessor was not enough. This is where a future leak would come from, so it
 * is meant to be conspicuous and rare: if it grows past a handful of call
 * sites, the accessor is missing a shape and should grow one instead (spec
 * 0003, Follow-up).
 */
import type { TenantContext } from "./context";
import { pooledDb, type Executor } from "./executor";
import { logEscapeHatch } from "./log";

export type UnsafeTenantQueryOptions = {
  /** An open transaction to join. Omit to run against the pooled handle. */
  readonly executor?: Executor;
  /**
   * Marks a call site that has already been reviewed and accepted as a
   * standing exception rather than a one off query, so it does not add a
   * console line every time it runs. Spec 0003's counting concern is how many
   * *call sites* the hatch has grown, not how many times an accepted one is
   * invoked; a hot path (a per request read, for instance) would otherwise
   * drown that signal in its own noise. The call site is still named
   * `unsafeTenantQuery` and still demands a `reason`, so it stays as easy to
   * grep for as any other. Set this only after writing down, in the reason or
   * nearby, why the query is accepted long term.
   */
  readonly audited?: boolean;
};

/**
 * Run a hand written query for one tenant.
 *
 * The tenant predicate is yours to write. `ctx.orgId` is what it must compare
 * against, and for a contact context `ctx.clientId` too.
 */
export async function unsafeTenantQuery<T>(
  ctx: TenantContext,
  reason: string,
  fn: (db: Executor, ctx: TenantContext) => Promise<T>,
  options?: UnsafeTenantQueryOptions,
): Promise<T> {
  if (reason.trim() === "") {
    throw new Error(
      "unsafeTenantQuery needs a reason: say why the accessor cannot express this.",
    );
  }

  if (options?.audited !== true) {
    logEscapeHatch({
      operation: "unsafeTenantQuery",
      reason,
      userId: ctx.userId,
      orgId: ctx.orgId,
    });
  }

  // Either the pooled handle or an open transaction. Both carry the same query
  // surface, so a hand written query behaves identically inside a transaction.
  return fn(options?.executor ?? (await pooledDb()), ctx);
}
