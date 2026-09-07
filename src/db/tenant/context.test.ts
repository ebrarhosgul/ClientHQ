/**
 * @vitest-environment node
 *
 * covers: spec 0003 AC-7 (one resolution per request) and the Clerk role mapping
 *
 * AC-7 is about a *request scope*. React's `cache()` only memoises inside one,
 * and a plain Node test has none, so the scope is supplied here: `cache` is
 * replaced with a memoising implementation, which is exactly what React gives a
 * Server Component render or a Server Action. What this proves is the part that
 * is ours, that the resolver is wrapped and shared; that a request is one scope
 * is React's own contract.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  claims: {
    clerkUserId: "user_1" as string | undefined,
    clerkOrgId: "org_1" as string | undefined,
    clerkOrgRole: "org:admin" as string | undefined,
  },
}));

const queries = vi.hoisted(() => ({ count: 0 }));

vi.mock("./session", () => ({
  CONTACT_COOKIE_NAME: "clienthq_contact",
  CLERK_ADMIN_ROLE: "org:admin",
  sessionClaims: async () => session.claims,
  contactCookie: async () => undefined,
}));

vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();

  return {
    ...actual,
    /** One shared memo per module load, which is one request in this test. */
    cache: <TArgs extends unknown[], TResult>(
      fn: (...args: TArgs) => TResult,
    ) => {
      let held: { readonly value: TResult } | undefined;

      return (...args: TArgs): TResult => {
        held ??= { value: fn(...args) };

        return held.value;
      };
    },
  };
});

vi.mock("./executor", () => ({
  pooledDb: async () => {
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: async () => [],
      limit: async () => [{ orgId: "org-row", userId: "user-row" }],
    };

    return {
      select: () => {
        queries.count += 1;

        return chain;
      },
    };
  },
}));

beforeEach(() => {
  queries.count = 0;
  vi.resetModules();
});

describe("tenantContext", () => {
  it("resolves once however many times it is called in one request", async () => {
    const { tenantContext } = await import("./context");

    const [first, second, third] = await Promise.all([
      tenantContext(),
      tenantContext(),
      tenantContext(),
    ]);

    expect(queries.count).toBe(1);
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it("shares that one resolution with staffContext()", async () => {
    const { staffContext, tenantContext } = await import("./context");

    const viaTenant = await tenantContext();
    const viaStaff = await staffContext();

    expect(queries.count).toBe(1);
    expect(viaStaff).toBe(viaTenant);
  });
});

describe("toMembershipRole", () => {
  it("maps the Clerk admin role onto admin", async () => {
    const { toMembershipRole } = await import("./context");

    expect(toMembershipRole("org:admin")).toBe("admin");
  });

  it("maps everything else, including a role it has never seen, onto member", async () => {
    const { toMembershipRole } = await import("./context");

    expect(toMembershipRole("org:member")).toBe("member");
    expect(toMembershipRole("org:billing_wizard")).toBe("member");
    expect(toMembershipRole(undefined)).toBe("member");
  });
});
