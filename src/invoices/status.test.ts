/**
 * covers: spec 0012 AC-9, AC-12, AC-16
 *
 * Every status pair, the past due boundary, the number padding at 9999 and
 * 10000, and the client visible set.
 */
import { describe, expect, it } from "vitest";

import type { InvoiceStatus } from "@/db/schema";

import {
  CLIENT_VISIBLE_STATUSES,
  DEFAULT_TERMS_DAYS,
  INVOICE_STATUSES,
  canTransition,
  displayNumber,
  formatInvoiceNumber,
  isClientVisible,
  isPastDue,
  nextActions,
  statusesAllowing,
} from "./status";

const ALLOWED: readonly (readonly [InvoiceStatus, InvoiceStatus])[] = [
  ["draft", "sent"],
  ["draft", "void"],
  ["sent", "paid"],
  ["sent", "overdue"],
  ["sent", "void"],
  ["overdue", "paid"],
  ["overdue", "void"],
];

describe("canTransition", () => {
  it.each(ALLOWED)("allows %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it("refuses every other pair, including staying put", () => {
    for (const from of INVOICE_STATUSES) {
      for (const to of INVOICE_STATUSES) {
        const allowed = ALLOWED.some(([a, b]) => a === from && b === to);

        expect(canTransition(from, to), `${from} → ${to}`).toBe(allowed);
      }
    }
  });

  it("makes paid and void final", () => {
    for (const to of INVOICE_STATUSES) {
      expect(canTransition("paid", to)).toBe(false);
      expect(canTransition("void", to)).toBe(false);
    }
  });
});

describe("nextActions", () => {
  it("offers issue and void on a draft", () => {
    expect(nextActions("draft")).toStrictEqual(["issue", "void"]);
  });

  it("offers mark paid, void and resend on sent and overdue", () => {
    expect(nextActions("sent")).toStrictEqual(["mark_paid", "void", "resend"]);
    expect(nextActions("overdue")).toStrictEqual([
      "mark_paid",
      "void",
      "resend",
    ]);
  });

  it("offers nothing on paid and void", () => {
    expect(nextActions("paid")).toStrictEqual([]);
    expect(nextActions("void")).toStrictEqual([]);
  });

  it("never offers the sweep's move as a button", () => {
    for (const status of INVOICE_STATUSES) {
      expect(nextActions(status)).not.toContain("overdue");
    }
  });

  it("inverts cleanly into the statuses each action allows", () => {
    expect(statusesAllowing("issue")).toStrictEqual(["draft"]);
    expect(statusesAllowing("void")).toStrictEqual([
      "draft",
      "sent",
      "overdue",
    ]);
    expect(statusesAllowing("mark_paid")).toStrictEqual(["sent", "overdue"]);
    expect(statusesAllowing("resend")).toStrictEqual(["sent", "overdue"]);
  });
});

describe("isPastDue", () => {
  const today = "2026-09-15";

  it("is true only for sent with a due date before today", () => {
    expect(isPastDue("sent", "2026-09-14", today)).toBe(true);
  });

  it("is false when due today", () => {
    expect(isPastDue("sent", today, today)).toBe(false);
  });

  it("is false when due tomorrow, or with no due date", () => {
    expect(isPastDue("sent", "2026-09-16", today)).toBe(false);
    expect(isPastDue("sent", null, today)).toBe(false);
  });

  it("is false for every status but sent, even with a past due date", () => {
    for (const status of INVOICE_STATUSES.filter((s) => s !== "sent")) {
      expect(isPastDue(status, "2026-01-01", today), status).toBe(false);
    }
  });
});

describe("formatInvoiceNumber", () => {
  it.each([
    [1, "INV-0001"],
    [42, "INV-0042"],
    [9999, "INV-9999"],
    [10000, "INV-10000"],
    [123456, "INV-123456"],
  ])("pads %i to %s", (number, expected) => {
    expect(formatInvoiceNumber(number)).toBe(expected);
  });

  it("shows Draft for an unassigned number", () => {
    expect(displayNumber(null)).toBe("Draft");
    expect(displayNumber(7)).toBe("INV-0007");
  });
});

describe("CLIENT_VISIBLE_STATUSES", () => {
  it("names sent, overdue and paid and nothing else", () => {
    expect([...CLIENT_VISIBLE_STATUSES].sort()).toStrictEqual([
      "overdue",
      "paid",
      "sent",
    ]);
    expect(isClientVisible("draft")).toBe(false);
    expect(isClientVisible("void")).toBe(false);
    expect(isClientVisible("sent")).toBe(true);
  });
});

describe("DEFAULT_TERMS_DAYS", () => {
  it("is thirty", () => {
    expect(DEFAULT_TERMS_DAYS).toBe(30);
  });
});
