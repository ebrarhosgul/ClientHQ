/**
 * covers: spec 0020 AC-3, AC-4, AC-5
 *
 * `summariseOverdue` is the pure half of the overdue invoices section: given
 * whole invoice rows (plus the client relation, as `overdueInvoicesSummary`
 * reads them) and today's date, it decides which invoices count, their
 * per-currency totals, and the top 5. The SQL `where` clause in
 * `overdueInvoicesSummary` shares the same predicate; the agreement between
 * the two, against real rows, is `queries.db.test.ts`.
 */
import { describe, expect, it } from "vitest";

import type { InvoiceStatus } from "@/db/schema";

import { summariseOverdue } from "./queries";

const TODAY = "2026-09-24";

type Fixture = Parameters<typeof summariseOverdue>[0][number];

let nextId = 0;

function invoice(overrides: {
  readonly status: InvoiceStatus;
  readonly dueDate: string | null;
  readonly number?: number | null;
  readonly totalCents?: number;
  readonly currency?: string;
  readonly clientName?: string;
}): Fixture {
  nextId += 1;

  return {
    id: `invoice-${nextId}`,
    orgId: "org-1",
    clientId: "client-1",
    number: overrides.number ?? nextId,
    status: overrides.status,
    issueDate: "2026-08-01",
    dueDate: overrides.dueDate,
    currency: overrides.currency ?? "USD",
    subtotalCents: overrides.totalCents ?? 10_000,
    taxRateBp: 0,
    taxCents: 0,
    totalCents: overrides.totalCents ?? 10_000,
    paidAt: null,
    notes: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    client: { name: overrides.clientName ?? "Acme Ltd" },
  };
}

describe("summariseOverdue", () => {
  it("counts an overdue invoice and a sent invoice past its due date (AC-3)", () => {
    const summary = summariseOverdue(
      [
        invoice({ status: "overdue", dueDate: "2026-09-01" }),
        invoice({ status: "sent", dueDate: "2026-09-20" }),
      ],
      TODAY,
    );

    expect(summary.count).toBe(2);
  });

  it("never counts draft, paid or void, even with a past due date (AC-3)", () => {
    const summary = summariseOverdue(
      [
        invoice({ status: "draft", dueDate: "2026-01-01" }),
        invoice({ status: "paid", dueDate: "2026-01-01" }),
        invoice({ status: "void", dueDate: "2026-01-01" }),
      ],
      TODAY,
    );

    expect(summary.count).toBe(0);
    expect(summary.rows).toEqual([]);
  });

  it("does not count a sent invoice due today or in the future", () => {
    const summary = summariseOverdue(
      [
        invoice({ status: "sent", dueDate: TODAY }),
        invoice({ status: "sent", dueDate: "2026-09-25" }),
      ],
      TODAY,
    );

    expect(summary.count).toBe(0);
  });

  it("sums totals per currency, sorted by currency code, only when overdue (AC-4)", () => {
    const summary = summariseOverdue(
      [
        invoice({
          status: "overdue",
          dueDate: "2026-09-01",
          totalCents: 1_000,
          currency: "USD",
        }),
        invoice({
          status: "overdue",
          dueDate: "2026-09-02",
          totalCents: 500,
          currency: "USD",
        }),
        invoice({
          status: "overdue",
          dueDate: "2026-09-03",
          totalCents: 2_000,
          currency: "EUR",
        }),
      ],
      TODAY,
    );

    expect(summary.totals).toEqual([
      { currency: "EUR", cents: 2_000 },
      { currency: "USD", cents: 1_500 },
    ]);
  });

  it("shows no totals when nothing is overdue (AC-4)", () => {
    const summary = summariseOverdue(
      [invoice({ status: "sent", dueDate: "2026-10-01" })],
      TODAY,
    );

    expect(summary.totals).toEqual([]);
  });

  it("orders the top rows by due date oldest first, then number ascending (AC-5)", () => {
    const summary = summariseOverdue(
      [
        invoice({ status: "overdue", dueDate: "2026-09-10", number: 5 }),
        invoice({ status: "overdue", dueDate: "2026-09-01", number: 9 }),
        invoice({ status: "overdue", dueDate: "2026-09-01", number: 2 }),
      ],
      TODAY,
    );

    expect(summary.rows.map((row) => row.number)).toEqual([2, 9, 5]);
  });

  it("caps the rows at 5 while the count reflects every match (AC-5)", () => {
    const rows = Array.from({ length: 7 }, (_, index) =>
      invoice({
        status: "overdue",
        dueDate: `2026-09-0${index + 1}`,
        number: index + 1,
      }),
    );

    const summary = summariseOverdue(rows, TODAY);

    expect(summary.count).toBe(7);
    expect(summary.rows).toHaveLength(5);
  });

  it("computes daysOverdue as one for a due date of yesterday (AC-5)", () => {
    const summary = summariseOverdue(
      [invoice({ status: "overdue", dueDate: "2026-09-23" })],
      TODAY,
    );

    expect(summary.rows[0]?.daysOverdue).toBe(1);
  });

  it("carries the client name through onto each row", () => {
    const summary = summariseOverdue(
      [
        invoice({
          status: "overdue",
          dueDate: "2026-09-01",
          clientName: "Bilbo & Co",
        }),
      ],
      TODAY,
    );

    expect(summary.rows[0]?.clientName).toBe("Bilbo & Co");
  });
});
