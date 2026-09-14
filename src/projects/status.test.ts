/**
 * covers: spec 0010 AC-6, AC-8, AC-10
 *
 * The pure module both the detail page and `transitionProject` read, so every
 * pair of statuses and the overdue boundary are exercised here once rather
 * than re-proven at every call site.
 */
import { describe, expect, it } from "vitest";

import { PROJECT_STATUSES } from "@/db/schema";

import { canTransition, isOverdue, nextStatuses } from "./status";

describe("nextStatuses", () => {
  it("offers exactly one forward move from planning", () => {
    expect(nextStatuses("planning", false)).toStrictEqual([
      { to: "in_progress", label: "Start work", confirm: false },
    ]);
  });

  it("offers exactly one forward move from in_progress", () => {
    expect(nextStatuses("in_progress", false)).toStrictEqual([
      { to: "in_review", label: "Send to review", confirm: false },
    ]);
  });

  it("offers deliver (confirmed) and reopen from in_review", () => {
    expect(nextStatuses("in_review", false)).toStrictEqual([
      { to: "delivered", label: "Mark delivered", confirm: true },
      { to: "in_progress", label: "Reopen", confirm: false },
    ]);
  });

  it("offers nothing from delivered, the final status", () => {
    expect(nextStatuses("delivered", false)).toStrictEqual([]);
  });

  it.each(PROJECT_STATUSES)(
    "offers nothing while archived, regardless of status (%s)",
    (status) => {
      expect(nextStatuses(status, true)).toStrictEqual([]);
    },
  );
});

describe("canTransition", () => {
  const allowed = new Set([
    "planning>in_progress",
    "in_progress>in_review",
    "in_review>delivered",
    "in_review>in_progress",
  ]);

  it.each(
    PROJECT_STATUSES.flatMap((from) =>
      PROJECT_STATUSES.map((to) => [from, to] as const),
    ),
  )("%s → %s is %s", (from, to) => {
    expect(canTransition(from, to)).toBe(allowed.has(`${from}>${to}`));
  });
});

describe("isOverdue", () => {
  const TODAY = "2026-06-15";

  it("is not overdue with no due date", () => {
    expect(isOverdue(null, "planning", null, TODAY)).toBe(false);
  });

  it("is not overdue when due today", () => {
    expect(isOverdue(TODAY, "in_progress", null, TODAY)).toBe(false);
  });

  it("is overdue when due yesterday and still open", () => {
    expect(isOverdue("2026-06-14", "in_review", null, TODAY)).toBe(true);
  });

  it("is overdue when due date is far in the past", () => {
    expect(isOverdue("2020-01-01", "planning", null, TODAY)).toBe(true);
  });

  it("is not overdue once delivered, however late", () => {
    expect(isOverdue("2020-01-01", "delivered", null, TODAY)).toBe(false);
  });

  it("is not overdue while archived, however late", () => {
    expect(isOverdue("2020-01-01", "in_progress", new Date(), TODAY)).toBe(
      false,
    );
  });

  it("is not overdue when the due date is in the future", () => {
    expect(isOverdue("2026-06-16", "planning", null, TODAY)).toBe(false);
  });
});
