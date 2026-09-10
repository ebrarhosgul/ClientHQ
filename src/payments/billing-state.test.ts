/**
 * covers: spec 0007 AC-1, AC-5, AC-6
 *
 * What `/billing` says, and which action it offers, for every state the row can
 * be in. Pure, so all of it is a table.
 *
 * The case worth reading is the cancelled one: it is the regression this file
 * exists for. Choosing the action from "is there a customer id" instead of from
 * the status leaves an agency that cancelled staring at a portal it cannot
 * resubscribe from, and nothing about that looks broken until someone tries.
 */
import { describe, expect, it } from "vitest";

import { billingView, formatBillingDate } from "./billing-state";
import type { SubscriptionRow } from "./queries";

function row(patch: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: "00000000-0000-7000-8000-000000000001",
    orgId: "00000000-0000-7000-8000-000000000002",
    stripeCustomerId: "cus_test",
    stripeSubscriptionId: "sub_test",
    stripePriceId: "price_test",
    status: "active",
    currentPeriodEnd: new Date("2026-10-01T12:00:00Z"),
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    createdAt: new Date("2026-09-01T12:00:00Z"),
    updatedAt: new Date("2026-09-01T12:00:00Z"),
    ...patch,
  };
}

describe("what the billing page offers", () => {
  it("offers Checkout and no portal when the agency has never subscribed", () => {
    const view = billingView(undefined);

    expect(view.label).toBe("No subscription");
    expect(view.canSubscribe).toBe(true);
    expect(view.canOpenPortal).toBe(false);
  });

  it("offers the portal and no Checkout while a subscription is live", () => {
    for (const status of [
      "trialing",
      "active",
      "past_due",
      "incomplete",
      "paused",
    ]) {
      const view = billingView(row({ status }));

      expect(view.canSubscribe, status).toBe(false);
      expect(view.canOpenPortal, status).toBe(true);
    }
  });

  it("offers both to an agency that has ended, so it can resubscribe and still read its invoices", () => {
    for (const status of ["canceled", "incomplete_expired", "unpaid"]) {
      const view = billingView(row({ status }));

      expect(view.canSubscribe, status).toBe(true);
      expect(view.canOpenPortal, status).toBe(true);
    }
  });

  it("renders a status nobody has seen before rather than falling over", () => {
    const view = billingView(row({ status: "something_new" }));

    expect(view.description).toContain("something_new");
    // Never offer Checkout to an agency that might already be paying.
    expect(view.canSubscribe).toBe(false);
    expect(view.canOpenPortal).toBe(true);
  });
});

describe("the date the page shows", () => {
  it("calls the trial end a trial end, which is why there is no trial_end column", () => {
    const view = billingView(row({ status: "trialing" }));

    expect(view.dateLine).toBe("Your free trial ends on 1 October 2026 (UTC).");
  });

  it("calls it a renewal once the trial is over", () => {
    expect(billingView(row({ status: "active" })).dateLine).toBe(
      "Your subscription renews on 1 October 2026 (UTC).",
    );
  });

  it("says access ends, not renews, once cancellation is scheduled", () => {
    const view = billingView(row({ cancelAtPeriodEnd: true }));

    expect(view.dateLine).toBe("Your access ends on 1 October 2026 (UTC).");
  });

  it("has no date line at all when the row has no period end", () => {
    expect(
      billingView(row({ currentPeriodEnd: null })).dateLine,
    ).toBeUndefined();
  });

  it("renders in UTC and says so, so a late evening timestamp is not read as the next day", () => {
    // 23:30 UTC is already tomorrow in Sydney and still today in London. The
    // product has no per user timezone, so the only honest answer names one.
    expect(formatBillingDate(new Date("2026-09-11T23:30:00Z"))).toBe(
      "11 September 2026 (UTC)",
    );
    expect(formatBillingDate(new Date("2026-09-12T00:30:00Z"))).toBe(
      "12 September 2026 (UTC)",
    );
  });
});
