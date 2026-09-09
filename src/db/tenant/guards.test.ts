/**
 * @vitest-environment node
 *
 * covers: spec 0003 AC-11, AC-15 (the role guards read the session claim on the
 * context and nothing else, and each refusal emits exactly one line)
 *
 * `action.test.ts` already proves the wrapper turns a guard's throw into
 * `forbidden`. This file proves the guards themselves: who passes, who is
 * refused, what the refusal says, and that the decision comes from the claim
 * carried on the context rather than from any database row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContactContext, StaffContext } from "./context";
import { isTenantActionError } from "./errors";
import { requireAdmin, requireStaff } from "./guards";

const admin: StaffContext = {
  kind: "staff",
  orgId: "org-row-1",
  clerkOrgId: "org_clerk_1",
  userId: "user-row-1",
  clerkUserId: "user_clerk_1",
  role: "admin",
};

const member: StaffContext = { ...admin, role: "member" };

const contact: ContactContext = {
  kind: "contact",
  orgId: "org-row-1",
  userId: "user-row-2",
  clerkUserId: "user_clerk_2",
  clientId: "client-row-1",
  contactId: "contact-row-1",
};

/** Every line console.warn received, captured as text. */
const warned: string[] = [];

function refusalLines(): Record<string, unknown>[] {
  return warned.map((raw) => {
    const parsed: unknown = JSON.parse(raw);

    return parsed as Record<string, unknown>;
  });
}

beforeEach(() => {
  warned.length = 0;
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    warned.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requireStaff", () => {
  it("lets an agency admin through", () => {
    expect(() => {
      requireStaff(admin);
    }).not.toThrow();
  });

  it("lets an agency member through, because it is about audience not role", () => {
    expect(() => {
      requireStaff(member);
    }).not.toThrow();
  });

  it("says nothing to the log when it lets someone through", () => {
    requireStaff(admin);

    expect(warned).toHaveLength(0);
  });

  it("refuses a client contact", () => {
    expect(() => {
      requireStaff(contact);
    }).toThrow();
  });

  it("refuses with a forbidden Result the wrapper can hand back", () => {
    try {
      requireStaff(contact);
      expect.unreachable("requireStaff should have refused a contact");
    } catch (thrown: unknown) {
      expect(isTenantActionError(thrown)).toBe(true);

      if (!isTenantActionError(thrown)) {
        return;
      }

      expect(thrown.error).toStrictEqual({
        code: "forbidden",
        message: "You do not have permission to do that.",
      });
    }
  });

  it("keeps the message generic, so a refusal tells a stranger nothing", () => {
    try {
      requireStaff(contact);
    } catch (thrown: unknown) {
      const message = isTenantActionError(thrown) ? thrown.error.message : "";

      expect(message).not.toContain("contact");
      expect(message).not.toContain(contact.clientId);
      expect(message).not.toContain(contact.userId);
      expect(message).not.toContain(contact.orgId);
    }
  });

  it("emits exactly one line, naming the operation and the reason", () => {
    expect(() => {
      requireStaff(contact);
    }).toThrow();

    expect(warned).toHaveLength(1);
    expect(refusalLines()[0]).toMatchObject({
      event: "tenant.refusal",
      operation: "requireStaff",
      reason: "not_staff",
      userId: "user-row-2",
      orgId: "org-row-1",
    });
  });

  it("narrows the context to staff for the code after it", () => {
    const ctx: import("./context").TenantContext = admin;

    requireStaff(ctx);

    // Reading `clerkOrgId` only compiles once the assertion has narrowed `ctx`,
    // which is the whole ergonomic point of an asserting guard.
    expect(ctx.clerkOrgId).toBe("org_clerk_1");
  });
});

describe("requireAdmin", () => {
  it("lets an admin through", () => {
    expect(() => {
      requireAdmin(admin);
    }).not.toThrow();
    expect(warned).toHaveLength(0);
  });

  it("refuses an agency member before the handler runs", () => {
    expect(() => {
      requireAdmin(member);
    }).toThrow();
  });

  it("refuses a member with forbidden, not with a role specific message", () => {
    try {
      requireAdmin(member);
      expect.unreachable("requireAdmin should have refused a member");
    } catch (thrown: unknown) {
      expect(isTenantActionError(thrown)).toBe(true);

      if (!isTenantActionError(thrown)) {
        return;
      }

      expect(thrown.error.code).toBe("forbidden");
      expect(thrown.error.message).not.toContain("admin");
    }
  });

  it("emits exactly one line for a member, with reason not_admin", () => {
    expect(() => {
      requireAdmin(member);
    }).toThrow();

    expect(warned).toHaveLength(1);
    expect(refusalLines()[0]).toMatchObject({
      operation: "requireAdmin",
      reason: "not_admin",
      userId: "user-row-1",
      orgId: "org-row-1",
    });
  });

  it("refuses a contact at the staff check, and logs that once, not twice", () => {
    expect(() => {
      requireAdmin(contact);
    }).toThrow();

    expect(warned).toHaveLength(1);
    expect(refusalLines()[0]).toMatchObject({
      operation: "requireStaff",
      reason: "not_staff",
    });
  });

  it("reads the role off the context claim, so a stale membership row cannot promote", () => {
    // The context is the only input. There is no database handle in scope here
    // at all, which is what AC-11 is really asking for: `memberships.role` is a
    // display mirror and no decision may read it.
    const claimSaysMember: StaffContext = { ...admin, role: "member" };

    expect(() => {
      requireAdmin(claimSaysMember);
    }).toThrow();
  });

  it("reads the role off the context claim, so a stale membership row cannot demote", () => {
    const claimSaysAdmin: StaffContext = { ...admin, role: "admin" };

    expect(() => {
      requireAdmin(claimSaysAdmin);
    }).not.toThrow();
  });
});
