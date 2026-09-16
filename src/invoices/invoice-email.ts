/**
 * Composing the issue notification: subject, envelope, portal link and the
 * idempotency key (spec 0012, Notification). Pure, so a test can render
 * exactly what a send would, the same shape as `src/contacts/invitation-email.ts`.
 */
import { createElement } from "react";

import type { EmailMessage } from "@/email/send";
import { InvoiceIssuedEmail } from "@/email/templates/invoice-issued";
import { formatMoney } from "@/lib/money";
import { formatBillingDate } from "@/payments/billing-state";

import { formatInvoiceNumber } from "./status";

export type InvoiceNotificationDetails = {
  readonly invoiceId: string;
  readonly number: number;
  readonly totalCents: number;
  readonly currency: string;
  /** `YYYY-MM-DD`. */
  readonly issueDate: string;
  readonly dueDate: string;
  readonly notes: string | null;
  readonly agencyName: string;
  /** The issuing staff member's address, or none if their row is gone. */
  readonly replyTo: string | undefined;
  readonly contactId: string;
  readonly contactName: string;
  readonly contactEmail: string;
  /** The attempt id: one per send loop, shared by every recipient in it. */
  readonly attemptId: string;
  readonly baseUrl: string;
  readonly fromAddress: string;
};

/** `/portal/invoices/<id>` on the app's base URL. */
export function portalInvoiceUrl(baseUrl: string, invoiceId: string): string {
  return new URL(`/portal/invoices/${invoiceId}`, baseUrl).toString();
}

/**
 * `invoice-notification/<invoice id>:<contact id>/<attempt id>`: the entity
 * is the invoice and contact pair, the version is the attempt, so a retried
 * call inside one attempt cannot deliver twice and a resend is a new key.
 */
export function invoiceNotificationIdempotencyKey(
  invoiceId: string,
  contactId: string,
  attemptId: string,
): string {
  return `invoice-notification/${invoiceId}:${contactId}/${attemptId}`;
}

/** A `YYYY-MM-DD` calendar day as the email writes it, e.g. `15 October 2026 (UTC)`. */
function formatCalendarDay(day: string): string {
  return formatBillingDate(new Date(`${day}T00:00:00Z`));
}

export function composeInvoiceNotification(
  details: InvoiceNotificationDetails,
): EmailMessage {
  const displayNumber = formatInvoiceNumber(details.number);

  return {
    to: details.contactEmail,
    from: {
      address: details.fromAddress,
      name: `${details.agencyName} via ClientHQ`,
    },
    replyTo: details.replyTo,
    subject: `Invoice ${displayNumber} from ${details.agencyName}`,
    react: createElement(InvoiceIssuedEmail, {
      agencyName: details.agencyName,
      contactName: details.contactName,
      displayNumber,
      total: formatMoney(details.totalCents, details.currency),
      currency: details.currency,
      issuedOn: formatCalendarDay(details.issueDate),
      dueOn: formatCalendarDay(details.dueDate),
      notes: details.notes,
      portalUrl: portalInvoiceUrl(details.baseUrl, details.invoiceId),
    }),
    idempotencyKey: invoiceNotificationIdempotencyKey(
      details.invoiceId,
      details.contactId,
      details.attemptId,
    ),
  };
}
