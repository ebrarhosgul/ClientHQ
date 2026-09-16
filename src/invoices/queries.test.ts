/**
 * covers: spec 0012 AC-7, AC-10
 *
 * The pure pieces of `src/invoices/queries.ts`: the list's in memory sort
 * (`compareForList`), the status type guard (`isInvoiceStatus`), and the
 * cooldown's read of the event history (`latestNotification`). The reads
 * that hit the database (`listInvoices`, `getInvoice`, `contactsToNotify`,
 * and so on) have their own coverage in `invoices.db.test.ts`.
 */
import { describe, expect, it } from "vitest";

import type { InvoiceEventRow } from "./queries";
import { compareForList, isInvoiceStatus, latestNotification } from "./queries";

type ListRow = Parameters<typeof compareForList>[0];

function row(overrides: Partial<ListRow> & Pick<ListRow, "id">): ListRow {
  return {
    status: "sent",
    issueDate: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("isInvoiceStatus", () => {
  it("accepts every real status", () => {
    for (const status of ["draft", "sent", "paid", "overdue", "void"]) {
      expect(isInvoiceStatus(status)).toBe(true);
    }
  });

  it("refuses a string that is not a status", () => {
    expect(isInvoiceStatus("cancelled")).toBe(false);
    expect(isInvoiceStatus("")).toBe(false);
  });
});

describe("compareForList (AC-10)", () => {
  it("puts drafts before every other status", () => {
    const draft = row({ id: "a", status: "draft" });
    const sent = row({ id: "b", status: "sent", issueDate: "2026-01-01" });

    expect(compareForList(draft, sent)).toBeLessThan(0);
    expect(compareForList(sent, draft)).toBeGreaterThan(0);
  });

  it("orders two drafts (no issue date yet) by id, the final tiebreak", () => {
    const a = row({ id: "a", status: "draft" });
    const b = row({ id: "b", status: "draft" });

    expect(compareForList(a, b)).toBeLessThan(0);
    expect(compareForList(b, a)).toBeGreaterThan(0);
  });

  it("orders non drafts by issue date, newest first", () => {
    const older = row({ id: "a", status: "sent", issueDate: "2026-01-01" });
    const newer = row({ id: "b", status: "sent", issueDate: "2026-02-01" });

    expect(compareForList(newer, older)).toBeLessThan(0);
    expect(compareForList(older, newer)).toBeGreaterThan(0);
  });

  it("breaks an issue date tie by created date, newest first", () => {
    const earlier = row({
      id: "a",
      status: "sent",
      issueDate: "2026-01-01",
      createdAt: new Date("2026-01-01T09:00:00.000Z"),
    });
    const later = row({
      id: "b",
      status: "sent",
      issueDate: "2026-01-01",
      createdAt: new Date("2026-01-01T10:00:00.000Z"),
    });

    expect(compareForList(later, earlier)).toBeLessThan(0);
  });

  it("falls back to id ascending when issue date and created date both tie", () => {
    const created = new Date("2026-01-01T09:00:00.000Z");
    const a = row({
      id: "a",
      status: "sent",
      issueDate: "2026-01-01",
      createdAt: created,
    });
    const b = row({
      id: "b",
      status: "sent",
      issueDate: "2026-01-01",
      createdAt: created,
    });

    expect(compareForList(a, b)).toBeLessThan(0);
    expect(compareForList(b, a)).toBeGreaterThan(0);
  });

  it("sorts a mixed list into drafts first, then newest issued, matching the spec's order", () => {
    const rows = [
      row({ id: "old-sent", status: "sent", issueDate: "2026-01-01" }),
      row({ id: "draft-2", status: "draft" }),
      row({ id: "new-sent", status: "sent", issueDate: "2026-03-01" }),
      row({ id: "draft-1", status: "draft" }),
    ];

    const sorted = [...rows].sort(compareForList).map((r) => r.id);

    expect(sorted).toStrictEqual([
      "draft-1",
      "draft-2",
      "new-sent",
      "old-sent",
    ]);
  });
});

function notificationEvent(
  overrides: Partial<InvoiceEventRow> & Pick<InvoiceEventRow, "id" | "kind">,
): InvoiceEventRow {
  return {
    orgId: "org-1",
    invoiceId: "invoice-1",
    fromStatus: null,
    toStatus: null,
    actorUserId: null,
    note: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    actorName: "System",
    ...overrides,
  };
}

describe("latestNotification (AC-7)", () => {
  it("finds the newest notification attempt among newest first events", () => {
    const events: InvoiceEventRow[] = [
      notificationEvent({
        id: "3",
        kind: "notification_failed",
        note: "mailbox full",
      }),
      notificationEvent({ id: "2", kind: "notified" }),
      notificationEvent({ id: "1", kind: "issued" }),
    ];

    expect(latestNotification(events)?.id).toBe("3");
  });

  it("skips non notification events to find the notification underneath", () => {
    const events: InvoiceEventRow[] = [
      notificationEvent({ id: "2", kind: "paid" }),
      notificationEvent({ id: "1", kind: "notified" }),
    ];

    expect(latestNotification(events)?.id).toBe("1");
  });

  it("returns undefined when there has never been a notification attempt", () => {
    const events: InvoiceEventRow[] = [
      notificationEvent({ id: "1", kind: "issued" }),
    ];

    expect(latestNotification(events)).toBeUndefined();
  });

  it("returns undefined for no events at all", () => {
    expect(latestNotification([])).toBeUndefined();
  });
});
