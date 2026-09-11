/**
 * @vitest-environment node
 *
 * covers: spec 0007 AC-11, AC-24
 *
 * The two Stripe calls behind the webhook's `StripeGateway`, with the SDK
 * stubbed at the one seam this module owns. What is pinned: the signature is
 * checked against the raw body and the secret from the environment, a failed
 * check surfaces as a throw (which the handler turns into 400), and the
 * re read goes to `subscriptions.retrieve` with the id it was given.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEventAsync: vi.fn(),
  retrieve: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: () => ({ STRIPE_WEBHOOK_SECRET: "whsec_test_secret" }),
}));

vi.mock("./stripe", () => ({
  stripeClient: () => ({
    webhooks: { constructEventAsync: mocks.constructEventAsync },
    subscriptions: { retrieve: mocks.retrieve },
  }),
}));

const { liveStripeGateway } = await import("./gateway");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("constructEvent", () => {
  it("verifies the raw body against the header and the webhook secret", async () => {
    mocks.constructEventAsync.mockResolvedValue({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_1" } },
    });

    await liveStripeGateway().constructEvent('{"raw":true}', "t=1,v1=abc");

    expect(mocks.constructEventAsync).toHaveBeenCalledWith(
      '{"raw":true}',
      "t=1,v1=abc",
      "whsec_test_secret",
    );
  });

  it("reduces the verified event to its id, type and object", async () => {
    mocks.constructEventAsync.mockResolvedValue({
      id: "evt_1",
      type: "customer.subscription.updated",
      created: 1,
      livemode: false,
      data: { object: { id: "sub_1" }, previous_attributes: { status: "x" } },
    });

    const event = await liveStripeGateway().constructEvent("{}", "sig");

    expect(event).toStrictEqual({
      id: "evt_1",
      type: "customer.subscription.updated",
      object: { id: "sub_1" },
    });
  });

  it("lets a failed verification throw, which the handler answers 400 (AC-11)", async () => {
    mocks.constructEventAsync.mockRejectedValue(
      new Error("No signatures found matching the expected signature"),
    );

    await expect(
      liveStripeGateway().constructEvent("{}", "t=1,v1=nonsense"),
    ).rejects.toThrow(/signature/);
  });
});

describe("retrieveSubscription", () => {
  it("re reads the subscription by the id it was handed", async () => {
    const fresh = { id: "sub_1", status: "active" };
    mocks.retrieve.mockResolvedValue(fresh);

    const result = await liveStripeGateway().retrieveSubscription("sub_1");

    expect(mocks.retrieve).toHaveBeenCalledWith("sub_1");
    expect(result).toBe(fresh);
  });

  it("lets a resource_missing error through untouched, so the handler can refuse it", async () => {
    const missing = Object.assign(new Error("No such subscription"), {
      code: "resource_missing",
    });
    mocks.retrieve.mockRejectedValue(missing);

    await expect(
      liveStripeGateway().retrieveSubscription("sub_gone"),
    ).rejects.toBe(missing);
  });
});
