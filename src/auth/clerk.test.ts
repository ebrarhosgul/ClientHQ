/**
 * @vitest-environment node
 *
 * covers: spec 0005 AC-10, AC-12, AC-21
 *
 * The Clerk backend API, narrowed to what the mirror needs. Two things this
 * boundary is responsible for and nothing else covers: lowercasing the email
 * before it ever reaches the `users.email` CHECK, and telling a Clerk 404 (the
 * organization or the person is gone, so `not_found`) apart from every other
 * failure (a timeout, a bad secret key), which must propagate rather than be
 * mistaken for absence.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrganizationMembershipList: vi.fn(),
  getOrganization: vi.fn(),
  getUser: vi.fn(),
  createOrganization: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    users: {
      getOrganizationMembershipList: mocks.getOrganizationMembershipList,
      getUser: mocks.getUser,
    },
    organizations: {
      getOrganization: mocks.getOrganization,
      createOrganization: mocks.createOrganization,
    },
  }),
}));

const {
  agencyMemberships,
  clerkOrganization,
  clerkUser,
  createClerkOrganization,
} = await import("./clerk");

/** Clerk's own error shape: an `Error` carrying an HTTP `status`. */
function clerkError(status: number): Error {
  return Object.assign(new Error("clerk request failed"), { status });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("agencyMemberships", () => {
  it("maps Clerk's membership list onto the shape /onboarding needs", async () => {
    mocks.getOrganizationMembershipList.mockResolvedValue({
      data: [
        {
          organization: { id: "org_1", name: "Northwind" },
          role: "org:admin",
        },
      ],
    });

    await expect(agencyMemberships("user_1")).resolves.toEqual([
      { clerkOrgId: "org_1", name: "Northwind", clerkOrgRole: "org:admin" },
    ]);
  });

  it("asks for a page large enough that a truncated list cannot pick the wrong branch", async () => {
    mocks.getOrganizationMembershipList.mockResolvedValue({ data: [] });

    await agencyMemberships("user_1");

    expect(mocks.getOrganizationMembershipList).toHaveBeenCalledWith({
      userId: "user_1",
      limit: 100,
    });
  });
});

describe("clerkOrganization", () => {
  it("returns the organization Clerk has", async () => {
    mocks.getOrganization.mockResolvedValue({ id: "org_1", name: "Northwind" });

    await expect(clerkOrganization("org_1")).resolves.toEqual({
      ok: true,
      data: { clerkOrgId: "org_1", name: "Northwind" },
    });
  });

  it("reports a 404 as not_found rather than throwing (AC-21)", async () => {
    mocks.getOrganization.mockRejectedValue(clerkError(404));

    await expect(clerkOrganization("org_gone")).resolves.toEqual({
      ok: false,
      error: { code: "not_found", message: "That agency no longer exists." },
    });
  });

  it("lets every other Clerk failure propagate (AC-21)", async () => {
    const outage = clerkError(500);
    mocks.getOrganization.mockRejectedValue(outage);

    await expect(clerkOrganization("org_1")).rejects.toThrow(outage);
  });
});

describe("clerkUser", () => {
  const baseUser = {
    id: "user_1",
    primaryEmailAddressId: "email_1",
    emailAddresses: [{ id: "email_1", emailAddress: " Ada@Northwind.TEST " }],
    firstName: "Ada",
    lastName: "Lovelace",
    imageUrl: "https://img.clerk.test/ada",
  };

  it("lowercases and trims the primary email at the boundary (AC-12)", async () => {
    mocks.getUser.mockResolvedValue(baseUser);

    const result = await clerkUser("user_1");

    expect(result).toEqual({
      ok: true,
      data: {
        clerkUserId: "user_1",
        email: "ada@northwind.test",
        name: "Ada Lovelace",
        imageUrl: "https://img.clerk.test/ada",
      },
    });
  });

  it("falls back to the first email address when no primary is set", async () => {
    mocks.getUser.mockResolvedValue({
      ...baseUser,
      primaryEmailAddressId: "does-not-exist",
    });

    const result = await clerkUser("user_1");

    expect(result.ok && result.data.email).toBe("ada@northwind.test");
  });

  it("joins first and last name, and reports undefined when Clerk has neither", async () => {
    mocks.getUser.mockResolvedValue({
      ...baseUser,
      firstName: null,
      lastName: "  ",
    });

    const result = await clerkUser("user_1");

    expect(result.ok && result.data.name).toBeUndefined();
  });

  it("throws when Clerk has no email address to write, rather than writing an invalid row", async () => {
    mocks.getUser.mockResolvedValue({ ...baseUser, emailAddresses: [] });

    await expect(clerkUser("user_1")).rejects.toThrow(/no email address/);
  });

  it("reports a 404 as not_found (AC-21)", async () => {
    mocks.getUser.mockRejectedValue(clerkError(404));

    await expect(clerkUser("user_gone")).resolves.toEqual({
      ok: false,
      error: { code: "not_found", message: "That account no longer exists." },
    });
  });

  it("lets every other Clerk failure propagate (AC-21)", async () => {
    const outage = clerkError(503);
    mocks.getUser.mockRejectedValue(outage);

    await expect(clerkUser("user_1")).rejects.toThrow(outage);
  });
});

describe("createClerkOrganization", () => {
  it("creates the organization with the offered slug", async () => {
    mocks.createOrganization.mockResolvedValue({ id: "org_new" });

    const result = await createClerkOrganization({
      name: "Northwind",
      slug: "northwind",
      createdBy: "user_1",
    });

    expect(result).toEqual({ clerkOrgId: "org_new" });
    expect(mocks.createOrganization).toHaveBeenCalledWith({
      name: "Northwind",
      slug: "northwind",
      createdBy: "user_1",
    });
  });

  it("retries with no slug when Clerk's own namespace has already taken it (AC-10)", async () => {
    mocks.createOrganization
      .mockRejectedValueOnce(clerkError(422))
      .mockResolvedValueOnce({ id: "org_new" });

    const result = await createClerkOrganization({
      name: "Northwind",
      slug: "northwind",
      createdBy: "user_1",
    });

    expect(result).toEqual({ clerkOrgId: "org_new" });
    expect(mocks.createOrganization).toHaveBeenNthCalledWith(2, {
      name: "Northwind",
      slug: undefined,
      createdBy: "user_1",
    });
  });

  it("lets a failure that is not a rejected slug propagate", async () => {
    const outage = clerkError(500);
    mocks.createOrganization.mockRejectedValue(outage);

    await expect(
      createClerkOrganization({
        name: "Northwind",
        slug: "northwind",
        createdBy: "user_1",
      }),
    ).rejects.toThrow(outage);
    expect(mocks.createOrganization).toHaveBeenCalledTimes(1);
  });
});
