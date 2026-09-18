/**
 * @vitest-environment node
 *
 * covers: spec 0005 AC-8, AC-9, AC-11
 *
 * `createAgency`, the one write this feature has. The Clerk half (memberships,
 * user lookup, organization creation) and the database half (`createAgencyRows`)
 * are both mocked, because both have their own tests: `src/auth/clerk.test.ts`
 * and `src/db/tenant/provisioning.db.test.ts`. What is under test here is the
 * sequencing and the error mapping: validation before anything else, the double
 * submit guard reading Clerk rather than the local table, and every Clerk or
 * database failure landing on a person as one honest "try again".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claims: { clerkUserId: "user_1" as string | undefined },
  agencyMemberships: vi.fn(),
  clerkUser: vi.fn(),
  createClerkOrganization: vi.fn(),
  createAgencyRows: vi.fn(),
  suggestedSlug: vi.fn(),
  deletedOrganizationClerkIds: vi.fn(),
  consume: vi.fn(),
}));

vi.mock("@/db/tenant/session", () => ({
  sessionClaims: async () => mocks.claims,
}));

vi.mock("@/db/tenant", async () => {
  const errors =
    await vi.importActual<typeof import("@/db/tenant/errors")>(
      "@/db/tenant/errors",
    );

  return {
    ...errors,
    createAgencyRows: mocks.createAgencyRows,
    suggestedSlug: mocks.suggestedSlug,
    deletedOrganizationClerkIds: mocks.deletedOrganizationClerkIds,
    consume: mocks.consume,
  };
});

vi.mock("./clerk", () => ({
  agencyMemberships: mocks.agencyMemberships,
  clerkUser: mocks.clerkUser,
  createClerkOrganization: mocks.createClerkOrganization,
}));

const { createAgency } = await import("./agency");

const USER = {
  clerkUserId: "user_1",
  email: "ada@northwind.test",
  name: "Ada",
  imageUrl: undefined,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claims = { clerkUserId: "user_1" };
  mocks.agencyMemberships.mockResolvedValue([]);
  mocks.deletedOrganizationClerkIds.mockResolvedValue(new Set());
  mocks.clerkUser.mockResolvedValue({ ok: true, data: USER });
  mocks.suggestedSlug.mockResolvedValue("northwind-studio");
  mocks.createClerkOrganization.mockResolvedValue({ clerkOrgId: "org_new" });
  mocks.createAgencyRows.mockResolvedValue({
    orgId: "local-org",
    userId: "local-user",
  });
  mocks.consume.mockResolvedValue({ allowed: true });
});

describe("createAgency", () => {
  it("rejects an empty name without touching Clerk (AC-8)", async () => {
    const result = await createAgency({ name: "   " });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "validation" },
    });
    expect(result.ok || result.error.fieldErrors?.name).toBeTruthy();
    expect(mocks.agencyMemberships).not.toHaveBeenCalled();
  });

  it("rejects a name over 100 characters (AC-8)", async () => {
    const result = await createAgency({ name: "a".repeat(101) });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("validation");
  });

  it("rejects a non object input the same way a bad form field would", async () => {
    const result = await createAgency({ name: 42 });

    expect(result.ok).toBe(false);
  });

  it("fails as unauthenticated when nobody is signed in", async () => {
    mocks.claims = { clerkUserId: undefined };

    const result = await createAgency({ name: "Northwind" });

    expect(result).toEqual({
      ok: false,
      error: { code: "unauthenticated", message: "" },
    });
  });

  it("activates the existing agency instead of creating a second one on a retry (AC-9)", async () => {
    mocks.agencyMemberships.mockResolvedValue([
      {
        clerkOrgId: "org_existing",
        name: "Northwind",
        clerkOrgRole: "org:admin",
      },
    ]);

    const result = await createAgency({ name: "Northwind" });

    expect(result).toEqual({
      ok: true,
      data: { clerkOrgId: "org_existing", alreadyExisted: true },
    });
    expect(mocks.clerkUser).not.toHaveBeenCalled();
    expect(mocks.createClerkOrganization).not.toHaveBeenCalled();
    expect(mocks.createAgencyRows).not.toHaveBeenCalled();
  });

  it("falls through to creating a new agency when the only membership is soft deleted locally (AC-9, AC-14)", async () => {
    mocks.agencyMemberships.mockResolvedValue([
      {
        clerkOrgId: "org_deleted",
        name: "Doomed Agency",
        clerkOrgRole: "org:admin",
      },
    ]);
    mocks.deletedOrganizationClerkIds.mockResolvedValue(
      new Set(["org_deleted"]),
    );

    const result = await createAgency({ name: "Northwind Studio" });

    expect(mocks.deletedOrganizationClerkIds).toHaveBeenCalledWith([
      "org_deleted",
    ]);
    expect(mocks.createClerkOrganization).toHaveBeenCalledWith({
      name: "Northwind Studio",
      slug: "northwind-studio",
      createdBy: "user_1",
    });
    expect(result).toEqual({
      ok: true,
      data: { clerkOrgId: "org_new", alreadyExisted: false },
    });
  });

  it("picks the surviving membership when only some of several are soft deleted locally (AC-9, AC-14)", async () => {
    mocks.agencyMemberships.mockResolvedValue([
      {
        clerkOrgId: "org_deleted",
        name: "Doomed Agency",
        clerkOrgRole: "org:admin",
      },
      {
        clerkOrgId: "org_kept",
        name: "Kept Agency",
        clerkOrgRole: "org:admin",
      },
    ]);
    mocks.deletedOrganizationClerkIds.mockResolvedValue(
      new Set(["org_deleted"]),
    );

    const result = await createAgency({ name: "Northwind Studio" });

    expect(mocks.deletedOrganizationClerkIds).toHaveBeenCalledWith([
      "org_deleted",
      "org_kept",
    ]);
    expect(mocks.createClerkOrganization).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      data: { clerkOrgId: "org_kept", alreadyExisted: true },
    });
  });

  it("falls through to creating a new agency when every membership is soft deleted locally (AC-9, AC-14)", async () => {
    mocks.agencyMemberships.mockResolvedValue([
      {
        clerkOrgId: "org_deleted_1",
        name: "Doomed Agency",
        clerkOrgRole: "org:admin",
      },
      {
        clerkOrgId: "org_deleted_2",
        name: "Also Doomed Agency",
        clerkOrgRole: "org:admin",
      },
    ]);
    mocks.deletedOrganizationClerkIds.mockResolvedValue(
      new Set(["org_deleted_1", "org_deleted_2"]),
    );

    const result = await createAgency({ name: "Northwind Studio" });

    expect(mocks.createClerkOrganization).toHaveBeenCalledWith({
      name: "Northwind Studio",
      slug: "northwind-studio",
      createdBy: "user_1",
    });
    expect(result).toEqual({
      ok: true,
      data: { clerkOrgId: "org_new", alreadyExisted: false },
    });
  });

  it("creates the Clerk organization and the local rows on the normal path (AC-9)", async () => {
    const result = await createAgency({ name: "Northwind Studio" });

    expect(mocks.suggestedSlug).toHaveBeenCalledWith("Northwind Studio");
    expect(mocks.createClerkOrganization).toHaveBeenCalledWith({
      name: "Northwind Studio",
      slug: "northwind-studio",
      createdBy: "user_1",
    });
    expect(mocks.createAgencyRows).toHaveBeenCalledWith(
      { clerkOrgId: "org_new", name: "Northwind Studio" },
      USER,
    );
    expect(result).toEqual({
      ok: true,
      data: { clerkOrgId: "org_new", alreadyExisted: false },
    });
  });

  it("consumes the create_agency allowance for this person, right before Clerk creates the organization (spec 0018, AC-6)", async () => {
    await createAgency({ name: "Northwind Studio" });

    expect(mocks.consume).toHaveBeenCalledWith(
      { kind: "user", id: "user_1" },
      { action: "create_agency", limit: 3, windowSeconds: 86400 },
      expect.any(Date),
    );
    expect(mocks.consume.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createClerkOrganization.mock.invocationCallOrder[0],
    );
  });

  it("refuses before Clerk creates anything once the ceiling is reached (spec 0018, AC-6)", async () => {
    mocks.consume.mockResolvedValue({
      allowed: false,
      message:
        "You have reached the allowance of 3 new agencies a day. Try again in about 4 hours.",
    });

    const result = await createAgency({ name: "Northwind Studio" });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "rate_limited",
        message:
          "You have reached the allowance of 3 new agencies a day. Try again in about 4 hours.",
      },
    });
    expect(mocks.createClerkOrganization).not.toHaveBeenCalled();
    expect(mocks.createAgencyRows).not.toHaveBeenCalled();
  });

  it("a double submit that resolves to an existing agency consumes no allowance (spec 0018, AC-6)", async () => {
    mocks.agencyMemberships.mockResolvedValue([
      {
        clerkOrgId: "org_existing",
        name: "Northwind",
        clerkOrgRole: "org:admin",
      },
    ]);

    await createAgency({ name: "Northwind" });

    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it("fails as unauthenticated when the Clerk user is gone", async () => {
    mocks.clerkUser.mockResolvedValue({
      ok: false,
      error: { code: "not_found", message: "gone" },
    });

    const result = await createAgency({ name: "Northwind" });

    expect(result).toEqual({
      ok: false,
      error: { code: "unauthenticated", message: "" },
    });
    expect(mocks.createClerkOrganization).not.toHaveBeenCalled();
  });

  it("turns a Clerk outage into one honest try again (AC-11)", async () => {
    mocks.agencyMemberships.mockRejectedValue(new Error("clerk timed out"));

    const result = await createAgency({ name: "Northwind" });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "unavailable",
        message:
          "We could not reach the accounts service. Try again in a moment.",
      },
    });
  });

  it("reports a slug collision as a conflict, distinct from every other write failure (AC-10, AC-11)", async () => {
    const collision = Object.assign(new Error("duplicate key"), {
      code: "23505",
    });
    mocks.createAgencyRows.mockRejectedValue(collision);

    const result = await createAgency({ name: "Northwind" });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("conflict");
    expect(!result.ok && result.error.message).toMatch(
      /pick up where it left off/,
    );
  });

  it("reports any other write failure as unavailable, with the same retry message (AC-11)", async () => {
    mocks.createAgencyRows.mockRejectedValue(new Error("connection reset"));

    const result = await createAgency({ name: "Northwind" });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("unavailable");
    expect(!result.ok && result.error.message).toMatch(
      /pick up where it left off/,
    );
  });
});
