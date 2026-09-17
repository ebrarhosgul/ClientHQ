/**
 * @vitest-environment node
 *
 * covers: spec 0015 AC-1
 *
 * `loadTeam`: reads members for any staff, reads pending invitations only for
 * an admin, and surfaces whichever read fails first.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { INVITATION_FIXTURES, MEMBER_FIXTURES } from "./ui/fixtures";

const mocks = vi.hoisted(() => ({
  organizationMembers: vi.fn(),
  organizationPendingInvitations: vi.fn(),
}));

vi.mock("@/auth/clerk", () => ({
  organizationMembers: mocks.organizationMembers,
  organizationPendingInvitations: mocks.organizationPendingInvitations,
}));

const { loadTeam } = await import("./queries");

const ADMIN_CTX = {
  kind: "staff",
  orgId: "local-org",
  clerkOrgId: "org_northwind",
  userId: "local-ada",
  clerkUserId: "user_ada",
  role: "admin",
} as const;

const MEMBER_CTX = { ...ADMIN_CTX, role: "member" } as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadTeam", () => {
  it("reads both members and pending invitations for an admin", async () => {
    mocks.organizationMembers.mockResolvedValue({
      ok: true,
      data: MEMBER_FIXTURES,
    });
    mocks.organizationPendingInvitations.mockResolvedValue({
      ok: true,
      data: INVITATION_FIXTURES,
    });

    const result = await loadTeam(ADMIN_CTX);

    expect(mocks.organizationMembers).toHaveBeenCalledWith("org_northwind");
    expect(mocks.organizationPendingInvitations).toHaveBeenCalledWith(
      "org_northwind",
    );
    expect(result).toStrictEqual({
      ok: true,
      team: { members: MEMBER_FIXTURES, invitations: INVITATION_FIXTURES },
    });
  });

  it("reads only members for a member, and never asks for invitations", async () => {
    mocks.organizationMembers.mockResolvedValue({
      ok: true,
      data: MEMBER_FIXTURES,
    });

    const result = await loadTeam(MEMBER_CTX);

    expect(mocks.organizationPendingInvitations).not.toHaveBeenCalled();
    expect(result).toStrictEqual({
      ok: true,
      team: { members: MEMBER_FIXTURES, invitations: undefined },
    });
  });

  it("surfaces the members failure even when invitations would have succeeded", async () => {
    mocks.organizationMembers.mockResolvedValue({
      ok: false,
      failure: "unreachable",
    });
    mocks.organizationPendingInvitations.mockResolvedValue({
      ok: true,
      data: INVITATION_FIXTURES,
    });

    const result = await loadTeam(ADMIN_CTX);

    expect(result).toStrictEqual({ ok: false, failure: "unreachable" });
  });

  it("surfaces the invitations failure when only that read failed", async () => {
    mocks.organizationMembers.mockResolvedValue({
      ok: true,
      data: MEMBER_FIXTURES,
    });
    mocks.organizationPendingInvitations.mockResolvedValue({
      ok: false,
      failure: "rate_limited",
    });

    const result = await loadTeam(ADMIN_CTX);

    expect(result).toStrictEqual({ ok: false, failure: "rate_limited" });
  });
});
