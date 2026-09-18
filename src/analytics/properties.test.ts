/**
 * @vitest-environment node
 *
 * covers: spec 0019 AC-9, AC-13
 *
 * The catalogue test (`events.test.ts`) proves no event schema outputs a
 * plain string; this is the layer under it, the property kinds themselves.
 */
import { describe, expect, it } from "vitest";

import {
  countProperty,
  flagProperty,
  idProperty,
  isoDateProperty,
  literalProperty,
  subscriptionStatusProperty,
  SUBSCRIPTION_STATUS_PROPERTY,
} from "./properties";

describe("subscriptionStatusProperty", () => {
  it.each(SUBSCRIPTION_STATUS_PROPERTY)(
    "passes %s through unchanged",
    (status) => {
      expect(subscriptionStatusProperty(status)).toBe(status);
    },
  );

  it("is none when the agency has no subscription row", () => {
    expect(subscriptionStatusProperty(undefined)).toBe("none");
  });

  it("folds a status Stripe invents tomorrow into other, rather than dropping the event", () => {
    expect(subscriptionStatusProperty("some_future_status")).toBe("other");
  });
});

describe("idProperty", () => {
  const schema = idProperty();

  it("accepts a non empty string", () => {
    expect(schema.safeParse("org_123").success).toBe(true);
  });

  it("refuses an empty string", () => {
    expect(schema.safeParse("").success).toBe(false);
  });
});

describe("isoDateProperty", () => {
  const schema = isoDateProperty();

  it("accepts an ISO 8601 timestamp exactly as toISOString writes one", () => {
    expect(schema.safeParse(new Date().toISOString()).success).toBe(true);
  });

  it("refuses a date that is not ISO 8601", () => {
    expect(schema.safeParse("2026-09-18").success).toBe(false);
    expect(schema.safeParse("not a date").success).toBe(false);
  });
});

describe("countProperty", () => {
  const schema = countProperty();

  it("accepts a non negative integer", () => {
    expect(schema.safeParse(0).success).toBe(true);
    expect(schema.safeParse(3).success).toBe(true);
  });

  it("refuses a negative number and a non integer", () => {
    expect(schema.safeParse(-1).success).toBe(false);
    expect(schema.safeParse(1.5).success).toBe(false);
  });
});

describe("flagProperty", () => {
  it("accepts only a boolean", () => {
    const schema = flagProperty();

    expect(schema.safeParse(true).success).toBe(true);
    expect(schema.safeParse("true").success).toBe(false);
  });
});

describe("literalProperty", () => {
  const schema = literalProperty(["accepted", "declined"] as const);

  it("accepts one of the declared words", () => {
    expect(schema.safeParse("accepted").success).toBe(true);
  });

  it("refuses a word outside the closed set", () => {
    expect(schema.safeParse("maybe").success).toBe(false);
  });
});
