/**
 * @vitest-environment node
 *
 * covers: spec 0015 AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-9, AC-10, AC-11, AC-13
 *
 * The four team actions against a stubbed Clerk boundary and a stubbed
 * mirror. `withTenantAction` itself (parsing, the admin guard, the gate, the
 * error mapping) is proven in `src/db/tenant/action.test.ts`; the fake
 * wrapper here reproduces just enough of it (parse, call the handler, map a
 * thrown `TenantActionError`) to isolate what each action adds: the target
 * resolution against the organization's own list, the last admin rule, the
 * duplicate check, the write through, the half done handling and the log
 * line. The wrapper records the config so the admin requirement and the
 * default gate are asserted too (AC-8).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  INVITATION_FIXTURES,
  MEMBER_FIXTURES,
  SOLO_ADMIN_FIXTURES,
} from "./ui/fixtures";

const state = vi.hoisted(() => ({
  configs: [] as Array<Record<string, unknown>>,
  clerk: {
    organizationMembers: vi.fn(),
    organizationPendingInvitations: vi.fn(),
    createOrganizationInvite: vi.fn(),
    revokeOrganizationInvite: vi.fn(),
    setOrganizationMemberRole: vi.fn(),
    removeOrganizationMember: vi.fn(),
  },
  mirror: {
    updateMirrorRole: vi.fn(),
    deleteMirrorMembership: vi.fn(),
  },
  info: vi.fn(),
  error: vi.fn(),
}));

const CTX = {
  kind: "staff",
  orgId: "local-org",
  clerkOrgId: "org_northwind",
  userId: "local-ada",
  clerkUserId: "user_ada",
  role: "admin",
} as const;

vi.mock("@/db/tenant", async (importActual) => {
  const actual = await importActual<typeof import("@/db/tenant")>();

  return {
    ...actual,
    withTenantAction: (config: {
      readonly input: { safeParse: (value: unknown) => never };
      readonly handler: (args: {
        readonly input: unknown;
        readonly ctx: unknown;
        readonly db: unknown;
      }) => Promise<unknown>;
    }) => {
      state.configs.push(config);

      return async (rawInput: unknown) => {
        const parsed = config.input.safeParse(rawInput) as
          | { success: true; data: unknown }
          | {
              success: false;
              error: { flatten: () => { fieldErrors: unknown } };
            };

        if (!parsed.success) {
          return {
            ok: false,
            error: {
              code: "validation",
              message: "Some of that is not right yet.",
              fieldErrors: parsed.error.flatten().fieldErrors,
            },
          };
        }

        try {
          const data = await config.handler({
            input: parsed.data,
            ctx: CTX,
            db: {},
          });

          return { ok: true, data };
        } catch (thrown) {
          if (actual.isTenantActionError(thrown)) {
            return { ok: false, error: thrown.error };
          }

          throw thrown;
        }
      };
    },
  };
});

vi.mock("@/auth/clerk", () => state.clerk);
vi.mock("./mirror", () => state.mirror);
vi.mock("@/lib/env", () => ({
  env: () => ({ NEXT_PUBLIC_APP_URL: "https://app.example" }),
}));

const { inviteTeamMember } = await import("./invite-team-member");
const { revokeTeamInvitation } = await import("./revoke-team-invitation");
const { changeTeamMemberRole } = await import("./change-team-member-role");
const { removeTeamMember } = await import("./remove-team-member");

/** Every log line this run wrote, parsed. */
function logged(): Array<Record<string, unknown>> {
  return [...state.info.mock.calls, ...state.error.mock.calls].map(
    ([line]) => JSON.parse(String(line)) as Record<string, unknown>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(state.info);
  vi.spyOn(console, "error").mockImplementation(state.error);

  state.clerk.organizationMembers.mockResolvedValue({
    ok: true,
    data: MEMBER_FIXTURES,
  });
  state.clerk.organizationPendingInvitations.mockResolvedValue({
    ok: true,
    data: INVITATION_FIXTURES,
  });
  state.clerk.createOrganizationInvite.mockResolvedValue({
    ok: true,
    data: { invitationId: "orginv_new" },
  });
  state.clerk.revokeOrganizationInvite.mockResolvedValue({ ok: true });
  state.clerk.setOrganizationMemberRole.mockResolvedValue({ ok: true });
  state.clerk.removeOrganizationMember.mockResolvedValue({ ok: true });
  state.mirror.updateMirrorRole.mockResolvedValue(undefined);
  state.mirror.deleteMirrorMembership.mockResolvedValue(undefined);
});

describe("every action is admin only with the default gate (AC-8)", () => {
  it("declares requireRole admin and no subscription opt out", () => {
    expect(state.configs).toHaveLength(4);

    for (const config of state.configs) {
      expect(config.requireRole).toBe("admin");
      expect(config.subscription).toBeUndefined();
      expect(config.revalidate).toStrictEqual({ paths: ["/team"] });
    }
  });
});

describe("inviteTeamMember (AC-2, AC-3)", () => {
  it("creates the invitation with the organization, the inviter, the role and the sign up redirect", async () => {
    const result = await inviteTeamMember({
      email: "  New@Northwind.example ",
      role: "admin",
    });

    expect(state.clerk.createOrganizationInvite).toHaveBeenCalledWith({
      clerkOrgId: "org_northwind",
      inviterClerkUserId: "user_ada",
      email: "new@northwind.example",
      role: "admin",
      redirectUrl: "https://app.example/sign-up",
    });
    expect(result).toStrictEqual({
      ok: true,
      data: { invitationId: "orginv_new" },
    });
    expect(logged()).toEqual([
      expect.objectContaining({
        event: "team.management",
        operation: "invite",
        outcome: "ok",
        orgId: "local-org",
        actorUserId: "local-ada",
        invitationId: "orginv_new",
        role: "admin",
      }),
    ]);
  });

  it("defaults the role to member", async () => {
    await inviteTeamMember({ email: "new@northwind.example" });

    expect(state.clerk.createOrganizationInvite.mock.calls[0][0]).toMatchObject(
      {
        role: "member",
      },
    );
  });

  it("refuses an address that is already a member, with no Clerk write", async () => {
    const result = await inviteTeamMember({ email: "GRACE@northwind.example" });

    expect(state.clerk.createOrganizationInvite).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "conflict",
        fieldErrors: { email: [expect.stringContaining("already a member")] },
      },
    });
    expect(logged()[0]).toMatchObject({ outcome: "already_member" });
  });

  it("refuses an address that already has a pending invitation", async () => {
    const result = await inviteTeamMember({ email: "alex@northwind.example" });

    expect(state.clerk.createOrganizationInvite).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "conflict",
        message: expect.stringContaining("Revoke it"),
      },
    });
    expect(logged()[0]).toMatchObject({ outcome: "already_invited" });
  });

  it("maps Clerk's own duplicate refusal (the race) to already invited", async () => {
    state.clerk.createOrganizationInvite.mockResolvedValue({
      ok: false,
      failure: "duplicate",
    });

    const result = await inviteTeamMember({ email: "new@northwind.example" });

    expect(result).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(logged()[0]).toMatchObject({ outcome: "already_invited" });
  });

  it("rejects a malformed address before anything is read", async () => {
    const result = await inviteTeamMember({ email: "not an email" });

    expect(result).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(state.clerk.organizationMembers).not.toHaveBeenCalled();
  });

  it("never logs the email address (AC-13)", async () => {
    await inviteTeamMember({ email: "secret@northwind.example" });
    await inviteTeamMember({ email: "grace@northwind.example" });

    for (const [line] of [
      ...state.info.mock.calls,
      ...state.error.mock.calls,
    ]) {
      expect(String(line)).not.toContain("@");
    }
  });
});

describe("Clerk failures come back as unavailable with the right message (AC-11)", () => {
  it("says nothing changed when the read failed", async () => {
    state.clerk.organizationMembers.mockResolvedValue({
      ok: false,
      failure: "unreachable",
    });

    const result = await removeTeamMember({ membershipId: "orgmem_3" });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "unavailable",
        message: expect.stringContaining("Nothing was changed"),
      },
    });
    expect(logged()[0]).toMatchObject({ outcome: "unavailable_read" });
  });

  it("says the change may have applied when the write failed", async () => {
    state.clerk.removeOrganizationMember.mockResolvedValue({
      ok: false,
      failure: "unreachable",
    });

    const result = await removeTeamMember({ membershipId: "orgmem_3" });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "unavailable",
        message: expect.stringContaining("may or may not have applied"),
      },
    });
    expect(logged()[0]).toMatchObject({ outcome: "unavailable_write" });
  });

  it("says busy on a rate limit", async () => {
    state.clerk.createOrganizationInvite.mockResolvedValue({
      ok: false,
      failure: "rate_limited",
    });

    const result = await inviteTeamMember({ email: "new@northwind.example" });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "unavailable", message: expect.stringContaining("busy") },
    });
    expect(logged()[0]).toMatchObject({ outcome: "unavailable_busy" });
  });
});

describe("revokeTeamInvitation (AC-4, AC-9)", () => {
  it("revokes an invitation from the organization's own pending list", async () => {
    const result = await revokeTeamInvitation({ invitationId: "orginv_1" });

    expect(state.clerk.revokeOrganizationInvite).toHaveBeenCalledWith({
      clerkOrgId: "org_northwind",
      invitationId: "orginv_1",
      requestingClerkUserId: "user_ada",
    });
    expect(result).toStrictEqual({ ok: true, data: undefined });
    expect(logged()[0]).toMatchObject({
      operation: "revoke",
      outcome: "ok",
      invitationId: "orginv_1",
    });
  });

  it("is not_found for an id outside that list, with no Clerk write", async () => {
    const result = await revokeTeamInvitation({
      invitationId: "orginv_elsewhere",
    });

    expect(state.clerk.revokeOrganizationInvite).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(logged()[0]).toMatchObject({ outcome: "not_found" });
  });
});

describe("changeTeamMemberRole (AC-5, AC-7, AC-10)", () => {
  it("writes Clerk first, then the mirror, with the Clerk user id from the list", async () => {
    const result = await changeTeamMemberRole({
      membershipId: "orgmem_3",
      role: "admin",
    });

    expect(state.clerk.setOrganizationMemberRole).toHaveBeenCalledWith({
      clerkOrgId: "org_northwind",
      clerkUserId: "user_grace",
      role: "admin",
    });
    expect(state.mirror.updateMirrorRole).toHaveBeenCalledWith(
      {},
      "user_grace",
      "admin",
    );
    expect(result).toStrictEqual({
      ok: true,
      data: { role: "admin", self: false },
    });
    expect(logged()[0]).toMatchObject({
      operation: "change_role",
      outcome: "ok",
      membershipId: "orgmem_3",
      targetClerkUserId: "user_grace",
      role: "admin",
    });
  });

  it("is a no op when the role is already what was asked", async () => {
    const result = await changeTeamMemberRole({
      membershipId: "orgmem_3",
      role: "member",
    });

    expect(state.clerk.setOrganizationMemberRole).not.toHaveBeenCalled();
    expect(state.mirror.updateMirrorRole).not.toHaveBeenCalled();
    expect(result).toStrictEqual({
      ok: true,
      data: { role: "member", self: false },
    });
  });

  it("is not_found for a membership id from another organization (AC-9)", async () => {
    const result = await changeTeamMemberRole({
      membershipId: "orgmem_other_org",
      role: "admin",
    });

    expect(state.clerk.setOrganizationMemberRole).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("refuses to demote the last admin, even themselves", async () => {
    state.clerk.organizationMembers.mockResolvedValue({
      ok: true,
      data: SOLO_ADMIN_FIXTURES,
    });

    const result = await changeTeamMemberRole({
      membershipId: "orgmem_1",
      role: "member",
    });

    expect(state.clerk.setOrganizationMemberRole).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "conflict",
        message: expect.stringContaining("last admin"),
      },
    });
    expect(logged()[0]).toMatchObject({ outcome: "last_admin" });
  });

  it("lets an admin demote themselves when another admin remains, and says so", async () => {
    const result = await changeTeamMemberRole({
      membershipId: "orgmem_1",
      role: "member",
    });

    expect(result).toStrictEqual({
      ok: true,
      data: { role: "member", self: true },
    });
  });

  it("still returns ok when the mirror write fails after Clerk succeeded, and logs at error level (AC-10)", async () => {
    state.mirror.updateMirrorRole.mockRejectedValue(new Error("pool is gone"));

    const result = await changeTeamMemberRole({
      membershipId: "orgmem_3",
      role: "admin",
    });

    expect(result).toStrictEqual({
      ok: true,
      data: { role: "admin", self: false },
    });
    expect(state.error).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(state.error.mock.calls[0][0]))).toMatchObject({
      level: "error",
      outcome: "mirror_failed",
      targetClerkUserId: "user_grace",
    });
  });
});

describe("removeTeamMember (AC-6, AC-7, AC-10)", () => {
  it("removes in Clerk, then deletes only the mirror membership", async () => {
    const result = await removeTeamMember({ membershipId: "orgmem_3" });

    expect(state.clerk.removeOrganizationMember).toHaveBeenCalledWith({
      clerkOrgId: "org_northwind",
      clerkUserId: "user_grace",
    });
    expect(state.mirror.deleteMirrorMembership).toHaveBeenCalledWith(
      {},
      "user_grace",
    );
    expect(result).toStrictEqual({ ok: true, data: { self: false } });
  });

  it("reports self when the admin removed themselves", async () => {
    const result = await removeTeamMember({ membershipId: "orgmem_1" });

    expect(result).toStrictEqual({ ok: true, data: { self: true } });
  });

  it("refuses to remove the last admin", async () => {
    state.clerk.organizationMembers.mockResolvedValue({
      ok: true,
      data: SOLO_ADMIN_FIXTURES,
    });

    const result = await removeTeamMember({ membershipId: "orgmem_1" });

    expect(state.clerk.removeOrganizationMember).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "conflict",
        message: expect.stringContaining("last admin"),
      },
    });
  });

  it("still returns ok when the mirror delete fails after Clerk succeeded (AC-10)", async () => {
    state.mirror.deleteMirrorMembership.mockRejectedValue(new Error("pool"));

    const result = await removeTeamMember({ membershipId: "orgmem_3" });

    expect(result).toStrictEqual({ ok: true, data: { self: false } });
    expect(state.error).toHaveBeenCalledTimes(1);
  });
});
