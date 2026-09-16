"use server";

/**
 * Saving a draft's header as one form (spec 0012, AC-2): the client, the due
 * date, the tax rate and the notes, in one transaction that opens with the
 * row locking compare and set on `status = draft`. A tax rate change
 * recalculates the tax and total in the same write, over the lines re read
 * inside the transaction. Last write wins on the header fields, as with
 * projects; only the status and the line set are protected by the lock.
 */
import { clients, invoices } from "@/db/schema";
import { tenantActionError, withTenantAction } from "@/db/tenant";
import type { InvoiceTotals } from "@/lib/money";

import { lockDraft, recalculateTotals } from "./draft";
import { INVOICE_REVALIDATE } from "./revalidate";
import { updateInvoiceDraftInput } from "./schema";

export type UpdatedInvoiceDraft = {
  readonly id: string;
  readonly totals: InvoiceTotals;
};

export const updateInvoiceDraft = withTenantAction({
  name: "updateInvoiceDraft",
  input: updateInvoiceDraftInput,
  revalidate: INVOICE_REVALIDATE,
  transaction: true,
  handler: async ({ input, db }): Promise<UpdatedInvoiceDraft> => {
    const draft = await lockDraft(db, input.id);

    const client = await db.findById(clients, input.clientId);

    if (client === undefined) {
      throw tenantActionError({
        code: "validation",
        message: "",
        fieldErrors: { clientId: ["Choose an active client."] },
      });
    }

    if (client.archivedAt !== null) {
      throw tenantActionError({
        code: "validation",
        message: "",
        fieldErrors: {
          clientId: ["This client is archived. Choose an active one."],
        },
      });
    }

    const updated = await db.update(invoices, draft.id, {
      clientId: client.id,
      dueDate: input.dueDate,
      notes: input.notes,
    });

    if (updated === undefined) {
      // Unreachable: the row is locked by this transaction.
      throw tenantActionError({ code: "not_found", message: "" });
    }

    const totals = await recalculateTotals(db, updated, input.taxRatePercent);

    return { id: updated.id, totals };
  },
});
