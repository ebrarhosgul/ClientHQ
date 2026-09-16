/**
 * One transaction on the pooled handle, with the scoped accessor inside it
 * (spec 0012, "Serialising writes on one invoice").
 *
 * `withTenantAction({ transaction: true })` holds its transaction for the
 * whole handler, which is right for every write in the product but one: the
 * issue of an invoice has to commit, then send an email, then write the
 * outcome, and holding the single pooled connection across a network call
 * would stall every other request (spec 0009's rule). This is the door for
 * that one shape: the locked part runs here, the handler continues on the
 * pooled accessor after the commit.
 *
 * It is a second way to open a transaction beside the action wrapper's flag,
 * and spec 0012 asks a reviewer to question every new caller. The raw
 * transaction never leaves this file: the callback gets the same
 * `tenantDb(ctx, tx)` accessor the wrapper would hand it, plus the one
 * organization level operation the issue needs, bound to the transaction.
 * A throw inside rolls everything back and propagates.
 */
import { tenantDb, type StaffAccessor } from "./accessor";
import type { StaffContext } from "./context";
import { pooledDb } from "./executor";
import { nextInvoiceNumber } from "./organization";

export type TenantTransactionScope = {
  /** Scoped to `ctx`, and to this transaction, exactly as the action wrapper's `db`. */
  readonly db: StaffAccessor;
  /** `nextInvoiceNumber(ctx, tx)`, bound so the transaction stays inside the layer. */
  readonly nextInvoiceNumber: () => Promise<number>;
};

export async function tenantTransaction<T>(
  ctx: StaffContext,
  fn: (scope: TenantTransactionScope) => Promise<T>,
): Promise<T> {
  const db = await pooledDb();

  return db.transaction(async (tx) =>
    fn({
      db: tenantDb(ctx, tx),
      nextInvoiceNumber: () => nextInvoiceNumber(ctx, tx),
    }),
  );
}
