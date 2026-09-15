"use server";

/**
 * Issuing a draft (spec 0012, AC-5, AC-6, AC-15).
 *
 * The one Server Action in the product that cannot run under
 * `withTenantAction({ transaction: true })`: its email has to go out after
 * the commit, and that wrapper holds the transaction for the whole handler.
 * So it runs with no transaction of its own and opens one through
 * `tenantTransaction` for the locked part only. Inside it, in order: lock and
 * verify the draft (else `conflict`); read the lines, the due date and the
 * client and check every precondition (else a named refusal, rolled back);
 * take the next number from the agency counter; update the invoice with the
 * number, today's date and `status = sent`; write the `issued` event; commit.
 * A refusal at any step rolls the counter back with it, so the sequence
 * stays gapless. Only after the commit does the handler send the email and
 * write the notification event through its ordinary pooled accessor.
 *
 * Two staff issuing two different drafts at once both succeed with
 * consecutive numbers, because the counter update takes the organization
 * row's lock. Two staff issuing the same draft at once see one succeed and
 * the other refused with `conflict`, because the invoice row's lock makes
 * the second compare and set see `sent`.
 */
import { clients, invoiceEvents, invoices } from "@/db/schema";
import {
  tenantActionError,
  tenantTransaction,
  withTenantAction,
} from "@/db/tenant";
import { todayUtc } from "@/lib/dates";

import { linesOf, lockDraft } from "./draft";
import { notifyInvoiceContacts, type NotificationOutcome } from "./notify";
import { INVOICE_REVALIDATE } from "./revalidate";
import { issueInvoiceInput } from "./schema";

export type IssuedInvoice = {
  readonly id: string;
  readonly number: number;
  readonly status: "sent";
  readonly notification: NotificationOutcome;
};

export const issueInvoice = withTenantAction({
  name: "issueInvoice",
  input: issueInvoiceInput,
  revalidate: INVOICE_REVALIDATE,
  transaction: false,
  handler: async ({ input, ctx, db }): Promise<IssuedInvoice> => {
    const issued = await tenantTransaction(ctx, async (scope) => {
      const draft = await lockDraft(scope.db, input.id);
      const today = todayUtc();

      const lines = await linesOf(scope.db, draft.id);

      if (lines.length === 0) {
        throw tenantActionError({
          code: "validation",
          message: "Add at least one line before issuing this invoice.",
        });
      }

      if (draft.dueDate === null) {
        throw tenantActionError({
          code: "validation",
          message: "Set a due date before issuing this invoice.",
        });
      }

      if (draft.dueDate < today) {
        throw tenantActionError({
          code: "validation",
          message:
            "The due date is in the past. Move it to today or later before issuing.",
        });
      }

      const client = await scope.db.findById(clients, draft.clientId);

      if (client === undefined || client.archivedAt !== null) {
        throw tenantActionError({
          code: "validation",
          message:
            "This client is archived. Restore them, or move the invoice to an active client, before issuing.",
        });
      }

      // Last, after every precondition, so a refusal above never consumes a
      // number: the increment is inside this transaction and rolls back
      // with it.
      const number = await scope.nextInvoiceNumber();

      const row = await scope.db.update(invoices, draft.id, {
        number,
        issueDate: today,
        status: "sent",
      });

      if (row === undefined) {
        // Unreachable: the row is locked by this transaction.
        throw tenantActionError({ code: "not_found", message: "" });
      }

      await scope.db.insert(invoiceEvents, {
        invoiceId: row.id,
        kind: "issued",
        fromStatus: "draft",
        toStatus: "sent",
        actorUserId: ctx.userId,
      });

      return {
        id: row.id,
        clientId: row.clientId,
        number,
        totalCents: row.totalCents,
        currency: row.currency,
        issueDate: today,
        dueDate: draft.dueDate,
        notes: row.notes,
      };
    });

    // Committed. The send and its event happen on the pooled accessor, with
    // no transaction open.
    const notification = await notifyInvoiceContacts(ctx, db, issued);

    return {
      id: issued.id,
      number: issued.number,
      status: "sent",
      notification,
    };
  },
});
