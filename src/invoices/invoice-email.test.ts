/**
 * covers: spec 0012 AC-6
 *
 * The composed message: subject, envelope, portal link, the three segment
 * idempotency key, and what the rendered body carries.
 */
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";

import {
  composeInvoiceNotification,
  invoiceNotificationIdempotencyKey,
  portalInvoiceUrl,
} from "./invoice-email";
import { describeAttempt, NO_CONTACTS_NOTE } from "./notify";

const details = {
  invoiceId: "inv-1",
  number: 7,
  totalCents: 239972,
  currency: "EUR",
  issueDate: "2026-09-15",
  dueDate: "2026-10-15",
  notes: "Net 30.",
  agencyName: "Studio North",
  replyTo: "sarah@studio-north.example",
  contactId: "contact-1",
  contactName: "Priya Patel",
  contactEmail: "priya@northwind.example",
  attemptId: "attempt-1",
  baseUrl: "https://app.clienthq.test",
  fromAddress: "invoices@clienthq.test",
};

describe("composeInvoiceNotification", () => {
  it("addresses the contact from the agency via ClientHQ, replying to the issuer", () => {
    const message = composeInvoiceNotification(details);

    expect(message.to).toBe("priya@northwind.example");
    expect(message.from).toStrictEqual({
      address: "invoices@clienthq.test",
      name: "Studio North via ClientHQ",
    });
    expect(message.replyTo).toBe("sarah@studio-north.example");
    expect(message.subject).toBe("Invoice INV-0007 from Studio North");
  });

  it("keys the send by invoice and contact, versioned by the attempt", () => {
    expect(composeInvoiceNotification(details).idempotencyKey).toBe(
      "invoice-notification/inv-1:contact-1/attempt-1",
    );
    expect(invoiceNotificationIdempotencyKey("i", "c", "a")).toBe(
      "invoice-notification/i:c/a",
    );
  });

  it("links to the portal invoice on the app's base URL", () => {
    expect(portalInvoiceUrl("https://app.clienthq.test", "inv-1")).toBe(
      "https://app.clienthq.test/portal/invoices/inv-1",
    );
  });

  it("renders the agency, number, total with currency, both dates, the notes and the link", async () => {
    const text = await render(composeInvoiceNotification(details).react, {
      plainText: true,
    });

    expect(text).toContain("Studio North");
    expect(text).toContain("INV-0007");
    expect(text).toContain("€2,399.72 EUR");
    expect(text).toContain("15 September 2026 (UTC)");
    expect(text).toContain("15 October 2026 (UTC)");
    expect(text).toContain("Net 30.");
    expect(text).toContain("https://app.clienthq.test/portal/invoices/inv-1");
  });
});

describe("describeAttempt", () => {
  it("lists the delivered addresses", () => {
    expect(describeAttempt(["a@x.test", "b@y.test"], [])).toBe(
      "delivered: a@x.test, b@y.test",
    );
  });

  it("lists the refused addresses with the provider's reason after the delivered ones", () => {
    expect(
      describeAttempt(
        ["a@x.test"],
        [{ email: "b@y.test", reason: "mailbox full" }],
      ),
    ).toBe("delivered: a@x.test; failed: b@y.test (mailbox full)");
  });

  it("says when there was nobody to notify", () => {
    expect(describeAttempt([], [])).toBe(NO_CONTACTS_NOTE);
  });
});
