/**
 * @vitest-environment node
 *
 * covers: spec 0015 AC-1, AC-2, AC-3, AC-11
 *
 * The Clerk boundary for team management, in `src/auth/clerk.ts`: the lists
 * page to the total count and come back newest first with the email
 * lowercased; a 404, a 429 and everything else are told apart; and the
 * invitation call reads a 400 or 422 as Clerk's duplicate refusal.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrganizationMembershipList: vi.fn(),
  getOrganizationInvitationList: vi.fn(),
  createOrganizationInvitation: vi.fn(),
  revokeOrganizationInvitation: vi.fn(),
  updateOrganizationMembership: vi.fn(),
  deleteOrganizationMembership: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    users: {},
    organizations: mocks,
  }),
}));

const {
  createOrganizationInvite,
  organizationMembers,
  organizationPendingInvitations,
  removeOrganizationMember,
  revokeOrganizationInvite,
  setOrganizationMemberRole,
} = await import("@/auth/clerk");

function clerkError(status: number): Error {
  return Object.assign(new Error("clerk request failed"), { status });
}

function membership(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    role: "org:member",
    createdAt: 1_700_000_000_000,
    publicUserData: {
      userId: `user_${id}`,
      identifier: ` ${id.toUpperCase()}@Northwind.example `,
      firstName: null,
      lastName: null,
      imageUrl: "https://img.example/x",
      hasImage: false,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("organizationMembers (AC-1)", () => {
  it("pages to Clerk's total count and maps each row", async () => {
    mocks.getOrganizationMembershipList
      .mockResolvedValueOnce({ data: [membership("a")], totalCount: 2 })
      .mockResolvedValueOnce({
        data: [
          membership("b", {
            role: "org:admin",
            publicUserData: {
              userId: "user_b",
              identifier: "b@northwind.example",
              firstName: "Bea",
              lastName: "Long",
              imageUrl: "https://img.example/b",
              hasImage: true,
            },
          }),
        ],
        totalCount: 2,
      });

    const result = await organizationMembers("org_1");

    expect(mocks.getOrganizationMembershipList).toHaveBeenCalledTimes(2);
    expect(mocks.getOrganizationMembershipList.mock.calls[1][0]).toMatchObject({
      organizationId: "org_1",
      offset: 1,
      orderBy: "-created_at",
    });
    expect(result).toStrictEqual({
      ok: true,
      data: [
        {
          membershipId: "a",
          clerkUserId: "user_a",
          name: "a@northwind.example",
          email: "a@northwind.example",
          imageUrl: undefined,
          role: "member",
          joinedAt: new Date(1_700_000_000_000),
        },
        {
          membershipId: "b",
          clerkUserId: "user_b",
          name: "Bea Long",
          email: "b@northwind.example",
          imageUrl: "https://img.example/b",
          role: "admin",
          joinedAt: new Date(1_700_000_000_000),
        },
      ],
    });
  });

  it("skips a membership whose user record is gone", async () => {
    mocks.getOrganizationMembershipList.mockResolvedValue({
      data: [membership("a", { publicUserData: null }), membership("b")],
      totalCount: 2,
    });

    const result = await organizationMembers("org_1");

    expect(result.ok && result.data.map((m) => m.membershipId)).toEqual(["b"]);
  });

  it.each([
    [404, "not_found"],
    [429, "rate_limited"],
    [503, "unreachable"],
  ])("maps a Clerk %s to %s (AC-11)", async (status, failure) => {
    mocks.getOrganizationMembershipList.mockRejectedValue(clerkError(status));

    await expect(organizationMembers("org_1")).resolves.toStrictEqual({
      ok: false,
      failure,
    });
  });

  it("treats a failure with no status as unreachable", async () => {
    mocks.getOrganizationMembershipList.mockRejectedValue(
      new Error("ECONNRESET"),
    );

    await expect(organizationMembers("org_1")).resolves.toStrictEqual({
      ok: false,
      failure: "unreachable",
    });
  });
});

describe("organizationPendingInvitations (AC-1)", () => {
  it("asks for pending only and returns them newest first, lowercased", async () => {
    mocks.getOrganizationInvitationList.mockResolvedValue({
      data: [
        {
          id: "inv_old",
          emailAddress: "Old@X.example",
          role: "org:member",
          createdAt: 1,
        },
        {
          id: "inv_new",
          emailAddress: "new@x.example",
          role: "org:admin",
          createdAt: 2,
        },
      ],
      totalCount: 2,
    });

    const result = await organizationPendingInvitations("org_1");

    expect(mocks.getOrganizationInvitationList.mock.calls[0][0]).toMatchObject({
      organizationId: "org_1",
      status: ["pending"],
    });
    expect(result).toStrictEqual({
      ok: true,
      data: [
        {
          invitationId: "inv_new",
          email: "new@x.example",
          role: "admin",
          sentAt: new Date(2),
        },
        {
          invitationId: "inv_old",
          email: "old@x.example",
          role: "member",
          sentAt: new Date(1),
        },
      ],
    });
  });
});

describe("createOrganizationInvite (AC-2, AC-3)", () => {
  it("sends the mapped role, the inviter and the redirect", async () => {
    mocks.createOrganizationInvitation.mockResolvedValue({ id: "inv_1" });

    const result = await createOrganizationInvite({
      clerkOrgId: "org_1",
      inviterClerkUserId: "user_ada",
      email: "alex@northwind.example",
      role: "admin",
      redirectUrl: "https://app.example/sign-up",
    });

    expect(mocks.createOrganizationInvitation).toHaveBeenCalledWith({
      organizationId: "org_1",
      inviterUserId: "user_ada",
      emailAddress: "alex@northwind.example",
      role: "org:admin",
      redirectUrl: "https://app.example/sign-up",
    });
    expect(result).toStrictEqual({ ok: true, data: { invitationId: "inv_1" } });
  });

  it.each([400, 422])(
    "reads a %s as Clerk's duplicate refusal",
    async (status) => {
      mocks.createOrganizationInvitation.mockRejectedValue(clerkError(status));

      await expect(
        createOrganizationInvite({
          clerkOrgId: "org_1",
          inviterClerkUserId: "user_ada",
          email: "alex@northwind.example",
          role: "member",
          redirectUrl: "https://app.example/sign-up",
        }),
      ).resolves.toStrictEqual({ ok: false, failure: "duplicate" });
    },
  );

  it("still tells a 429 apart", async () => {
    mocks.createOrganizationInvitation.mockRejectedValue(clerkError(429));

    await expect(
      createOrganizationInvite({
        clerkOrgId: "org_1",
        inviterClerkUserId: "user_ada",
        email: "alex@northwind.example",
        role: "member",
        redirectUrl: "https://app.example/sign-up",
      }),
    ).resolves.toStrictEqual({ ok: false, failure: "rate_limited" });
  });
});

describe("the write calls carry the organization and the Clerk user id (AC-9)", () => {
  it("revokes by organization, invitation and requesting user", async () => {
    mocks.revokeOrganizationInvitation.mockResolvedValue({});

    await revokeOrganizationInvite({
      clerkOrgId: "org_1",
      invitationId: "inv_1",
      requestingClerkUserId: "user_ada",
    });

    expect(mocks.revokeOrganizationInvitation).toHaveBeenCalledWith({
      organizationId: "org_1",
      invitationId: "inv_1",
      requestingUserId: "user_ada",
    });
  });

  it("updates and deletes by organization and user id, with the mapped role", async () => {
    mocks.updateOrganizationMembership.mockResolvedValue({});
    mocks.deleteOrganizationMembership.mockResolvedValue({});

    await setOrganizationMemberRole({
      clerkOrgId: "org_1",
      clerkUserId: "user_b",
      role: "member",
    });
    await removeOrganizationMember({
      clerkOrgId: "org_1",
      clerkUserId: "user_b",
    });

    expect(mocks.updateOrganizationMembership).toHaveBeenCalledWith({
      organizationId: "org_1",
      userId: "user_b",
      role: "org:member",
    });
    expect(mocks.deleteOrganizationMembership).toHaveBeenCalledWith({
      organizationId: "org_1",
      userId: "user_b",
    });
  });
});
