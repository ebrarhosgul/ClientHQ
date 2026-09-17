/**
 * @vitest-environment node
 *
 * covers: spec 0015 AC-3, AC-5, AC-6
 *
 * The pure rules every action leans on: the last admin count, the duplicate
 * check, and the target lookup. Pure inputs, no Clerk, no database.
 */
import { describe, expect, it } from "vitest";

import {
  adminCount,
  duplicateEmail,
  findMembership,
  lastAdminBlocks,
  roleLabel,
} from "./rules";
import { INVITATION_FIXTURES, MEMBER_FIXTURES } from "./ui/fixtures";

const [grace, linus, ada] = MEMBER_FIXTURES;

describe("adminCount and lastAdminBlocks (AC-5, AC-6)", () => {
  it("counts the admins in the list", () => {
    expect(adminCount(MEMBER_FIXTURES)).toBe(2);
    expect(adminCount([grace])).toBe(0);
  });

  it("blocks only when the target is an admin and the only one", () => {
    expect(lastAdminBlocks(MEMBER_FIXTURES, ada)).toBe(false);
    expect(lastAdminBlocks([ada, grace], ada)).toBe(true);
    // A member is never the last admin, even alone in the list.
    expect(lastAdminBlocks([grace], grace)).toBe(false);
    expect(lastAdminBlocks([ada, linus], linus)).toBe(false);
  });
});

describe("duplicateEmail (AC-3)", () => {
  it("finds a member by email, case and whitespace aside", () => {
    expect(
      duplicateEmail("  Grace@Northwind.example ", MEMBER_FIXTURES, []),
    ).toBe("already_member");
  });

  it("finds a pending invitation by email", () => {
    expect(
      duplicateEmail("ALEX@northwind.example", [], INVITATION_FIXTURES),
    ).toBe("already_invited");
  });

  it("prefers the member answer when both would match", () => {
    expect(
      duplicateEmail("grace@northwind.example", MEMBER_FIXTURES, [
        { ...INVITATION_FIXTURES[0], email: "grace@northwind.example" },
      ]),
    ).toBe("already_member");
  });

  it("is undefined for a new address", () => {
    expect(
      duplicateEmail(
        "new@northwind.example",
        MEMBER_FIXTURES,
        INVITATION_FIXTURES,
      ),
    ).toBeUndefined();
  });
});

describe("findMembership", () => {
  it("resolves by membership id and nothing else", () => {
    expect(findMembership(MEMBER_FIXTURES, "orgmem_2")).toBe(linus);
    expect(findMembership(MEMBER_FIXTURES, "user_linus")).toBeUndefined();
    expect(findMembership(MEMBER_FIXTURES, "orgmem_other")).toBeUndefined();
  });
});

describe("roleLabel", () => {
  it("names both roles", () => {
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("member")).toBe("Member");
  });
});
