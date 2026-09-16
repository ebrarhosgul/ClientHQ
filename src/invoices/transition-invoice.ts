"use server";

/**
 * The two staff moves after issue: mark paid and void (spec 0012, AC-8, AC-9,
 * AC-15).
 *
 * Each is a compare and set on the status the button was rendered from
 * (`from`, a hidden input the schema already narrows to the statuses the move
 * is allowed on), in one transaction with the event that records it. A miss
 * means someone else moved the invoice since the page was rendered, never a
 * wrong write: the action refuses with `conflict` naming the current status
 * and the page shows it.
 *
 * `paid_at` is midnight UTC of the day staff chose, which must be a real
 * calendar day not after today and not before the issue date. The void
 * reason is optional and travels on the event, not the invoice.
 */
import { eq } from "drizzle-orm";

import { invoiceEvents, invoices, type InvoiceStatus } from "@/db/schema";
import {
  tenantActionError,
  withTenantAction,
  type StaffAccessor,
} from "@/db/tenant";
import { todayUtc } from "@/lib/dates";
import { INVOICE_STATUS_PRESENTATION } from "@/ui/patterns/status-chip";

import { INVOICE_REVALIDATE } from "./revalidate";
import { markInvoicePaidInput, voidInvoiceInput } from "./schema";
import { canTransition } from "./status";

export type TransitionedInvoice = {
  readonly id: string;
  readonly status: InvoiceStatus;
};

/** Why the compare and set missed, for a message worth reading. */
async function refuseStaleMove(db: StaffAccessor, id: string): Promise<never> {
  const current = await db.findById(invoices, id);

  if (current === undefined) {
    throw tenantActionError({ code: "not_found", message: "" });
  }

  throw tenantActionError({
    code: "conflict",
    message: `This invoice is now ${INVOICE_STATUS_PRESENTATION[current.status].label.toLowerCase()}, so that move is no longer possible.`,
  });
}

export const markInvoicePaid = withTenantAction({
  name: "markInvoicePaid",
  input: markInvoicePaidInput,
  revalidate: INVOICE_REVALIDATE,
  transaction: true,
  handler: async ({ input, ctx, db }): Promise<TransitionedInvoice> => {
    if (!canTransition(input.from, "paid")) {
      // Unreachable through the schema, which only admits sent and overdue.
      throw tenantActionError({ code: "conflict", message: "" });
    }

    const today = todayUtc();

    if (input.paidOn > today) {
      throw tenantActionError({
        code: "validation",
        message: "",
        fieldErrors: { paidOn: ["The paid date cannot be in the future."] },
      });
    }

    const current = await db.findById(invoices, input.id);

    if (current === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    if (current.issueDate !== null && input.paidOn < current.issueDate) {
      throw tenantActionError({
        code: "validation",
        message: "",
        fieldErrors: {
          paidOn: [
            `The paid date cannot be before the issue date, ${current.issueDate}.`,
          ],
        },
      });
    }

    const row = await db.update(
      invoices,
      input.id,
      { status: "paid", paidAt: new Date(`${input.paidOn}T00:00:00Z`) },
      { where: eq(invoices.status, input.from) },
    );

    if (row === undefined) {
      return refuseStaleMove(db, input.id);
    }

    await db.insert(invoiceEvents, {
      invoiceId: row.id,
      kind: "paid",
      fromStatus: input.from,
      toStatus: "paid",
      actorUserId: ctx.userId,
    });

    return { id: row.id, status: row.status };
  },
});

export const voidInvoice = withTenantAction({
  name: "voidInvoice",
  input: voidInvoiceInput,
  revalidate: INVOICE_REVALIDATE,
  transaction: true,
  handler: async ({ input, ctx, db }): Promise<TransitionedInvoice> => {
    if (!canTransition(input.from, "void")) {
      // Unreachable through the schema, which only admits draft, sent and overdue.
      throw tenantActionError({ code: "conflict", message: "" });
    }

    const row = await db.update(
      invoices,
      input.id,
      { status: "void" },
      { where: eq(invoices.status, input.from) },
    );

    if (row === undefined) {
      return refuseStaleMove(db, input.id);
    }

    await db.insert(invoiceEvents, {
      invoiceId: row.id,
      kind: "voided",
      fromStatus: input.from,
      toStatus: "void",
      actorUserId: ctx.userId,
      note: input.reason,
    });

    return { id: row.id, status: row.status };
  },
});
