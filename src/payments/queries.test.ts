/**
 * @vitest-environment node
 *
 * covers: spec 0007 AC-17
 *
 * The one read behind `/billing` goes through the tenant scoping accessor and
 * nothing else. In particular it never constructs the Stripe client: a Stripe
 * outage must not take the billing page down with it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { subscriptions } from "@/db/schema";

const mocks = vi.hoisted(() => ({
  tenantDb: vi.fn(),
  findFirst: vi.fn(),
  stripeClient: vi.fn(),
}));

vi.mock("@/db/tenant", () => ({ tenantDb: mocks.tenantDb }));
vi.mock("./stripe", () => ({ stripeClient: mocks.stripeClient }));

const { subscriptionForAgency } = await import("./queries");

const CTX = {
  kind: "staff" as const,
  orgId: "00000000-0000-7000-8000-000000000002",
  clerkOrgId: "org_clerk",
  userId: "user-1",
  clerkUserId: "user_clerk",
  role: "member" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tenantDb.mockReturnValue({ findFirst: mocks.findFirst });
});

describe("subscriptionForAgency", () => {
  it("reads the subscriptions table through the accessor scoped to this context", async () => {
    const row = { id: "sub-row", orgId: CTX.orgId, status: "active" };
    mocks.findFirst.mockResolvedValue(row);

    const result = await subscriptionForAgency(CTX);

    expect(mocks.tenantDb).toHaveBeenCalledWith(CTX);
    expect(mocks.findFirst).toHaveBeenCalledWith(subscriptions);
    expect(result).toBe(row);
  });

  it("returns undefined for an agency that has never subscribed", async () => {
    mocks.findFirst.mockResolvedValue(undefined);

    await expect(subscriptionForAgency(CTX)).resolves.toBeUndefined();
  });

  it("makes no Stripe call at all (AC-17)", async () => {
    mocks.findFirst.mockResolvedValue(undefined);

    await subscriptionForAgency(CTX);

    expect(mocks.stripeClient).not.toHaveBeenCalled();
  });
});
