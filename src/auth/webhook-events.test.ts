/**
 * covers: spec 0015 AC-16
 *
 * The two boundaries `src/auth/webhook.ts` parses instead of casting: the
 * identifier fields read off a verified event, and the three re read
 * results applied to the mirror. A shape Clerk stops sending must fail
 * loud here rather than write whatever happened to come back.
 */
import { describe, expect, it } from "vitest";

import {
  membershipEventData,
  membershipRoleRead,
  mirrorOrganizationRead,
  mirrorUserRead,
  organizationEventData,
  userEventData,
} from "./webhook-events";

describe("userEventData", () => {
  it("reads the id off a user event payload", () => {
    expect(userEventData.parse({ id: "user_1" })).toStrictEqual({
      id: "user_1",
    });
  });

  it("refuses a payload with no id", () => {
    expect(() => userEventData.parse({})).toThrow();
  });

  it("refuses a blank id", () => {
    expect(() => userEventData.parse({ id: "" })).toThrow();
  });
});

describe("organizationEventData", () => {
  it("reads the id off an organization event payload", () => {
    expect(organizationEventData.parse({ id: "org_1" })).toStrictEqual({
      id: "org_1",
    });
  });

  it("refuses a payload with no id", () => {
    expect(() => organizationEventData.parse({})).toThrow();
  });
});

describe("membershipEventData", () => {
  function payload(patch: Record<string, unknown> = {}) {
    return {
      organization: { id: "org_1" },
      public_user_data: { user_id: "user_1" },
      ...patch,
    };
  }

  it("reads the organization and user id off a membership event payload", () => {
    const parsed = membershipEventData.parse(payload());

    expect(parsed.organization.id).toBe("org_1");
    expect(parsed.public_user_data.user_id).toBe("user_1");
  });

  it("refuses a payload with no organization", () => {
    expect(() =>
      membershipEventData.parse(payload({ organization: undefined })),
    ).toThrow();
  });

  it("refuses a payload with no public_user_data", () => {
    expect(() =>
      membershipEventData.parse(payload({ public_user_data: undefined })),
    ).toThrow();
  });

  it("refuses a blank user id", () => {
    expect(() =>
      membershipEventData.parse(payload({ public_user_data: { user_id: "" } })),
    ).toThrow();
  });
});

describe("mirrorOrganizationRead", () => {
  it("reads the columns upsertOrganizationRow writes", () => {
    const parsed = mirrorOrganizationRead.parse({
      clerkOrgId: "org_1",
      name: "Agency One",
    });

    expect(parsed).toStrictEqual({ clerkOrgId: "org_1", name: "Agency One" });
  });

  it("refuses a re read with no name, rather than writing a blank one", () => {
    expect(() =>
      mirrorOrganizationRead.parse({ clerkOrgId: "org_1" }),
    ).toThrow();
  });

  it("refuses a re read missing the id Clerk gateway maps to clerkOrgId", () => {
    expect(() => mirrorOrganizationRead.parse({ id: "org_1" })).toThrow();
  });
});

describe("mirrorUserRead", () => {
  function read(patch: Record<string, unknown> = {}) {
    return {
      clerkUserId: "user_1",
      email: "person@example.com",
      name: undefined,
      imageUrl: undefined,
      ...patch,
    };
  }

  it("reads the columns ensureUserRow writes, name and imageUrl absent", () => {
    const parsed = mirrorUserRead.parse(read());

    expect(parsed).toStrictEqual({
      clerkUserId: "user_1",
      email: "person@example.com",
      name: undefined,
      imageUrl: undefined,
    });
  });

  it("reads name and imageUrl when Clerk has them", () => {
    const parsed = mirrorUserRead.parse(
      read({ name: "Ada", imageUrl: "https://example.com/a.png" }),
    );

    expect(parsed.name).toBe("Ada");
    expect(parsed.imageUrl).toBe("https://example.com/a.png");
  });

  it("refuses null for name or imageUrl: only undefined stands for absent", () => {
    expect(() => mirrorUserRead.parse(read({ name: null }))).toThrow();
    expect(() => mirrorUserRead.parse(read({ imageUrl: null }))).toThrow();
  });

  it("refuses a re read with no email", () => {
    expect(() => mirrorUserRead.parse(read({ email: undefined }))).toThrow();
  });
});

describe("membershipRoleRead", () => {
  it("reads the role the membership re read contributes", () => {
    expect(membershipRoleRead.parse({ role: "org:admin" })).toStrictEqual({
      role: "org:admin",
    });
  });

  it("refuses a re read with no role", () => {
    expect(() => membershipRoleRead.parse({})).toThrow();
  });

  it("refuses a blank role", () => {
    expect(() => membershipRoleRead.parse({ role: "" })).toThrow();
  });
});
