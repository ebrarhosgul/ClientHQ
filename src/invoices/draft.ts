/**
 * The two steps every write to a draft shares (spec 0012, "Serialising writes
 * on one invoice" and AC-3, AC-4).
 *
 * `lockDraft` is the compare and set that opens every transaction touching a
 * draft: a real update with a non empty SET, conditional on `status = draft`,
 * which both verifies the status and takes the row lock for the rest of the
 * transaction. Two such transactions on one invoice run one after the other,
 * and whichever runs second sees the first one's status. `undefined` back
 * means the invoice is not a draft any more (or not this agency's), so the
 * caller refuses with `conflict` or `not_found` and the transaction rolls
 * back.
 *
 * `recalculateTotals` re reads the lines inside the same transaction and
 * writes the three totals, so `subtotal_cents` is the sum of the lines after
 * every committed write. Both take the transactional accessor the caller was
 * handed; neither opens anything of its own.
 */
import { asc, eq } from "drizzle-orm";

import { invoiceLineItems, invoices } from "@/db/schema";
import { tenantActionError, type StaffAccessor } from "@/db/tenant";
import { invoiceTotals, type InvoiceTotals } from "@/lib/money";

export type InvoiceRow = typeof invoices.$inferSelect;
export type LineItemRow = typeof invoiceLineItems.$inferSelect;

const NOT_A_DRAFT = {
  code: "conflict",
  message:
    "This invoice is no longer a draft, so it cannot be changed. Reload to see its current state.",
} as const;

/**
 * Lock the invoice row and verify it is still a draft, or throw the refusal
 * the caller should return: `not_found` when there is no such invoice in this
 * agency, `conflict` when there is but it has left `draft`.
 */
export async function lockDraft(
  db: StaffAccessor,
  invoiceId: string,
): Promise<InvoiceRow> {
  const locked = await db.update(
    invoices,
    invoiceId,
    { status: "draft" },
    { where: eq(invoices.status, "draft") },
  );

  if (locked !== undefined) {
    return locked;
  }

  // The compare and set missed: find out which refusal it deserves.
  const current = await db.findById(invoices, invoiceId);

  if (current === undefined) {
    throw tenantActionError({ code: "not_found", message: "" });
  }

  throw tenantActionError(NOT_A_DRAFT);
}

/** The invoice's lines, in display order, read inside the caller's transaction. */
export async function linesOf(
  db: StaffAccessor,
  invoiceId: string,
): Promise<readonly LineItemRow[]> {
  return db.findMany(invoiceLineItems, {
    where: eq(invoiceLineItems.invoiceId, invoiceId),
    orderBy: [asc(invoiceLineItems.position), asc(invoiceLineItems.id)],
  });
}

const TOO_LARGE = {
  code: "validation",
  message:
    "That would take the invoice total past what an invoice can hold. Reduce a quantity or an amount.",
} as const;

/**
 * The three totals from the lines as they now stand, computed in integer
 * cents by `src/lib/money.ts` and never in floating point. A total that
 * would not fit the integer column is refused here with a message, before
 * the database sees it (AC-3).
 */
export function totalsFor(
  lines: readonly { readonly amountCents: number }[],
  taxRateBp: number,
): InvoiceTotals {
  try {
    return invoiceTotals(
      lines.map((line) => line.amountCents),
      taxRateBp,
    );
  } catch {
    throw tenantActionError(TOO_LARGE);
  }
}

/**
 * Re read the lines and write the totals, in the caller's transaction, after
 * the row lock has been taken. Returns the written totals.
 */
export async function recalculateTotals(
  db: StaffAccessor,
  invoice: InvoiceRow,
  taxRateBp: number = invoice.taxRateBp,
): Promise<InvoiceTotals> {
  const totals = totalsFor(await linesOf(db, invoice.id), taxRateBp);

  const updated = await db.update(invoices, invoice.id, {
    taxRateBp,
    ...totals,
  });

  if (updated === undefined) {
    // Unreachable: the row is locked by this transaction. Kept so a refactor
    // that drops the lock fails loudly rather than reporting stale totals.
    throw tenantActionError({ code: "not_found", message: "" });
  }

  return totals;
}
