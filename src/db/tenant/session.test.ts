/**
 * @vitest-environment node
 *
 * covers: spec 0003 AC-5 (the contact cookie is an untrusted hint that can
 * never supply an organization or a client) and build plan task 2 (one module
 * talks to Clerk, and the claims it hands on carry no nulls)
 *
 * Clerk and `next/headers` are the boundary, so both are mocked and nothing
 * else is. React `cache` is replaced with a memo, the same way `context.test.ts`
 * supplies the request scope a plain Node test does not have.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({
  calls: 0,
  session: {
    userId: null as string | null,
    orgId: null as string | null,
    orgRole: null as string | null,
  },
}));

const headers = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
}));

const environment = vi.hoisted(() => ({ calls: 0, order: [] as string[] }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => {
    clerk.calls += 1;
    environment.order.push("auth");

    return clerk.session;
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "clienthq_contact" && headers.cookie !== undefined
        ? { name, value: headers.cookie }
        : undefined,
  }),
}));

vi.mock("@/lib/env", () => ({
  env: () => {
    environment.calls += 1;
    environment.order.push("env");

    return {};
  },
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

beforeEach(() => {
  clerk.calls = 0;
  clerk.session = { userId: null, orgId: null, orgRole: null };
  headers.cookie = undefined;
  environment.calls = 0;
  environment.order = [];
  vi.resetModules();
});

describe("sessionClaims", () => {
  it("passes a full Clerk session through unchanged", async () => {
    clerk.session = {
      userId: "user_clerk_1",
      orgId: "org_clerk_1",
      orgRole: "org:admin",
    };

    const { sessionClaims } = await import("./session");

    await expect(sessionClaims()).resolves.toStrictEqual({
      clerkUserId: "user_clerk_1",
      clerkOrgId: "org_clerk_1",
      clerkOrgRole: "org:admin",
    });
  });

  it("normalises every null to undefined, so nothing downstream sees a null", async () => {
    const { sessionClaims } = await import("./session");

    await expect(sessionClaims()).resolves.toStrictEqual({
      clerkUserId: undefined,
      clerkOrgId: undefined,
      clerkOrgRole: undefined,
    });
  });

  it("normalises a signed in person with no active organization", async () => {
    clerk.session = { userId: "user_clerk_1", orgId: null, orgRole: null };

    const claims = await (await import("./session")).sessionClaims();

    expect(claims.clerkUserId).toBe("user_clerk_1");
    expect(claims.clerkOrgId).toBeUndefined();
  });

  it("touches env() before asking Clerk, so a missing key fails our way", async () => {
    const { sessionClaims } = await import("./session");

    await sessionClaims();

    expect(environment.calls).toBe(1);
    expect(environment.order).toStrictEqual(["env", "auth"]);
  });

  it("resolves once per request however many times it is called", async () => {
    clerk.session = {
      userId: "user_clerk_1",
      orgId: "org_clerk_1",
      orgRole: "org:member",
    };

    const { sessionClaims } = await import("./session");

    const [first, second, third] = await Promise.all([
      sessionClaims(),
      sessionClaims(),
      sessionClaims(),
    ]);

    expect(clerk.calls).toBe(1);
    expect(first).toStrictEqual(second);
    expect(second).toStrictEqual(third);
  });
});

describe("CLERK_ADMIN_ROLE", () => {
  it("is the Clerk role name context.ts maps onto an agency admin", async () => {
    const { CLERK_ADMIN_ROLE } = await import("./session");

    expect(CLERK_ADMIN_ROLE).toBe("org:admin");
  });
});

describe("contactCookie", () => {
  it("is named clienthq_contact", async () => {
    const { CONTACT_COOKIE_NAME } = await import("./session");

    expect(CONTACT_COOKIE_NAME).toBe("clienthq_contact");
  });

  it("returns the value when the cookie names a uuid", async () => {
    headers.cookie = "0199aa2c-1e5f-7b3d-8c41-9f2b6d5a7c10";

    const { contactCookie } = await import("./session");

    await expect(contactCookie()).resolves.toBe(
      "0199aa2c-1e5f-7b3d-8c41-9f2b6d5a7c10",
    );
  });

  it("accepts an uppercase uuid, because a browser may echo one back", async () => {
    headers.cookie = "0199AA2C-1E5F-7B3D-8C41-9F2B6D5A7C10";

    const { contactCookie } = await import("./session");

    await expect(contactCookie()).resolves.toBe(
      "0199AA2C-1E5F-7B3D-8C41-9F2B6D5A7C10",
    );
  });

  it("returns undefined when there is no cookie at all", async () => {
    const { contactCookie } = await import("./session");

    await expect(contactCookie()).resolves.toBeUndefined();
  });

  it.each([
    ["an empty value", ""],
    ["a plain word", "admin"],
    ["a number", "1"],
    ["a uuid with trailing text", "0199aa2c-1e5f-7b3d-8c41-9f2b6d5a7c10x"],
    ["a uuid with surrounding space", " 0199aa2c-1e5f-7b3d-8c41-9f2b6d5a7c10 "],
    ["a truncated uuid", "0199aa2c-1e5f-7b3d-8c41"],
    ["sql punctuation", "' or org_id is not null --"],
    ["a nested quote", '"0199aa2c-1e5f-7b3d-8c41-9f2b6d5a7c10"'],
  ])("discards %s", async (_label, value) => {
    headers.cookie = value;

    const { contactCookie } = await import("./session");

    await expect(contactCookie()).resolves.toBeUndefined();
  });

  it("reads the cookie jar once per request", async () => {
    headers.cookie = "0199aa2c-1e5f-7b3d-8c41-9f2b6d5a7c10";

    const { contactCookie } = await import("./session");
    const first = await contactCookie();
    headers.cookie = "0199bb33-2222-7333-8444-955566677788";

    // The second call comes from the memo, so a cookie jar that changed mid
    // request cannot swap the contact under a half finished resolution.
    await expect(contactCookie()).resolves.toBe(first);
  });
});
