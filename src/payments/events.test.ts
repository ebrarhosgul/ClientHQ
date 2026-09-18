/**
 * covers: spec 0007 AC-4
 *
 * The two fields that moved, and the parse that makes moving them again loud.
 *
 * Stripe's Basil release took `current_period_end` and the price off the
 * subscription and put them on its items. Reading the old path does not throw,
 * it returns `undefined`, which would store a null renewal date, break the
 * trial end on `/billing`, and hand feature 9 a grace window measured from
 * nothing. Every test here is really the same test: prove the shape is checked
 * rather than assumed.
 */
import { describe, expect, it } from "vitest";

import {
  checkoutSessionCompleted,
  invoiceEvent,
  orgIdFromMetadata,
  primaryItem,
  retrievedSubscription,
} from "./events";

const PERIOD_END = 1790000000;
const CREATED = 1700000000;

function subscriptionPayload(patch: Record<string, unknown> = {}) {
  return {
    id: "sub_123",
    customer: "cus_123",
    status: "trialing",
    cancel_at_period_end: false,
    created: CREATED,
    metadata: { org_id: "00000000-0000-7000-8000-000000000001" },
    items: {
      data: [
        {
          current_period_end: PERIOD_END,
          price: { id: "price_123" },
        },
      ],
    },
    ...patch,
  };
}

describe("the retrieved subscription", () => {
  it("reads the period end off the item, as a real date", () => {
    const parsed = retrievedSubscription.parse(subscriptionPayload());

    expect(primaryItem(parsed).current_period_end).toEqual(
      new Date(PERIOD_END * 1000),
    );
    expect(primaryItem(parsed).price.id).toBe("price_123");
  });

  it("refuses a subscription with no items rather than storing a null renewal date", () => {
    // The shape a pre Basil reader would produce: a top level period end, and
    // nothing on the items. Silent before; loud now.
    const preBasil = subscriptionPayload({
      current_period_end: PERIOD_END,
      items: { data: [] },
    });

    expect(() => retrievedSubscription.parse(preBasil)).toThrow();
  });

  it("refuses an item that has lost its period end", () => {
    const moved = subscriptionPayload({
      items: { data: [{ price: { id: "price_123" } }] },
    });

    expect(() => retrievedSubscription.parse(moved)).toThrow();
  });

  it("reads the customer whether Stripe sends an id or the expanded object", () => {
    expect(retrievedSubscription.parse(subscriptionPayload()).customer).toBe(
      "cus_123",
    );

    expect(
      retrievedSubscription.parse(
        subscriptionPayload({
          customer: { id: "cus_123", object: "customer" },
        }),
      ).customer,
    ).toBe("cus_123");
  });

  it("keeps a status nobody has seen before, because the column has no CHECK either", () => {
    const parsed = retrievedSubscription.parse(
      subscriptionPayload({ status: "something_new" }),
    );

    expect(parsed.status).toBe("something_new");
  });

  it("reads created as a real date, for the reconcile's newest per agency rule (spec 0017)", () => {
    const parsed = retrievedSubscription.parse(subscriptionPayload());

    expect(parsed.created).toEqual(new Date(CREATED * 1000));
  });
});

describe("the org_id fallback for an event that outran its session", () => {
  it("reads org_id from the subscription metadata this app wrote", () => {
    const parsed = retrievedSubscription.parse(subscriptionPayload());

    expect(orgIdFromMetadata(parsed)).toBe(
      "00000000-0000-7000-8000-000000000001",
    );
  });

  it("treats missing, blank and absent metadata alike", () => {
    for (const metadata of [{}, { org_id: "   " }, null, undefined]) {
      const parsed = retrievedSubscription.parse(
        subscriptionPayload({ metadata }),
      );

      expect(orgIdFromMetadata(parsed)).toBeUndefined();
    }
  });
});

describe("the events that only point at things", () => {
  it("reads the agency and the subscription off a completed Checkout Session", () => {
    const parsed = checkoutSessionCompleted.parse({
      client_reference_id: "00000000-0000-7000-8000-000000000001",
      customer: "cus_123",
      subscription: "sub_123",
    });

    expect(parsed.client_reference_id).toBe(
      "00000000-0000-7000-8000-000000000001",
    );
    expect(parsed.subscription).toBe("sub_123");
  });

  it("accepts a session that produced no subscription", () => {
    const parsed = checkoutSessionCompleted.parse({
      client_reference_id: null,
      customer: null,
      subscription: null,
    });

    expect(parsed.subscription).toBeNull();
  });

  it("finds an invoice's subscription under parent.subscription_details", () => {
    const parsed = invoiceEvent.parse({
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: "sub_123", metadata: null },
      },
    });

    expect(parsed.parent?.subscription_details?.subscription).toBe("sub_123");
  });

  it("finds nothing on a one off invoice, which is the right answer, not an error", () => {
    const parsed = invoiceEvent.parse({ parent: null });

    expect(parsed.parent?.subscription_details?.subscription).toBeUndefined();
  });

  it("does not fall back to the pre Basil top level field", () => {
    // If this ever starts passing, the handler is reading a path the pinned API
    // version does not populate.
    const parsed = invoiceEvent.parse({
      parent: null,
      subscription: "sub_123",
    });

    expect(parsed.parent?.subscription_details?.subscription).toBeUndefined();
  });
});
