/**
 * @vitest-environment node
 *
 * covers: spec 0019 AC-12, AC-13
 *
 * `reportMembershipChange`'s own job is the branching by `kind`; the two
 * reads it delegates to are mocked, since they have their own tests in
 * `analytics-reads.db.test.ts` and `agency-group.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  identifyPerson: vi.fn(),
  identifyAgency: vi.fn(),
}));

vi.mock("@/analytics", () => ({
  analytics: () => ({ track: mocks.track }),
}));

vi.mock("@/analytics/agency-group", () => ({
  identifyPerson: mocks.identifyPerson,
  identifyAgency: mocks.identifyAgency,
}));

const { reportMembershipChange } = await import("./membership-analytics");

beforeEach(() => {
  vi.clearAllMocks();
});

const base = {
  orgId: "org_1",
  userId: "user_1",
  clerkUserId: "clerk_1",
} as const;

describe("reportMembershipChange", () => {
  it("on a real join: tracks team_member.joined and identifies both the person and the agency", async () => {
    const change = { ...base, kind: "joined", role: "member" } as const;

    await reportMembershipChange(change);

    expect(mocks.track).toHaveBeenCalledWith("team_member.joined", {
      distinctId: { kind: "user", clerkUserId: "clerk_1" },
      orgId: "org_1",
      properties: { role: "member" },
    });
    expect(mocks.identifyPerson).toHaveBeenCalledWith(change);
    expect(mocks.identifyAgency).toHaveBeenCalledWith("org_1");
  });

  it("on a bare role change: identifies the person and tracks no event, and does not re read team size", async () => {
    const change = { ...base, kind: "role", role: "admin" } as const;

    await reportMembershipChange(change);

    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.identifyPerson).toHaveBeenCalledWith(change);
    expect(mocks.identifyAgency).not.toHaveBeenCalled();
  });

  it("on a removal: re reads the agency's team_size and identifies no person", async () => {
    const change = { ...base, kind: "removed" } as const;

    await reportMembershipChange(change);

    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.identifyPerson).not.toHaveBeenCalled();
    expect(mocks.identifyAgency).toHaveBeenCalledWith("org_1");
  });
});
