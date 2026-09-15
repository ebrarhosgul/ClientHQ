"use server";

/**
 * Sending the issue email again (spec 0012, AC-7).
 *
 * Offered on a `sent` or `overdue` invoice only. Refused when the invoice's
 * most recent notification event, `notified` or `notification_failed`,
 * newest by `created_at` then `id`, is less than `COOLDOWN_MINUTES` old: the
 * same five minute cooldown spec 0009 gives invitations. The check is a
 * read followed by a send with no claim row, so two staff pressing Resend in
 * the same second can both send; spec 0012 accepts one duplicate email at
 * those odds.
 *
 * No transaction, deliberately: the send is a network call, and the event it
 * writes goes through the pooled accessor afterwards, exactly as on issue.
 */
import { and, desc, eq, inArray } from "drizzle-orm";

import { invoiceEvents, invoices } from "@/db/schema";
import { tenantActionError, withTenantAction } from "@/db/tenant";
import { COOLDOWN_MINUTES, cooldownRefuses } from "@/contacts/limits";

import { notifyInvoiceContacts, type NotificationOutcome } from "./notify";
import { INVOICE_REVALIDATE } from "./revalidate";
import { resendInvoiceNotificationInput } from "./schema";
import { nextActions } from "./status";

export type ResentNotification = {
  readonly id: string;
  readonly notification: NotificationOutcome;
};

export const resendInvoiceNotification = withTenantAction({
  name: "resendInvoiceNotification",
  input: resendInvoiceNotificationInput,
  revalidate: INVOICE_REVALIDATE,
  transaction: false,
  handler: async ({ input, ctx, db }): Promise<ResentNotification> => {
    const invoice = await db.findById(invoices, input.id);

    if (invoice === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    if (
      !nextActions(invoice.status).includes("resend") ||
      invoice.number === null ||
      invoice.issueDate === null ||
      invoice.dueDate === null
    ) {
      throw tenantActionError({
        code: "conflict",
        message:
          "Only an issued invoice that is still open can have its notification sent again.",
      });
    }

    const latestNotification = await db.findFirst(invoiceEvents, {
      where: and(
        eq(invoiceEvents.invoiceId, invoice.id),
        inArray(invoiceEvents.kind, ["notified", "notification_failed"]),
      ),
      orderBy: [desc(invoiceEvents.createdAt), desc(invoiceEvents.id)],
    });

    if (
      latestNotification !== undefined &&
      cooldownRefuses(latestNotification.createdAt, new Date())
    ) {
      throw tenantActionError({
        code: "conflict",
        message: `A notification for this invoice went out less than ${COOLDOWN_MINUTES} minutes ago. Wait a few minutes before sending another.`,
      });
    }

    const notification = await notifyInvoiceContacts(ctx, db, {
      id: invoice.id,
      clientId: invoice.clientId,
      number: invoice.number,
      totalCents: invoice.totalCents,
      currency: invoice.currency,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      notes: invoice.notes,
    });

    return { id: invoice.id, notification };
  },
});
