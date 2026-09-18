/**
 * @vitest-environment node
 *
 * covers: spec 0019 AC-13
 *
 * `./client` and `@/db/tenant` are both mocked: the client has its own tests
 * in `client.test.ts`, and the two reads have theirs in
 * `src/db/tenant/analytics-reads.db.test.ts`. What is under test here is the
 * shaping in between: which override wins, which fields become ISO strings,
 * and that a disabled client or an absent row sends nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: true,
  identify: vi.fn(),
  groupIdentify: vi.fn(),
  agencyAnalyticsSnapshot: vi.fn(),
  personCreatedAt: vi.fn(),
}));

vi.mock("./client", () => ({
  analytics: () => ({
    enabled: mocks.enabled,
    identify: mocks.identify,
    groupIdentify: mocks.groupIdentify,
  }),
}));

vi.mock("@/db/tenant", () => ({
  agencyAnalyticsSnapshot: mocks.agencyAnalyticsSnapshot,
  personCreatedAt: mocks.personCreatedAt,
}));

const { agencyGroupProperties, identifyAgency, identifyPerson } =
  await import("./agency-group");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
});

describe("agencyGroupProperties", () => {
  it("is undefined when analytics is off, without reading the database", async () => {
    mocks.enabled = false;

    const result = await agencyGroupProperties("org_1");

    expect(result).toBeUndefined();
    expect(mocks.agencyAnalyticsSnapshot).not.toHaveBeenCalled();
  });

  it("is undefined for an organization the mirror does not hold", async () => {
    mocks.agencyAnalyticsSnapshot.mockResolvedValue(undefined);

    expect(await agencyGroupProperties("org_1")).toBeUndefined();
  });

  it("reads the subscription status and team size off the snapshot", async () => {
    mocks.agencyAnalyticsSnapshot.mockResolvedValue({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      subscriptionStatus: "active",
      teamSize: 3,
    });

    const result = await agencyGroupProperties("org_1");

    expect(result).toEqual({
      subscription_status: "active",
      trial_ends_at: undefined,
      subscribed_at: undefined,
      created_at: "2026-01-01T00:00:00.000Z",
      team_size: 3,
    });
  });

  it("prefers the Stripe subscription in memory over the mirrored row", async () => {
    mocks.agencyAnalyticsSnapshot.mockResolvedValue({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      subscriptionStatus: "active",
      teamSize: 1,
    });

    const result = await agencyGroupProperties("org_1", {
      subscription: { status: "past_due", trial_end: null },
    });

    expect(result?.subscription_status).toBe("past_due");
    expect(result?.trial_ends_at).toBeUndefined();
  });

  it("carries the trial end and subscribed at through as ISO strings", async () => {
    mocks.agencyAnalyticsSnapshot.mockResolvedValue({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      subscriptionStatus: "trialing",
      teamSize: 1,
    });

    const trialEnd = new Date("2026-02-01T00:00:00.000Z");
    const subscribedAt = new Date("2026-01-15T00:00:00.000Z");

    const result = await agencyGroupProperties("org_1", {
      subscription: { status: "trialing", trial_end: trialEnd },
      subscribedAt,
    });

    expect(result?.trial_ends_at).toBe(trialEnd.toISOString());
    expect(result?.subscribed_at).toBe(subscribedAt.toISOString());
  });
});

describe("identifyAgency", () => {
  it("sends the group properties it read", async () => {
    mocks.agencyAnalyticsSnapshot.mockResolvedValue({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      subscriptionStatus: "active",
      teamSize: 2,
    });

    await identifyAgency("org_1");

    expect(mocks.groupIdentify).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({ subscription_status: "active", team_size: 2 }),
    );
  });

  it("sends nothing for an organization the mirror does not hold", async () => {
    mocks.agencyAnalyticsSnapshot.mockResolvedValue(undefined);

    await identifyAgency("org_1");

    expect(mocks.groupIdentify).not.toHaveBeenCalled();
  });
});

describe("identifyPerson", () => {
  const person = {
    clerkUserId: "clerk_1",
    userId: "user_1",
    role: "admin" as const,
  };

  it("is a no op when analytics is off", async () => {
    mocks.enabled = false;

    await identifyPerson(person);

    expect(mocks.personCreatedAt).not.toHaveBeenCalled();
    expect(mocks.identify).not.toHaveBeenCalled();
  });

  it("sends the person's role and when they joined", async () => {
    mocks.personCreatedAt.mockResolvedValue(
      new Date("2026-01-02T00:00:00.000Z"),
    );

    await identifyPerson(person);

    expect(mocks.identify).toHaveBeenCalledWith("clerk_1", {
      role: "admin",
      created_at: "2026-01-02T00:00:00.000Z",
    });
  });

  it("sends nothing for a person the mirror does not hold", async () => {
    mocks.personCreatedAt.mockResolvedValue(undefined);

    await identifyPerson(person);

    expect(mocks.identify).not.toHaveBeenCalled();
  });
});
