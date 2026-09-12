/**
 * covers: spec 0008 AC-1
 *
 * `SUBSCRIPTION_STATUSES` and `isKnownStatus` are exercised indirectly by
 * every status in `level.test.ts` and `billing-state.test.ts`, but nothing
 * asserts the list itself: that it is exactly Stripe's eight, with no
 * duplicate, and that the guard agrees with it in both directions. Both
 * readers trust this file for that, so a status silently dropped or
 * duplicated here would not fail anywhere else.
 */
import { describe, expect, it } from "vitest";

import { isKnownStatus, SUBSCRIPTION_STATUSES } from "./subscription-status";

describe("SUBSCRIPTION_STATUSES", () => {
  it("lists Stripe's eight statuses, each once", () => {
    expect(SUBSCRIPTION_STATUSES).toStrictEqual([
      "trialing",
      "active",
      "past_due",
      "canceled",
      "incomplete",
      "incomplete_expired",
      "unpaid",
      "paused",
    ]);
    expect(new Set(SUBSCRIPTION_STATUSES).size).toBe(
      SUBSCRIPTION_STATUSES.length,
    );
  });
});

describe("isKnownStatus", () => {
  it.each(SUBSCRIPTION_STATUSES)("accepts %s", (status) => {
    expect(isKnownStatus(status)).toBe(true);
  });

  it("refuses a status this build does not know, such as one Stripe adds later", () => {
    expect(isKnownStatus("something_new")).toBe(false);
  });

  it("refuses the empty string", () => {
    expect(isKnownStatus("")).toBe(false);
  });
});
