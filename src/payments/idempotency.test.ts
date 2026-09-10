/**
 * covers: spec 0007 AC-18
 *
 * The key that turns two clicks into one Checkout Session.
 *
 * The subtle half is the second case: Stripe refuses a reused key whose
 * parameters changed, so a key that ignored whether a customer is being
 * attached would start erroring the moment an agency resubscribed, which is
 * precisely the path that was hardest to get right in the first place.
 */
import { describe, expect, it } from "vitest";

import { checkoutIdempotencyKey } from "./idempotency";

const ORG = "00000000-0000-7000-8000-000000000001";

describe("the checkout idempotency key", () => {
  it("is the same for two clicks a few seconds apart", () => {
    const first = checkoutIdempotencyKey(
      ORG,
      undefined,
      new Date("2026-09-11T12:00:05Z"),
    );
    const second = checkoutIdempotencyKey(
      ORG,
      undefined,
      new Date("2026-09-11T12:02:40Z"),
    );

    expect(second).toBe(first);
  });

  it("changes when an existing customer is attached, because the parameters change", () => {
    const at = new Date("2026-09-11T12:00:05Z");

    expect(checkoutIdempotencyKey(ORG, "cus_abc", at)).not.toBe(
      checkoutIdempotencyKey(ORG, undefined, at),
    );
  });

  it("expires, so a genuine second attempt later is a fresh session", () => {
    const first = checkoutIdempotencyKey(
      ORG,
      undefined,
      new Date("2026-09-11T12:00:05Z"),
    );
    const later = checkoutIdempotencyKey(
      ORG,
      undefined,
      new Date("2026-09-11T12:30:00Z"),
    );

    expect(later).not.toBe(first);
  });

  it("never collides between two agencies clicking at the same moment", () => {
    const at = new Date("2026-09-11T12:00:05Z");
    const other = "00000000-0000-7000-8000-000000000009";

    expect(checkoutIdempotencyKey(other, undefined, at)).not.toBe(
      checkoutIdempotencyKey(ORG, undefined, at),
    );
  });
});
