/**
 * @vitest-environment node
 *
 * covers: spec 0008 AC-1, AC-2, AC-3
 *
 * The whole truth table from the spec's State transitions section, plus the
 * boundary, which is the one line in it that a clock test can actually tip.
 * Pure, so every case is a row.
 */
import { describe, expect, it } from "vitest";

import { SUBSCRIPTION_STATUSES } from "@/payments/subscription-status";

import {
  accessLevel,
  accessVerdict,
  GRACE_WINDOW_DAYS,
  graceEndsAt,
} from "./level";

const NOW = new Date("2026-09-11T12:00:00.000Z");

const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

describe("accessVerdict, over the full table (AC-1)", () => {
  it("is unsubscribed with no row at all", () => {
    expect(accessVerdict(undefined, NOW)).toStrictEqual({
      level: "unsubscribed",
    });
  });

  it("is unsubscribed while a Checkout is still incomplete", () => {
    expect(accessLevel({ status: "incomplete", pastDueSince: null }, NOW)).toBe(
      "unsubscribed",
    );
  });

  it.each(["trialing", "active"] as const)("is full on %s", (status) => {
    expect(accessVerdict({ status, pastDueSince: null }, NOW)).toStrictEqual({
      level: "full",
    });
  });

  it.each(["unpaid", "canceled", "incomplete_expired", "paused"] as const)(
    "is locked on %s",
    (status) => {
      expect(accessVerdict({ status, pastDueSince: null }, NOW)).toStrictEqual({
        level: "locked",
      });
    },
  );

  it("locks on a status this build has never heard of", () => {
    expect(
      accessVerdict({ status: "something_new", pastDueSince: null }, NOW),
    ).toStrictEqual({ level: "locked" });
  });

  it("has a verdict for every known status, with nothing left to a default", () => {
    for (const status of SUBSCRIPTION_STATUSES) {
      const verdict = accessVerdict({ status, pastDueSince: daysAgo(1) }, NOW);

      expect(["unsubscribed", "full", "grace", "locked"]).toContain(
        verdict.level,
      );
    }
  });

  it("ignores cancel_at_period_end, which is not even an input", () => {
    // The type admits only the two columns; a row carrying more is fine, the
    // extra fields simply do not reach the switch.
    const row = {
      status: "active",
      pastDueSince: null,
      cancelAtPeriodEnd: true,
    };

    expect(accessLevel(row, NOW)).toBe("full");
  });
});

describe("the grace window (AC-2)", () => {
  it("is grace an hour after the failure, and says when it ends", () => {
    const since = daysAgo(0);
    since.setUTCHours(since.getUTCHours() - 1);

    expect(
      accessVerdict({ status: "past_due", pastDueSince: since }, NOW),
    ).toStrictEqual({ level: "grace", graceEndsAt: graceEndsAt(since) });
  });

  it("closes the window exactly 7 days after past_due_since", () => {
    const since = daysAgo(GRACE_WINDOW_DAYS);

    expect(
      accessVerdict({ status: "past_due", pastDueSince: since }, NOW),
    ).toStrictEqual({ level: "locked" });
  });

  it("is still grace one millisecond before the boundary", () => {
    const since = new Date(daysAgo(GRACE_WINDOW_DAYS).getTime() + 1);

    expect(accessLevel({ status: "past_due", pastDueSince: since }, NOW)).toBe(
      "grace",
    );
  });

  it("locks with no write and no job: only the clock moved", () => {
    const since = daysAgo(GRACE_WINDOW_DAYS);
    const row = { status: "past_due", pastDueSince: since };
    const aMinuteEarlier = new Date(NOW.getTime() - 60 * 1000);

    expect(accessLevel(row, aMinuteEarlier)).toBe("grace");
    expect(accessLevel(row, NOW)).toBe("locked");
  });

  it("measures the window from past_due_since, not from now", () => {
    expect(graceEndsAt(new Date("2026-09-04T12:00:00.000Z"))).toStrictEqual(
      new Date("2026-09-11T12:00:00.000Z"),
    );
  });
});

describe("past_due with no start date (AC-3)", () => {
  it("is locked, never an open ended grace window, and names the break", () => {
    expect(
      accessVerdict({ status: "past_due", pastDueSince: null }, NOW),
    ).toStrictEqual({
      level: "locked",
      invariantBreak: "past_due_without_since",
    });
  });

  it("reports no break on any other row", () => {
    for (const status of SUBSCRIPTION_STATUSES.filter(
      (s) => s !== "past_due",
    )) {
      expect(
        accessVerdict({ status, pastDueSince: null }, NOW).invariantBreak,
      ).toBeUndefined();
    }
  });
});
