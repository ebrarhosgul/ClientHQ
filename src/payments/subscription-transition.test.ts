// @vitest-environment node
import { describe, expect, it } from "vitest";

import { subscriptionTransition } from "./subscription-mirror";

describe("subscriptionTransition (spec 0019, AC-11)", () => {
  it("is started on any move into active", () => {
    expect(subscriptionTransition(undefined, "active")).toBe("started");
    expect(subscriptionTransition("trialing", "active")).toBe("started");
    expect(subscriptionTransition("past_due", "active")).toBe("started");
    expect(subscriptionTransition("canceled", "active")).toBe("started");
  });

  it("is none when the status is unchanged, active included", () => {
    expect(subscriptionTransition("active", "active")).toBe("none");
    expect(subscriptionTransition("trialing", "trialing")).toBe("none");
  });

  it("is changed on every other change, a first trialing row included", () => {
    expect(subscriptionTransition(undefined, "trialing")).toBe("changed");
    expect(subscriptionTransition("active", "past_due")).toBe("changed");
    expect(subscriptionTransition("active", "canceled")).toBe("changed");
    expect(subscriptionTransition("trialing", "canceled")).toBe("changed");
  });
});
