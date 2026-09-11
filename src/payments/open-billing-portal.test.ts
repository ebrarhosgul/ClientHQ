/**
 * @vitest-environment node
 *
 * covers: spec 0007 AC-6, AC-13
 *
 * Who may open the Billing Portal, which customer it opens for, and where it
 * sends the agency back to. Same shape as `start-checkout.test.ts`: the real
 * `withTenantAction` and the real admin guard, with the session, the accessor,
 * the environment and Stripe stubbed at their edges.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const REDIRECTED = "NEXT_REDIRECT";

const mocks = vi.hoisted(() => ({
  tenantContext: vi.fn(),
  findFirst: vi.fn(),
  portalCreate: vi.fn(),
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
  env: () => ({ NEXT_PUBLIC_APP_URL: "https://app.example.test" }),
}));

vi.mock("./stripe", () => ({
  stripeClient: () => ({
    billingPortal: { sessions: { create: mocks.portalCreate } },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(REDIRECTED);
  },
}));

const { openBillingPortal } = await import("./open-billing-portal");

const ORG_ID = "00000000-0000-7000-8000-000000000002";

const ADMIN = {
  kind: "staff" as const,
  orgId: ORG_ID,
  clerkOrgId: "org_clerk",
  userId: "user-1",
  clerkUserId: "user_clerk",
  role: "admin" as const,
};

const PORTAL_URL = "https://billing.stripe.com/p/session/test_123";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  mocks.tenantContext.mockResolvedValue(ADMIN);
  mocks.findFirst.mockResolvedValue({
    stripeCustomerId: "cus_existing",
    status: "active",
  });
  mocks.portalCreate.mockResolvedValue({ url: PORTAL_URL });
});

describe("who may open the portal (AC-13)", () => {
  it("refuses a member with forbidden before touching Stripe", async () => {
    mocks.tenantContext.mockResolvedValue({ ...ADMIN, role: "member" });

    const result = await openBillingPortal({});

    expect(result).toStrictEqual({
      ok: false,
      error: { code: "forbidden", message: expect.any(String) },
    });
    expect(mocks.portalCreate).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("ignores whatever the form sends and acts for the session's agency", async () => {
    await expect(
      openBillingPortal({ customer: "cus_someone_else" }),
    ).rejects.toThrow(REDIRECTED);

    expect(mocks.portalCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_existing" }),
    );
  });
});

describe("the portal session (AC-6)", () => {
  it("opens the agency's own Stripe customer and returns to /billing", async () => {
    await openBillingPortal({}).catch(() => undefined);

    expect(mocks.portalCreate).toHaveBeenCalledTimes(1);
    expect(mocks.portalCreate).toHaveBeenCalledWith({
      customer: "cus_existing",
      return_url: "https://app.example.test/billing",
    });
  });

  it("redirects the browser to the portal URL Stripe returned", async () => {
    await expect(openBillingPortal({})).rejects.toThrow(REDIRECTED);

    expect(mocks.redirect).toHaveBeenCalledWith(PORTAL_URL);
  });

  it("still opens for an agency that has cancelled, because its invoices are in there", async () => {
    mocks.findFirst.mockResolvedValue({
      stripeCustomerId: "cus_existing",
      status: "canceled",
    });

    await expect(openBillingPortal({})).rejects.toThrow(REDIRECTED);

    expect(mocks.portalCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_existing" }),
    );
  });
});

describe("when there is nothing to open", () => {
  it("returns not_found for an agency that has never subscribed, without calling Stripe", async () => {
    mocks.findFirst.mockResolvedValue(undefined);

    const result = await openBillingPortal({});

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("not_found");
    expect(mocks.portalCreate).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("returns unavailable when Stripe fails, and never repeats Stripe's message", async () => {
    mocks.portalCreate.mockRejectedValue(
      new Error("No such customer: 'cus_existing' (acct_123)"),
    );

    const result = await openBillingPortal({});

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("unavailable");
    expect(result.ok ? "" : result.error.message).not.toMatch(/cus_existing/);
    expect(result.ok ? "" : result.error.message).not.toMatch(/acct_/);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
