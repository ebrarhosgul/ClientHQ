/**
 * @vitest-environment node
 *
 * covers: spec 0007 AC-2, AC-13, AC-14, AC-18
 *
 * What `startCheckout` asks Stripe for, and who it lets ask. The real
 * `withTenantAction` runs here, with only the session lookup, the scoped
 * accessor, the environment and the Stripe client stubbed at their edges, so
 * the admin guard being exercised is the one the product ships (AC-13), not a
 * copy of it.
 *
 * The values worth pinning are the ones nobody would notice going missing until
 * a webhook arrived with no idea whose payment it was: `client_reference_id`,
 * the `org_id` in the subscription metadata, the reused customer, and the
 * idempotency key.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const REDIRECTED = "NEXT_REDIRECT";

const mocks = vi.hoisted(() => ({
  tenantContext: vi.fn(),
  findFirst: vi.fn(),
  sessionsCreate: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/db/tenant/context", async (importActual) => {
  const actual = await importActual<typeof import("@/db/tenant/context")>();

  return { ...actual, tenantContext: mocks.tenantContext };
});

vi.mock("@/db/tenant/accessor", () => ({
  tenantDb: () => ({ findFirst: mocks.findFirst }),
}));

vi.mock("@/lib/env", () => ({
  env: () => ({
    NEXT_PUBLIC_APP_URL: "https://app.example.test",
    STRIPE_PRICE_ID: "price_monthly",
  }),
}));

vi.mock("./stripe", () => ({
  stripeClient: () => ({
    checkout: { sessions: { create: mocks.sessionsCreate } },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(REDIRECTED);
  },
}));

const { startCheckout } = await import("./start-checkout");

const ORG_ID = "00000000-0000-7000-8000-000000000002";

const ADMIN = {
  kind: "staff" as const,
  orgId: ORG_ID,
  clerkOrgId: "org_clerk",
  userId: "user-1",
  clerkUserId: "user_clerk",
  role: "admin" as const,
};

const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_123";

/** The one argument object Stripe was handed. */
function sessionParams(): Record<string, unknown> {
  const [params] = mocks.sessionsCreate.mock.calls[0] as [
    Record<string, unknown>,
    Record<string, unknown>,
  ];

  return params;
}

/** The request options Stripe was handed. */
function sessionOptions(): Record<string, unknown> {
  const [, options] = mocks.sessionsCreate.mock.calls[0] as [
    Record<string, unknown>,
    Record<string, unknown>,
  ];

  return options;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  mocks.tenantContext.mockResolvedValue(ADMIN);
  mocks.findFirst.mockResolvedValue(undefined);
  mocks.sessionsCreate.mockResolvedValue({ url: CHECKOUT_URL });
});

describe("who may start Checkout (AC-13)", () => {
  it("refuses a member with forbidden before touching Stripe", async () => {
    mocks.tenantContext.mockResolvedValue({ ...ADMIN, role: "member" });

    const result = await startCheckout({});

    expect(result).toStrictEqual({
      ok: false,
      error: { code: "forbidden", message: expect.any(String) },
    });
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("refuses a client contact, who is not agency staff at all", async () => {
    mocks.tenantContext.mockResolvedValue({
      kind: "contact",
      orgId: ORG_ID,
      userId: "user-9",
      clerkUserId: "user_clerk_9",
      clientId: "client-1",
      contactId: "contact-1",
    });

    const result = await startCheckout({});

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("forbidden");
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it("decides from the session claim on the context, whatever a form sends", async () => {
    // A body naming an org or a role changes nothing: the input schema drops
    // everything, and the role comes from the context alone.
    await expect(
      startCheckout({ orgId: "someone-else", role: "admin" }),
    ).rejects.toThrow(REDIRECTED);

    expect(sessionParams().client_reference_id).toBe(ORG_ID);
  });
});

describe("the session an admin is sent to (AC-2)", () => {
  it("binds the session and the subscription to the internal org_id", async () => {
    await startCheckout({}).catch(() => undefined);

    expect(sessionParams()).toMatchObject({
      mode: "subscription",
      client_reference_id: ORG_ID,
      subscription_data: { metadata: { org_id: ORG_ID } },
    });
  });

  it("charges the one price from the environment, once", async () => {
    await startCheckout({}).catch(() => undefined);

    expect(sessionParams().line_items).toStrictEqual([
      { price: "price_monthly", quantity: 1 },
    ]);
  });

  it("brings the agency back to /billing whether it paid or changed its mind", async () => {
    await startCheckout({}).catch(() => undefined);

    expect(sessionParams()).toMatchObject({
      success_url: "https://app.example.test/billing",
      cancel_url: "https://app.example.test/billing",
    });
  });

  it("never hardcodes payment_method_types, so the dashboard decides", async () => {
    await startCheckout({}).catch(() => undefined);

    expect(sessionParams()).not.toHaveProperty("payment_method_types");
  });

  it("sets no trial here, because the trial lives on the Stripe Price", async () => {
    await startCheckout({}).catch(() => undefined);

    expect(sessionParams().subscription_data).not.toHaveProperty(
      "trial_period_days",
    );
  });

  it("redirects the browser to the URL Stripe returned", async () => {
    await expect(startCheckout({})).rejects.toThrow(REDIRECTED);

    expect(mocks.redirect).toHaveBeenCalledWith(CHECKOUT_URL);
  });
});

describe("an agency that already has a Stripe customer (AC-14)", () => {
  it("reuses the stored customer rather than letting Stripe create a second one", async () => {
    mocks.findFirst.mockResolvedValue({
      stripeCustomerId: "cus_existing",
      status: "canceled",
    });

    await startCheckout({}).catch(() => undefined);

    expect(sessionParams().customer).toBe("cus_existing");
  });

  it("sends no customer at all on a first subscription, so Stripe creates one", async () => {
    await startCheckout({}).catch(() => undefined);

    expect(sessionParams()).not.toHaveProperty("customer");
  });
});

describe("the idempotency key (AC-18)", () => {
  it("is passed to Stripe as a request option, not a session field", async () => {
    await startCheckout({}).catch(() => undefined);

    expect(sessionOptions().idempotencyKey).toEqual(expect.any(String));
    expect(sessionParams()).not.toHaveProperty("idempotencyKey");
  });

  it("is the same for two clicks a moment apart, so a double click is one session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T10:00:00.000Z"));

    try {
      await startCheckout({}).catch(() => undefined);
      vi.setSystemTime(new Date("2026-09-11T10:00:03.000Z"));
      await startCheckout({}).catch(() => undefined);
    } finally {
      vi.useRealTimers();
    }

    const [first, second] = mocks.sessionsCreate.mock.calls.map(
      ([, options]) => (options as { idempotencyKey: string }).idempotencyKey,
    );

    expect(first).toBe(second);
  });
});

describe("when Stripe cannot help", () => {
  it("returns unavailable, with a message that never repeats Stripe's own", async () => {
    mocks.sessionsCreate.mockRejectedValue(
      new Error("No such price: 'price_monthly' (sk_test_secret)"),
    );

    const result = await startCheckout({});

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("unavailable");
    expect(result.ok ? "" : result.error.message).not.toMatch(/price_monthly/);
    expect(result.ok ? "" : result.error.message).not.toMatch(/sk_test/);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("returns unavailable when Stripe answers with a session that has no URL", async () => {
    mocks.sessionsCreate.mockResolvedValue({ url: null });

    const result = await startCheckout({});

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("unavailable");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("returns unauthenticated when there is no session to act for", async () => {
    const { tenantResolutionError } = await import("@/db/tenant/errors");
    mocks.tenantContext.mockRejectedValue(tenantResolutionError("no_session"));

    const result = await startCheckout({});

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("unauthenticated");
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });
});
