/**
 * @vitest-environment node
 *
 * covers: spec 0005 AC-12, AC-21 · spec 0015 AC-12
 *
 * Where each of the repair's outcomes ends up.
 *
 * The database half of this lives in `src/db/tenant/provisioning.db.test.ts`,
 * which proves the rows actually land. This half is about routing, and about the
 * distinction AC-21 turns on: a Clerk 404 means the organization is gone and the
 * person belongs on `/onboarding`, while any other Clerk failure is not evidence
 * of anything and has to propagate. Getting that backwards would quietly sign
 * people out of agencies that are perfectly fine every time Clerk had a bad
 * minute.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { tenantResolutionError } from "@/db/tenant/errors";

const REDIRECTED = "NEXT_REDIRECT";

const mocks = vi.hoisted(() => ({
  staffContext: vi.fn(),
  resolveStaffContext: vi.fn(),
  ensureMirrorRows: vi.fn(),
  contactContext: vi.fn(),
  agencyProfile: vi.fn(),
  clerkOrganization: vi.fn(),
  clerkUser: vi.fn(),
  agencyMemberships: vi.fn(),
  claims: {
    clerkUserId: "user_1" as string | undefined,
    clerkOrgId: "org_1" as string | undefined,
    clerkOrgRole: "org:admin" as string | undefined,
  },
  redirected: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    mocks.redirected.push(path);
    throw new Error(REDIRECTED);
  },
}));

vi.mock("@/db/tenant/session", () => ({
  sessionClaims: async () => mocks.claims,
}));

vi.mock("@/db/tenant/context", () => ({
  resolveStaffContext: mocks.resolveStaffContext,
}));

vi.mock("@/db/tenant", async () => {
  const errors =
    await vi.importActual<typeof import("@/db/tenant/errors")>(
      "@/db/tenant/errors",
    );

  return {
    ...errors,
    staffContext: mocks.staffContext,
    contactContext: mocks.contactContext,
    ensureMirrorRows: mocks.ensureMirrorRows,
    agencyProfile: mocks.agencyProfile,
    toMembershipRole: (role: string | undefined) =>
      role === "org:admin" ? "admin" : "member",
  };
});

vi.mock("./clerk", () => ({
  clerkOrganization: mocks.clerkOrganization,
  clerkUser: mocks.clerkUser,
  agencyMemberships: mocks.agencyMemberships,
}));

const { agencyContext, isClientContact } = await import("./context");

const STAFF = {
  kind: "staff",
  orgId: "local-org",
  clerkOrgId: "org_1",
  userId: "local-user",
  clerkUserId: "user_1",
  role: "admin",
} as const;

const missingMirror = () => tenantResolutionError("no_mirror_row");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirected.length = 0;
  mocks.claims = {
    clerkUserId: "user_1",
    clerkOrgId: "org_1",
    clerkOrgRole: "org:admin",
  };
  mocks.clerkOrganization.mockResolvedValue({
    ok: true,
    data: { clerkOrgId: "org_1", name: "Northwind" },
  });
  mocks.clerkUser.mockResolvedValue({
    ok: true,
    data: {
      clerkUserId: "user_1",
      email: "ada@northwind.test",
      name: "Ada",
      imageUrl: undefined,
    },
  });
  mocks.agencyMemberships.mockResolvedValue([
    { clerkOrgId: "org_1", name: "Northwind", clerkOrgRole: "org:admin" },
  ]);
  mocks.ensureMirrorRows.mockResolvedValue({
    orgId: "local-org",
    userId: "local-user",
  });
});

describe("agencyContext", () => {
  it("costs one resolution and no writes on the normal path (AC-12)", async () => {
    mocks.staffContext.mockResolvedValue(STAFF);

    await expect(agencyContext()).resolves.toEqual(STAFF);

    expect(mocks.staffContext).toHaveBeenCalledTimes(1);
    expect(mocks.resolveStaffContext).not.toHaveBeenCalled();
    expect(mocks.ensureMirrorRows).not.toHaveBeenCalled();
    expect(mocks.clerkOrganization).not.toHaveBeenCalled();
  });

  it("repairs the mirror and resolves again, with no redirect (AC-12)", async () => {
    mocks.staffContext.mockRejectedValue(missingMirror());
    mocks.resolveStaffContext.mockResolvedValue(STAFF);

    await expect(agencyContext()).resolves.toEqual(STAFF);

    expect(mocks.ensureMirrorRows).toHaveBeenCalledTimes(1);
    expect(mocks.redirected).toEqual([]);
  });

  it("takes the membership role from Clerk's membership, not the session claim (spec 0015, AC-12)", async () => {
    // A stale token still says admin; Clerk says member. Clerk wins.
    mocks.claims = { ...mocks.claims, clerkOrgRole: "org:admin" };
    mocks.agencyMemberships.mockResolvedValue([
      { clerkOrgId: "org_1", name: "Northwind", clerkOrgRole: "org:member" },
    ]);
    mocks.staffContext.mockRejectedValue(missingMirror());
    mocks.resolveStaffContext.mockResolvedValue({ ...STAFF, role: "member" });

    await agencyContext();

    expect(mocks.ensureMirrorRows).toHaveBeenCalledWith(
      { clerkOrgId: "org_1", name: "Northwind" },
      expect.objectContaining({ email: "ada@northwind.test" }),
      "member",
    );
    expect(mocks.clerkOrganization).toHaveBeenCalledTimes(1);
    expect(mocks.clerkUser).toHaveBeenCalledTimes(1);
    expect(mocks.agencyMemberships).toHaveBeenCalledWith("user_1");
  });

  it("sends a removed person to /onboarding without recreating their membership (spec 0015, AC-12)", async () => {
    // The token still names org_1, but Clerk no longer lists a membership
    // for it: the person was removed in the last minute.
    mocks.agencyMemberships.mockResolvedValue([
      {
        clerkOrgId: "org_other",
        name: "Elsewhere",
        clerkOrgRole: "org:member",
      },
    ]);
    mocks.staffContext.mockRejectedValue(missingMirror());

    await expect(agencyContext()).rejects.toThrow(REDIRECTED);

    expect(mocks.redirected).toEqual(["/onboarding"]);
    expect(mocks.ensureMirrorRows).not.toHaveBeenCalled();
  });

  it.each([
    ["the organization", "clerkOrganization" as const],
    ["the user", "clerkUser" as const],
  ])(
    "sends a person to /onboarding when Clerk 404s on %s (AC-21)",
    async (_label, which) => {
      mocks.staffContext.mockRejectedValue(missingMirror());
      mocks[which].mockResolvedValue({
        ok: false,
        error: { code: "not_found", message: "gone" },
      });

      await expect(agencyContext()).rejects.toThrow(REDIRECTED);

      expect(mocks.redirected).toEqual(["/onboarding"]);
      // Nothing was written for an organization that no longer exists.
      expect(mocks.ensureMirrorRows).not.toHaveBeenCalled();
    },
  );

  it("propagates any other Clerk failure rather than mistaking it for absence (AC-21)", async () => {
    const outage = new Error("clerk is having a bad minute");

    mocks.staffContext.mockRejectedValue(missingMirror());
    mocks.clerkOrganization.mockRejectedValue(outage);

    await expect(agencyContext()).rejects.toThrow(outage);

    expect(mocks.redirected).toEqual([]);
    expect(mocks.ensureMirrorRows).not.toHaveBeenCalled();
  });

  it("sends a person to /onboarding when the repair did not take (AC-14)", async () => {
    // What a locally soft deleted organization looks like from here: the rows
    // are written, and resolution still refuses them.
    mocks.staffContext.mockRejectedValue(missingMirror());
    mocks.resolveStaffContext.mockRejectedValue(missingMirror());

    await expect(agencyContext()).rejects.toThrow(REDIRECTED);

    expect(mocks.ensureMirrorRows).toHaveBeenCalledTimes(1);
    expect(mocks.redirected).toEqual(["/onboarding"]);
  });

  it("does not try to repair a failure a repair cannot fix", async () => {
    const noSession = tenantResolutionError("no_session");

    mocks.staffContext.mockRejectedValue(noSession);

    await expect(agencyContext()).rejects.toThrow(noSession);

    expect(mocks.ensureMirrorRows).not.toHaveBeenCalled();
  });
});

describe("isClientContact", () => {
  it("is true when a contact context resolves", async () => {
    mocks.contactContext.mockResolvedValue({ kind: "contact" });

    await expect(isClientContact()).resolves.toBe(true);
  });

  it.each(["no_contact", "no_mirror_row"] as const)(
    "is false on %s, because both mean not a contact",
    async (kind) => {
      mocks.contactContext.mockRejectedValue(tenantResolutionError(kind));

      await expect(isClientContact()).resolves.toBe(false);
    },
  );

  it("lets an unexpected failure through rather than answering false", async () => {
    const boom = new Error("the database fell over");

    mocks.contactContext.mockRejectedValue(boom);

    await expect(isClientContact()).rejects.toThrow(boom);
  });
});
