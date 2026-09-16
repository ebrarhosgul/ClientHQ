/**
 * covers: spec 0012 AC-2, AC-3, AC-8, AC-9
 *
 * Every limit from AC-2 and AC-3 at the boundary: the date round trip, the
 * two decimal tax rate, the notes cap, the line description, quantity and
 * amount rules, and the `from` statuses the compare and set moves accept.
 */
import { describe, expect, it } from "vitest";

import { newId } from "@/lib/id";

import {
  addLineItemInput,
  markInvoicePaidInput,
  moveLineItemInput,
  updateInvoiceDraftInput,
  voidInvoiceInput,
} from "./schema";

const id = newId();

const header = {
  id,
  clientId: newId(),
  dueDate: "2026-10-15",
  taxRatePercent: "7.25",
  notes: "  Net 30. Thank you.  ",
};

describe("updateInvoiceDraftInput", () => {
  it("parses the header, storing the percent as basis points and trimming the notes", () => {
    expect(updateInvoiceDraftInput.parse(header)).toStrictEqual({
      ...header,
      taxRatePercent: 725,
      notes: "Net 30. Thank you.",
    });
  });

  it("stores blank notes as null", () => {
    expect(
      updateInvoiceDraftInput.parse({ ...header, notes: "   " }).notes,
    ).toBe(null);
    expect(updateInvoiceDraftInput.parse({ ...header, notes: "" }).notes).toBe(
      null,
    );
  });

  it("caps the notes at 5,000 characters", () => {
    expect(
      updateInvoiceDraftInput.safeParse({ ...header, notes: "x".repeat(5000) })
        .success,
    ).toBe(true);
    expect(
      updateInvoiceDraftInput.safeParse({ ...header, notes: "x".repeat(5001) })
        .success,
    ).toBe(false);
  });

  it.each(["0", "100", "0.5", "99.99"])("accepts a tax rate of %s", (rate) => {
    expect(
      updateInvoiceDraftInput.safeParse({ ...header, taxRatePercent: rate })
        .success,
    ).toBe(true);
  });

  it.each(["7.255", "100.01", "-1", "abc", ""])(
    "refuses a tax rate of %s",
    (rate) => {
      const result = updateInvoiceDraftInput.safeParse({
        ...header,
        taxRatePercent: rate,
      });

      expect(result.success).toBe(false);
    },
  );

  it("requires a real calendar day for the due date", () => {
    expect(
      updateInvoiceDraftInput.safeParse({ ...header, dueDate: "2026-02-30" })
        .success,
    ).toBe(false);
    expect(
      updateInvoiceDraftInput.safeParse({ ...header, dueDate: "15/10/2026" })
        .success,
    ).toBe(false);
    expect(
      updateInvoiceDraftInput.safeParse({ ...header, dueDate: "" }).success,
    ).toBe(false);
  });
});

describe("addLineItemInput", () => {
  const line = {
    invoiceId: id,
    description: "  Discovery workshop ",
    quantity: "1.5",
    unitAmount: "1250.50",
  };

  it("parses a line, trimming the description and storing the amount as cents", () => {
    expect(addLineItemInput.parse(line)).toStrictEqual({
      invoiceId: id,
      description: "Discovery workshop",
      quantity: "1.5",
      unitAmount: 125050,
    });
  });

  it("caps the description at 500 characters and refuses a blank one", () => {
    expect(
      addLineItemInput.safeParse({ ...line, description: "x".repeat(500) })
        .success,
    ).toBe(true);
    expect(
      addLineItemInput.safeParse({ ...line, description: "x".repeat(501) })
        .success,
    ).toBe(false);
    expect(
      addLineItemInput.safeParse({ ...line, description: "   " }).success,
    ).toBe(false);
  });

  it.each(["1", "0.001", "999999999.999", "2.5"])(
    "accepts a quantity of %s",
    (quantity) => {
      expect(addLineItemInput.safeParse({ ...line, quantity }).success).toBe(
        true,
      );
    },
  );

  it.each(["0", "0.000", "-1", "1.0001", "1000000000", "1e3", "", "abc"])(
    "refuses a quantity of %s",
    (quantity) => {
      expect(addLineItemInput.safeParse({ ...line, quantity }).success).toBe(
        false,
      );
    },
  );

  it("accepts a zero unit amount and the cap, refuses above it", () => {
    expect(
      addLineItemInput.parse({ ...line, unitAmount: "0" }).unitAmount,
    ).toBe(0);
    expect(
      addLineItemInput.parse({ ...line, unitAmount: "999999.99" }).unitAmount,
    ).toBe(99999999);
    expect(
      addLineItemInput.safeParse({ ...line, unitAmount: "1000000" }).success,
    ).toBe(false);
  });

  it("reports a bad amount against the unitAmount field", () => {
    const result = addLineItemInput.safeParse({ ...line, unitAmount: "1.234" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toStrictEqual(["unitAmount"]);
    }
  });
});

describe("moveLineItemInput", () => {
  it("accepts only up and down", () => {
    expect(
      moveLineItemInput.safeParse({ id, invoiceId: id, direction: "up" })
        .success,
    ).toBe(true);
    expect(
      moveLineItemInput.safeParse({ id, invoiceId: id, direction: "top" })
        .success,
    ).toBe(false);
  });
});

describe("markInvoicePaidInput", () => {
  it("accepts a move from sent or overdue with a real paid date", () => {
    expect(
      markInvoicePaidInput.safeParse({ id, from: "sent", paidOn: "2026-09-15" })
        .success,
    ).toBe(true);
    expect(
      markInvoicePaidInput.safeParse({
        id,
        from: "overdue",
        paidOn: "2026-09-15",
      }).success,
    ).toBe(true);
  });

  it.each(["draft", "paid", "void"])("refuses a move from %s", (from) => {
    expect(
      markInvoicePaidInput.safeParse({ id, from, paidOn: "2026-09-15" })
        .success,
    ).toBe(false);
  });

  it("refuses a paid date that is not a real day", () => {
    expect(
      markInvoicePaidInput.safeParse({ id, from: "sent", paidOn: "2026-13-01" })
        .success,
    ).toBe(false);
  });
});

describe("voidInvoiceInput", () => {
  it("accepts draft, sent and overdue, with the reason trimmed and blank as null", () => {
    expect(
      voidInvoiceInput.parse({ id, from: "draft", reason: " Duplicate " }),
    ).toStrictEqual({ id, from: "draft", reason: "Duplicate" });
    expect(
      voidInvoiceInput.parse({ id, from: "sent", reason: "" }).reason,
    ).toBe(null);
    expect(voidInvoiceInput.parse({ id, from: "overdue" }).reason).toBe(null);
  });

  it.each(["paid", "void"])("refuses a move from %s", (from) => {
    expect(voidInvoiceInput.safeParse({ id, from }).success).toBe(false);
  });

  it("caps the reason at 500 characters", () => {
    expect(
      voidInvoiceInput.safeParse({ id, from: "sent", reason: "x".repeat(501) })
        .success,
    ).toBe(false);
  });
});
