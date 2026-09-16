/**
 * covers: spec 0013 AC-3
 *
 * Every rule `presentInvoice` and its exported helpers apply, in isolation
 * from the renderer and the database: the two the PDF and the screen must
 * never disagree on.
 */
import { describe, expect, it } from "vitest";

import {
  billingAddressLines,
  displayQuantity,
  formatTaxLabel,
  formatTaxRate,
  presentInvoice,
  type InvoicePresentationInvoice,
} from "./presentation";

describe("billingAddressLines", () => {
  it("drops blank lines and joins city, region and postal by comma", () => {
    expect(
      billingAddressLines({
        billingAddressLine1: "1 Market St",
        billingAddressLine2: "Suite 400",
        billingCity: "San Francisco",
        billingRegion: "CA",
        billingPostalCode: "94105",
        billingCountry: "US",
      }),
    ).toEqual(["1 Market St", "Suite 400", "San Francisco, CA, 94105", "US"]);
  });

  it("drops a blank field from the city line and omits it entirely when every part is blank", () => {
    expect(
      billingAddressLines({
        billingAddressLine1: "1 Market St",
        billingAddressLine2: null,
        billingCity: "San Francisco",
        billingRegion: null,
        billingPostalCode: null,
        billingCountry: null,
      }),
    ).toEqual(["1 Market St", "San Francisco"]);
  });

  it("is an empty list when the client has no address at all", () => {
    expect(
      billingAddressLines({
        billingAddressLine1: null,
        billingAddressLine2: null,
        billingCity: null,
        billingRegion: null,
        billingPostalCode: null,
        billingCountry: null,
      }),
    ).toEqual([]);
  });
});

describe("displayQuantity", () => {
  it.each([
    ["2.500", "2.5"],
    ["1.000", "1"],
    ["0.125", "0.125"],
    ["3", "3"],
  ])("%s reads as %s", (stored, expected) => {
    expect(displayQuantity(stored)).toBe(expected);
  });
});

describe("formatTaxRate and formatTaxLabel", () => {
  it.each([
    [0, "0%"],
    [2000, "20%"],
    [725, "7.25%"],
    [720, "7.2%"],
    [10000, "100%"],
  ])("formats %d basis points as %s", (bp, expected) => {
    expect(formatTaxRate(bp)).toBe(expected);
    expect(formatTaxLabel(bp)).toBe(`Tax (${expected})`);
  });
});

const AGENCY_NAME = "Acme Agency";
const CLIENT = {
  name: "Northwind",
  billingAddressLine1: "1 Market St",
  billingAddressLine2: null,
  billingCity: "San Francisco",
  billingRegion: "CA",
  billingPostalCode: "94105",
  billingCountry: "US",
};
const LINES = [
  {
    id: "l1",
    description: "Discovery workshop",
    quantity: "1.000",
    unitAmountCents: 180000,
    amountCents: 180000,
  },
];

function invoice(
  overrides: Partial<InvoicePresentationInvoice> = {},
): InvoicePresentationInvoice {
  return {
    number: 42,
    status: "sent",
    issueDate: "2026-09-01",
    dueDate: "2026-10-01",
    currency: "USD",
    taxRateBp: 725,
    subtotalCents: 180000,
    taxCents: 13050,
    totalCents: 193050,
    notes: "Net 30.",
    paidAt: null,
    ...overrides,
  };
}

describe("presentInvoice", () => {
  it("maps each of the three client visible statuses to its label", () => {
    expect(
      presentInvoice({
        invoice: invoice({ status: "sent" }),
        client: CLIENT,
        lines: LINES,
        agencyName: AGENCY_NAME,
        todayUtc: "2026-09-15",
        generatedAt: new Date("2026-09-15T10:30:00Z"),
      }).status.label,
    ).toBe("Sent");

    expect(
      presentInvoice({
        invoice: invoice({ status: "overdue" }),
        client: CLIENT,
        lines: LINES,
        agencyName: AGENCY_NAME,
        todayUtc: "2026-09-15",
        generatedAt: new Date("2026-09-15T10:30:00Z"),
      }).status.label,
    ).toBe("Overdue");

    expect(
      presentInvoice({
        invoice: invoice({ status: "paid", paidAt: new Date("2026-09-10") }),
        client: CLIENT,
        lines: LINES,
        agencyName: AGENCY_NAME,
        todayUtc: "2026-09-15",
        generatedAt: new Date("2026-09-15T10:30:00Z"),
      }).status.label,
    ).toBe("Paid");
  });

  it("marks a sent invoice past due only when today is after the due date", () => {
    const past = presentInvoice({
      invoice: invoice({ status: "sent", dueDate: "2026-09-01" }),
      client: CLIENT,
      lines: LINES,
      agencyName: AGENCY_NAME,
      todayUtc: "2026-09-15",
      generatedAt: new Date("2026-09-15T10:30:00Z"),
    });

    expect(past.status.pastDue).toBe(true);

    const notYet = presentInvoice({
      invoice: invoice({ status: "sent", dueDate: "2026-10-01" }),
      client: CLIENT,
      lines: LINES,
      agencyName: AGENCY_NAME,
      todayUtc: "2026-09-15",
      generatedAt: new Date("2026-09-15T10:30:00Z"),
    });

    expect(notYet.status.pastDue).toBe(false);
  });

  it("prints Paid on as a UTC calendar day, only when paid", () => {
    const paid = presentInvoice({
      invoice: invoice({
        status: "paid",
        paidAt: new Date("2026-09-10T23:30:00Z"),
      }),
      client: CLIENT,
      lines: LINES,
      agencyName: AGENCY_NAME,
      todayUtc: "2026-09-15",
      generatedAt: new Date("2026-09-15T10:30:00Z"),
    });

    expect(paid.status.paidOn).toBe("Paid on 2026-09-10");

    const sent = presentInvoice({
      invoice: invoice({ status: "sent" }),
      client: CLIENT,
      lines: LINES,
      agencyName: AGENCY_NAME,
      todayUtc: "2026-09-15",
      generatedAt: new Date("2026-09-15T10:30:00Z"),
    });

    expect(sent.status.paidOn).toBeUndefined();
  });

  it("formats the generated line as YYYY-MM-DD HH:MM UTC", () => {
    const presentation = presentInvoice({
      invoice: invoice(),
      client: CLIENT,
      lines: LINES,
      agencyName: AGENCY_NAME,
      todayUtc: "2026-09-15",
      generatedAt: new Date("2026-09-15T08:05:00Z"),
    });

    expect(presentation.generated).toBe("2026-09-15 08:05 UTC");
  });

  it("builds the document title from the display number and agency name", () => {
    const presentation = presentInvoice({
      invoice: invoice({ number: 7 }),
      client: CLIENT,
      lines: LINES,
      agencyName: AGENCY_NAME,
      todayUtc: "2026-09-15",
      generatedAt: new Date("2026-09-15T08:05:00Z"),
    });

    expect(presentation.number).toBe("INV-0007");
    expect(presentation.documentTitle).toBe(
      "Invoice INV-0007 from Acme Agency",
    );
  });

  it("carries the bill to block, the lines and the totals straight from the rows", () => {
    const presentation = presentInvoice({
      invoice: invoice(),
      client: CLIENT,
      lines: LINES,
      agencyName: AGENCY_NAME,
      todayUtc: "2026-09-15",
      generatedAt: new Date("2026-09-15T08:05:00Z"),
    });

    expect(presentation.billTo).toEqual({
      name: "Northwind",
      lines: ["1 Market St", "San Francisco, CA, 94105", "US"],
    });
    expect(presentation.lines).toEqual([
      {
        id: "l1",
        description: "Discovery workshop",
        quantity: "1",
        unit: "$1,800.00",
        amount: "$1,800.00",
      },
    ]);
    expect(presentation.totals).toEqual({
      subtotal: "$1,800.00",
      taxLabel: "Tax (7.25%)",
      tax: "$130.50",
      total: "$1,930.50",
    });
  });

  it("never throws on a valid row, including one with no notes", () => {
    expect(() =>
      presentInvoice({
        invoice: invoice({ notes: null }),
        client: CLIENT,
        lines: [],
        agencyName: AGENCY_NAME,
        todayUtc: "2026-09-15",
        generatedAt: new Date(),
      }),
    ).not.toThrow();
  });
});
