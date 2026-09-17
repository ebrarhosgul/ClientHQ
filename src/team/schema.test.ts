/**
 * @vitest-environment node
 *
 * covers: spec 0015 AC-2, AC-4, AC-5, AC-6
 *
 * Zod at the team action boundary: the email is trimmed and lowercased once,
 * the three email messages, the role enum, and the id schemas the revoke,
 * change role and remove actions parse against.
 */
import { describe, expect, it } from "vitest";

import {
  changeRoleInput,
  invitationIdInput,
  inviteInput,
  membershipIdInput,
  roleInput,
} from "./schema";

describe("inviteInput (AC-2)", () => {
  it("trims and lowercases the email, defaulting the role to member", () => {
    const result = inviteInput.safeParse({
      email: "  Alex@Northwind.Example  ",
    });

    expect(result.success).toBe(true);
    expect(result.data).toStrictEqual({
      email: "alex@northwind.example",
      role: "member",
    });
  });

  it("keeps an explicit admin role", () => {
    const result = inviteInput.safeParse({
      email: "sam@northwind.example",
      role: "admin",
    });

    expect(result.success).toBe(true);
    expect(result.data?.role).toBe("admin");
  });

  it("rejects an empty address with its own message", () => {
    const result = inviteInput.safeParse({ email: "" });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.email).toContain(
      "Enter an email address.",
    );
  });

  it("rejects an address over 254 characters with its own message", () => {
    const tooLong = `${"a".repeat(250)}@a.co`;

    const result = inviteInput.safeParse({ email: tooLong });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.email).toContain(
      "That email address is too long.",
    );
  });

  it("rejects a malformed address with its own message", () => {
    const result = inviteInput.safeParse({ email: "not-an-address" });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.email).toContain(
      "Enter a valid email address.",
    );
  });

  it("rejects a role outside the two the product knows", () => {
    const result = inviteInput.safeParse({
      email: "sam@northwind.example",
      role: "owner",
    });

    expect(result.success).toBe(false);
  });
});

describe("roleInput", () => {
  it("accepts admin and member", () => {
    expect(roleInput.safeParse("admin").success).toBe(true);
    expect(roleInput.safeParse("member").success).toBe(true);
  });

  it("rejects anything else", () => {
    expect(roleInput.safeParse("superadmin").success).toBe(false);
    expect(roleInput.safeParse("").success).toBe(false);
  });
});

describe("invitationIdInput (AC-4)", () => {
  it("trims the id", () => {
    const result = invitationIdInput.safeParse({
      invitationId: "  orginv_1  ",
    });

    expect(result.data).toStrictEqual({ invitationId: "orginv_1" });
  });

  it("rejects an empty id", () => {
    expect(invitationIdInput.safeParse({ invitationId: "   " }).success).toBe(
      false,
    );
  });
});

describe("membershipIdInput (AC-5, AC-6)", () => {
  it("trims the id", () => {
    const result = membershipIdInput.safeParse({ membershipId: " orgmem_1 " });

    expect(result.data).toStrictEqual({ membershipId: "orgmem_1" });
  });

  it("rejects an empty id", () => {
    expect(membershipIdInput.safeParse({ membershipId: "" }).success).toBe(
      false,
    );
  });
});

describe("changeRoleInput (AC-5)", () => {
  it("accepts a membership id with a valid role", () => {
    const result = changeRoleInput.safeParse({
      membershipId: "orgmem_1",
      role: "admin",
    });

    expect(result.success).toBe(true);
    expect(result.data).toStrictEqual({
      membershipId: "orgmem_1",
      role: "admin",
    });
  });

  it("rejects a missing role", () => {
    expect(
      changeRoleInput.safeParse({ membershipId: "orgmem_1" }).success,
    ).toBe(false);
  });

  it("rejects an invalid role", () => {
    expect(
      changeRoleInput.safeParse({ membershipId: "orgmem_1", role: "owner" })
        .success,
    ).toBe(false);
  });
});
