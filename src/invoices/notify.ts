/**
 * Telling the client's contacts an invoice was issued (spec 0012, AC-6,
 * AC-7, AC-15).
 *
 * Runs after the issue transaction has committed, and again on resend, on no
 * open transaction: the network calls happen on the pooled accessor, per the
 * spec 0009 rule about the single pooled connection. One attempt id is
 * generated up front and is the version segment of every idempotency key in
 * the loop. Each contact gets one send,
 * sequentially; then exactly one event is written for the attempt:
 * `notified` when every address was delivered, else `notification_failed`
 * whose note lists what happened.
 *
 * The whole block, from reading the contacts to the event write, sits inside
 * one catch. Any throw still writes a `notification_failed` event carrying
 * the error's message, so a `sent` invoice never has a silent, eventless
 * failure. The invoice is `sent` in every case; this function never changes
 * its status.
 */
import { eq } from "drizzle-orm";

import { invoiceEvents, memberships, type InvoiceEventKind } from "@/db/schema";
import {
  agencyProfile,
  type StaffAccessor,
  type StaffContext,
} from "@/db/tenant";
import { sendEmail } from "@/email/send";
import { env } from "@/lib/env";
import { newId } from "@/lib/id";

import { composeInvoiceNotification } from "./invoice-email";
import { contactsToNotify, type NotifiableContact } from "./queries";

/** What the notification needs from the issued invoice. */
export type NotifiableInvoice = {
  readonly id: string;
  readonly clientId: string;
  readonly number: number;
  readonly totalCents: number;
  readonly currency: string;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly notes: string | null;
};

export type NotificationOutcome = {
  readonly kind: Extract<InvoiceEventKind, "notified" | "notification_failed">;
  /** The version segment of this attempt's idempotency keys. */
  readonly attemptId: string;
  readonly note: string;
  readonly delivered: readonly string[];
  readonly failed: readonly {
    readonly email: string;
    readonly reason: string;
  }[];
};

export const NO_CONTACTS_NOTE = "no contacts to notify";

/** The one line a person reads on the detail page and in the history. */
export function describeAttempt(
  delivered: readonly string[],
  failed: readonly { readonly email: string; readonly reason: string }[],
): string {
  if (delivered.length === 0 && failed.length === 0) {
    return NO_CONTACTS_NOTE;
  }

  const parts = [
    delivered.length > 0 ? `delivered: ${delivered.join(", ")}` : undefined,
    failed.length > 0
      ? `failed: ${failed.map(({ email, reason }) => `${email} (${reason})`).join(", ")}`
      : undefined,
  ];

  return parts.filter(Boolean).join("; ");
}

/** The issuing staff member's email for Reply To, or none if their row is gone. */
async function replyToFor(
  ctx: StaffContext,
  db: StaffAccessor,
): Promise<string | undefined> {
  const membership = await db.findFirst(memberships, {
    where: eq(memberships.userId, ctx.userId),
    with: { user: { columns: { email: true } } },
  });

  return membership?.user.email;
}

async function sendToEach(
  ctx: StaffContext,
  db: StaffAccessor,
  invoice: NotifiableInvoice,
  contacts: readonly NotifiableContact[],
  attemptId: string,
): Promise<Pick<NotificationOutcome, "delivered" | "failed">> {
  if (contacts.length === 0) {
    return { delivered: [], failed: [] };
  }

  const [agency, replyTo] = await Promise.all([
    agencyProfile(ctx),
    replyToFor(ctx, db),
  ]);

  if (agency === undefined) {
    throw new Error("the acting agency has no profile to send from");
  }

  const delivered: string[] = [];
  const failed: { email: string; reason: string }[] = [];

  for (const contact of contacts) {
    const sent = await sendEmail(
      composeInvoiceNotification({
        invoiceId: invoice.id,
        number: invoice.number,
        totalCents: invoice.totalCents,
        currency: invoice.currency,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        notes: invoice.notes,
        agencyName: agency.name,
        replyTo,
        contactId: contact.id,
        contactName: contact.name,
        contactEmail: contact.email,
        attemptId,
        baseUrl: env().NEXT_PUBLIC_APP_URL,
        fromAddress: env().EMAIL_FROM,
      }),
    );

    if (sent.ok) {
      delivered.push(contact.email);
    } else {
      failed.push({ email: contact.email, reason: sent.error.message });
    }
  }

  return { delivered, failed };
}

/**
 * Send to every contact with an email and write the one event for the
 * attempt. Never throws: a throw anywhere inside becomes a
 * `notification_failed` event carrying the error summary.
 */
export async function notifyInvoiceContacts(
  ctx: StaffContext,
  db: StaffAccessor,
  invoice: NotifiableInvoice,
): Promise<NotificationOutcome> {
  const attemptId = newId();

  // Spec 0012 sketches the attempt id as the event row's own id. The scoped
  // accessor assigns every id itself and makes supplying one a type error
  // (spec 0003, AC-3), and that rule is worth more than the convenience, so
  // the attempt id lives only in the idempotency keys: one fresh id per
  // attempt is all the keys need to be unique.
  const writeEvent = async (
    kind: NotificationOutcome["kind"],
    note: string,
  ): Promise<void> => {
    await db.insert(invoiceEvents, {
      invoiceId: invoice.id,
      kind,
      actorUserId: ctx.userId,
      note,
    });
  };

  try {
    const contacts = await contactsToNotify(ctx, invoice.clientId);
    const { delivered, failed } = await sendToEach(
      ctx,
      db,
      invoice,
      contacts,
      attemptId,
    );
    const note = describeAttempt(delivered, failed);
    const kind =
      failed.length === 0 && delivered.length > 0
        ? "notified"
        : "notification_failed";

    await writeEvent(kind, note);

    return { kind, attemptId, note, delivered, failed };
  } catch (error) {
    const reason =
      error instanceof Error && error.message.trim() !== ""
        ? error.message
        : "unexpected failure";
    const note = `failed: ${reason}`;

    try {
      await writeEvent("notification_failed", note);
    } catch {
      // The event write itself failed; there is nothing further to record
      // it in. The outcome below still tells the caller what happened.
    }

    return {
      kind: "notification_failed",
      attemptId,
      note,
      delivered: [],
      failed: [],
    };
  }
}
