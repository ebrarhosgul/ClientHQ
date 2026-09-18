/**
 * @vitest-environment node
 *
 * covers: spec 0019 AC-11, AC-13
 *
 * `subscriptionStatusProperty` is the real implementation (it is pure and
 * its own tests live in `src/analytics/properties.test.ts`); `analytics()`
 * and `identifyAgency` are mocked, since a committed mirror write is the
 * only thing this file is meant to add on top of them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/tenant";

import type { RetrievedSubscription } from "./events";
import type { SubscriptionMirrorResult } from "./subscription-mirror";

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  identifyAgency: vi.fn(),
}));

vi.mock("@/analytics", async () => {
  const actual =
    await vi.importActual<typeof import("@/analytics")>("@/analytics");

  return { ...actual, analytics: () => ({ track: mocks.track }) };
});

vi.mock("@/analytics/agency-group", () => ({
  identifyAgency: mocks.identifyAgency,
}));

const { reportSubscriptionMirror } = await import("./analytics");

beforeEach(() => {
  vi.clearAllMocks();
});

const db = {} as unknown as Database;

const subscription: RetrievedSubscription = {
  id: "sub_1",
  customer: "cus_1",
  status: "active",
  cancel_at_period_end: false,
  created: new Date("2026-01-01T00:00:00.000Z"),
  trial_end: null,
  metadata: null,
  items: {
    data: [
      {
        current_period_end: new Date("2026-02-01T00:00:00.000Z"),
        price: { id: "price_1" },
      },
    ],
  },
};

describe("reportSubscriptionMirror", () => {
  it("does nothing when the mirror write was not applied", async () => {
    const result: SubscriptionMirrorResult = {
      outcome: "customer_id_conflict",
      transition: "none",
      subscribedAt: undefined,
    };

    await reportSubscriptionMirror(db, "org_1", subscription, result);

    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.identifyAgency).not.toHaveBeenCalled();
  });

  it("does nothing when the transition is none, even though the write was applied", async () => {
    const result: SubscriptionMirrorResult = {
      outcome: "applied",
      transition: "none",
      subscribedAt: undefined,
    };

    await reportSubscriptionMirror(db, "org_1", subscription, result);

    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.identifyAgency).not.toHaveBeenCalled();
  });

  it("tracks subscription.started on the org, and re identifies the agency", async () => {
    const subscribedAt = new Date("2026-03-01T00:00:00.000Z");
    const result: SubscriptionMirrorResult = {
      outcome: "applied",
      transition: "started",
      subscribedAt,
    };

    await reportSubscriptionMirror(db, "org_1", subscription, result);

    expect(mocks.track).toHaveBeenCalledWith("subscription.started", {
      distinctId: { kind: "org", orgId: "org_1" },
      orgId: "org_1",
      properties: {
        subscribed_at: subscribedAt.toISOString(),
        subscription_status: "active",
      },
    });
    expect(mocks.identifyAgency).toHaveBeenCalledWith(
      "org_1",
      { subscription, subscribedAt },
      db,
    );
  });

  it("falls back to now for subscribed_at when the mirror did not record one", async () => {
    const result: SubscriptionMirrorResult = {
      outcome: "applied",
      transition: "started",
      subscribedAt: undefined,
    };

    await reportSubscriptionMirror(db, "org_1", subscription, result);

    const [, input] = mocks.track.mock.calls[0] as [
      string,
      { properties: { subscribed_at: string } },
    ];
    expect(() => new Date(input.properties.subscribed_at)).not.toThrow();
    expect(
      Number.isNaN(new Date(input.properties.subscribed_at).getTime()),
    ).toBe(false);
  });

  it("tracks subscription.changed for any other transition, with both status fields", async () => {
    const result: SubscriptionMirrorResult = {
      outcome: "applied",
      transition: "changed",
      subscribedAt: undefined,
    };

    await reportSubscriptionMirror(
      db,
      "org_1",
      { ...subscription, status: "past_due" },
      result,
    );

    expect(mocks.track).toHaveBeenCalledWith("subscription.changed", {
      distinctId: { kind: "org", orgId: "org_1" },
      orgId: "org_1",
      properties: { status: "past_due", subscription_status: "past_due" },
    });
  });

  it("folds an unrecognized Stripe status into other before sending it", async () => {
    const result: SubscriptionMirrorResult = {
      outcome: "applied",
      transition: "changed",
      subscribedAt: undefined,
    };

    await reportSubscriptionMirror(
      db,
      "org_1",
      { ...subscription, status: "something_new" },
      result,
    );

    expect(mocks.track).toHaveBeenCalledWith(
      "subscription.changed",
      expect.objectContaining({
        properties: { status: "other", subscription_status: "other" },
      }),
    );
  });
});
