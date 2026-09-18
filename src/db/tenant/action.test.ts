/**
 * @vitest-environment node
 *
 * covers: spec 0003 AC-8, AC-9, AC-10, AC-11, AC-14 · spec 0008 AC-6, AC-12
 *
 * The write path's contract: parsed before the handler runs, a closed set of
 * error codes, revalidation only after success, and a role guard that refuses
 * before any work happens. The database is stubbed here on purpose; the real
 * SQL is proven in `tenancy.db.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { UPLOAD } from "@/rate-limit/policies";

import type { ActionErrorCode } from "./errors";

const state = vi.hoisted(() => ({
  ctx: {
    kind: "staff" as "staff" | "contact",
    orgId: "org-1",
    clerkOrgId: "clerk-org-1",
    userId: "user-1",
    clerkUserId: "clerk-user-1",
    role: "admin" as "admin" | "member",
  },
  thrownByContext: undefined as unknown,
  revalidatedPaths: [] as string[],
  updatedTags: [] as string[],
  transactionsOpened: 0,
  /** What the access gate's read returns. Active unless a test says otherwise. */
  subscriptionRow: { status: "active", pastDueSince: null } as unknown,
  subscriptionReads: 0,
  consume: vi.fn(async () => ({ allowed: true }) as unknown),
}));

vi.mock("./context", async (importActual) => {
  const actual = await importActual<typeof import("./context")>();

  return {
    ...actual,
    tenantContext: async () => {
      if (state.thrownByContext !== undefined) {
        throw state.thrownByContext;
      }

      return state.ctx;
    },
  };
});

vi.mock("./accessor", () => ({
  tenantDb: () => ({
    marker: "scoped accessor",
    // The access gate reads the subscription row through the same accessor.
    // Active by default so the rest of this file is about the wrapper alone;
    // `subscription.test.ts` covers the gate itself.
    findFirst: async () => {
      state.subscriptionReads += 1;

      if (state.subscriptionRow instanceof Error) {
        throw state.subscriptionRow;
      }

      return state.subscriptionRow;
    },
  }),
}));

vi.mock("./executor", () => ({
  pooledDb: async () => ({
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      state.transactionsOpened += 1;

      return fn({ marker: "transaction" });
    },
  }),
}));

vi.mock("./rate-limit", () => ({
  consume: (...args: Parameters<typeof state.consume>) =>
    state.consume(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    state.revalidatedPaths.push(path);
  },
  updateTag: (tag: string) => {
    state.updatedTags.push(tag);
  },
}));

const { withTenantAction } = await import("./action");
const { tenantActionError, tenantResolutionError } = await import("./errors");

const input = z.object({ name: z.string().min(1) });

beforeEach(() => {
  state.ctx = {
    kind: "staff",
    orgId: "org-1",
    clerkOrgId: "clerk-org-1",
    userId: "user-1",
    clerkUserId: "clerk-user-1",
    role: "admin",
  };
  state.thrownByContext = undefined;
  state.revalidatedPaths = [];
  state.updatedTags = [];
  state.transactionsOpened = 0;
  state.subscriptionRow = { status: "active", pastDueSince: null };
  state.subscriptionReads = 0;
  state.consume = vi.fn(async () => ({ allowed: true }));
});

describe("input is parsed before anything runs", () => {
  it("returns validation with field errors, and never calls the handler", async () => {
    const handler = vi.fn(async () => "never");
    const action = withTenantAction({ name: "rename", input, handler });

    const result = await action({ name: "" });

    expect(result).toStrictEqual({
      ok: false,
      error: {
        code: "validation",
        message: expect.any(String),
        fieldErrors: { name: [expect.any(String)] },
      },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("hands the parsed value, not the raw one, to the handler", async () => {
    const seen: unknown[] = [];
    const action = withTenantAction({
      name: "trim",
      input: z.object({ name: z.string().trim() }),
      handler: async ({ input: parsed }) => {
        seen.push(parsed);

        return parsed.name;
      },
    });

    const result = await action({ name: "  Acme  " });

    expect(result).toStrictEqual({ ok: true, data: "Acme" });
    expect(seen).toStrictEqual([{ name: "Acme" }]);
  });
});

describe("the error codes are a closed union", () => {
  it("maps an expired session to unauthenticated rather than crashing", async () => {
    state.thrownByContext = tenantResolutionError("no_session");
    const action = withTenantAction({
      name: "x",
      input,
      handler: async () => "ok",
    });

    const result = await action({ name: "Acme" });

    expect(result).toStrictEqual({
      ok: false,
      error: { code: "unauthenticated", message: expect.any(String) },
    });
  });

  it("maps a missing mirror row to unavailable", async () => {
    state.thrownByContext = tenantResolutionError("no_mirror_row");
    const action = withTenantAction({
      name: "x",
      input,
      handler: async () => "ok",
    });

    const result = await action({ name: "Acme" });

    expect(result).toStrictEqual({
      ok: false,
      error: { code: "unavailable", message: expect.any(String) },
    });
  });

  it("maps a unique violation to conflict, keeping the constraint out of the message", async () => {
    const violation = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint_name: "invoices_org_id_number_unique",
    });

    const action = withTenantAction({
      name: "issue",
      input,
      handler: async () => {
        throw violation;
      },
    });

    const result = await action({ name: "Acme" });

    expect(result.ok).toBe(false);

    if (result.ok) return;

    expect(result.error.code).toBe("conflict");
    expect(result.error.message).not.toContain("invoices_org_id_number_unique");
  });

  it("maps a check violation to conflict too", async () => {
    const action = withTenantAction({
      name: "issue",
      input,
      handler: async () => {
        throw Object.assign(new Error("check failed"), { code: "23514" });
      },
    });

    const result = await action({ name: "Acme" });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("conflict");
  });

  it("lets every other throw propagate, because a bug is not a business outcome", async () => {
    const bug = new Error("something genuinely broken");
    const action = withTenantAction({
      name: "x",
      input,
      handler: async () => {
        throw bug;
      },
    });

    await expect(action({ name: "Acme" })).rejects.toBe(bug);
  });

  it("is exhaustively switchable", () => {
    // Checked by `pnpm typecheck`: adding a code without handling it here is a
    // compile error, which is what "the UI can switch on it exhaustively" means.
    const describeCode = (code: ActionErrorCode): string => {
      switch (code) {
        case "validation":
          return "not right yet";
        case "unauthenticated":
          return "sign in again";
        case "not_found":
          return "gone";
        case "forbidden":
          return "not allowed";
        case "conflict":
          return "clashes";
        case "rate_limited":
          return "slow down";
        case "unavailable":
          return "try again";
        case "subscription_inactive":
          return "open billing";
        default: {
          const unreachable: never = code;

          return unreachable;
        }
      }
    };

    expect(describeCode("conflict")).toBe("clashes");
  });
});

describe("revalidation happens once, and only after a success", () => {
  it("invokes each declared path and tag exactly once", async () => {
    const action = withTenantAction({
      name: "x",
      input,
      revalidate: { paths: ["/clients"], tags: ["clients"] },
      handler: async () => "done",
    });

    await action({ name: "Acme" });

    expect(state.revalidatedPaths).toStrictEqual(["/clients"]);
    expect(state.updatedTags).toStrictEqual(["clients"]);
  });

  it("revalidates nothing when the action returns a failure", async () => {
    state.ctx = { ...state.ctx, role: "member" };
    const action = withTenantAction({
      name: "x",
      input,
      requireRole: "admin",
      revalidate: { paths: ["/clients"], tags: ["clients"] },
      handler: async () => "done",
    });

    const result = await action({ name: "Acme" });

    expect(result.ok).toBe(false);
    expect(state.revalidatedPaths).toStrictEqual([]);
    expect(state.updatedTags).toStrictEqual([]);
  });

  it("revalidates nothing when the handler throws", async () => {
    const action = withTenantAction({
      name: "x",
      input,
      revalidate: { paths: ["/clients"] },
      handler: async () => {
        throw tenantActionError({ code: "not_found", message: "Gone." });
      },
    });

    const result = await action({ name: "Acme" });

    expect(result).toStrictEqual({
      ok: false,
      error: { code: "not_found", message: "Gone." },
    });
    expect(state.revalidatedPaths).toStrictEqual([]);
  });
});

describe("role guards read the session claim", () => {
  it("refuses a member with forbidden, before the handler runs", async () => {
    state.ctx = { ...state.ctx, role: "member" };
    const handler = vi.fn(async () => "done");
    const action = withTenantAction({
      name: "invite",
      input,
      requireRole: "admin",
      handler,
    });

    const result = await action({ name: "Acme" });

    expect(result).toStrictEqual({
      ok: false,
      error: { code: "forbidden", message: expect.any(String) },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("lets an admin through", async () => {
    const action = withTenantAction({
      name: "invite",
      input,
      requireRole: "admin",
      handler: async () => "done",
    });

    await expect(action({ name: "Acme" })).resolves.toStrictEqual({
      ok: true,
      data: "done",
    });
  });

  it("refuses a client contact reaching a write action at all", async () => {
    state.ctx = { ...state.ctx, kind: "contact" };
    const handler = vi.fn(async () => "done");
    const action = withTenantAction({ name: "x", input, handler });

    const result = await action({ name: "Acme" });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("forbidden");
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("a declared transaction", () => {
  it("opens one and hands the handler an accessor bound to it", async () => {
    const action = withTenantAction({
      name: "x",
      input,
      transaction: true,
      handler: async ({ db }) => db,
    });

    const result = await action({ name: "Acme" });

    expect(state.transactionsOpened).toBe(1);
    expect(result.ok).toBe(true);
  });

  it("opens none when it was not asked for", async () => {
    const action = withTenantAction({
      name: "x",
      input,
      handler: async () => "done",
    });

    await action({ name: "Acme" });

    expect(state.transactionsOpened).toBe(0);
  });
});

describe("the subscription gate (spec 0008, AC-6)", () => {
  const LOCKED = { status: "canceled", pastDueSince: null };

  it("refuses a write with subscription_inactive when the level is not full, before the handler runs", async () => {
    state.subscriptionRow = LOCKED;
    const handler = vi.fn(async () => "done");
    const action = withTenantAction({ name: "x", input, handler });

    const result = await action({ name: "Acme" });

    expect(result).toStrictEqual({
      ok: false,
      error: { code: "subscription_inactive", message: expect.any(String) },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs after the role guard: a locked member gets forbidden, not a hint about billing", async () => {
    state.ctx = { ...state.ctx, role: "member" };
    state.subscriptionRow = LOCKED;
    const action = withTenantAction({
      name: "invite",
      input,
      requireRole: "admin",
      handler: async () => "done",
    });

    const result = await action({ name: "Acme" });

    expect(result.ok ? undefined : result.error.code).toBe("forbidden");
    expect(state.subscriptionReads).toBe(0);
  });

  it("runs before parsing: a locked admin sending invalid input gets subscription_inactive, not validation", async () => {
    state.subscriptionRow = LOCKED;
    const action = withTenantAction({
      name: "x",
      input,
      handler: async () => "done",
    });

    const result = await action({ name: "" });

    expect(result.ok ? undefined : result.error.code).toBe(
      "subscription_inactive",
    );
  });

  it("runs outside any transaction: a refused write opens none", async () => {
    state.subscriptionRow = LOCKED;
    const action = withTenantAction({
      name: "x",
      input,
      transaction: true,
      handler: async () => "done",
    });

    await action({ name: "Acme" });

    expect(state.transactionsOpened).toBe(0);
    expect(state.subscriptionReads).toBe(1);
  });

  it('is skipped by subscription: "any", which does not relax the role guard', async () => {
    state.subscriptionRow = LOCKED;
    const handler = vi.fn(async () => "portal url");
    const action = withTenantAction({
      name: "openBillingPortal",
      input,
      requireRole: "admin",
      subscription: "any",
      handler,
    });

    await expect(action({ name: "Acme" })).resolves.toStrictEqual({
      ok: true,
      data: "portal url",
    });
    expect(state.subscriptionReads).toBe(0);

    state.ctx = { ...state.ctx, role: "member" };

    const asMember = await action({ name: "Acme" });

    expect(asMember.ok ? undefined : asMember.error.code).toBe("forbidden");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("reads the row exactly once per call on the normal path", async () => {
    const action = withTenantAction({
      name: "x",
      input,
      handler: async () => "done",
    });

    await action({ name: "Acme" });

    expect(state.subscriptionReads).toBe(1);
  });

  it("rethrows when the subscription read fails, rather than returning a Result (AC-12)", async () => {
    const outage = new Error("database unreachable");
    state.subscriptionRow = outage;
    const handler = vi.fn(async () => "done");
    const action = withTenantAction({ name: "x", input, handler });

    await expect(action({ name: "Acme" })).rejects.toBe(outage);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("the rate limit slot (spec 0018, AC-2)", () => {
  it("is never consulted when the action declares no policy", async () => {
    const action = withTenantAction({
      name: "x",
      input,
      handler: async () => "done",
    });

    await action({ name: "Acme" });

    expect(state.consume).not.toHaveBeenCalled();
  });

  it("checks after parsing, on the org from context, with the declared policy", async () => {
    const handler = vi.fn(async () => "done");
    const action = withTenantAction({
      name: "requestUpload",
      input,
      rateLimit: UPLOAD,
      handler,
    });

    await action({ name: "Acme" });

    expect(state.consume).toHaveBeenCalledWith(
      { kind: "org", id: "org-1" },
      UPLOAD,
      expect.any(Date),
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("returns rate_limited and never calls the handler when refused, with no revalidation and no transaction", async () => {
    state.consume = vi.fn(async () => ({
      allowed: false,
      message: "Try again in about 1 hour.",
    }));
    const handler = vi.fn(async () => "done");
    const action = withTenantAction({
      name: "requestUpload",
      input,
      rateLimit: UPLOAD,
      transaction: true,
      revalidate: { paths: ["/projects"] },
      handler,
    });

    const result = await action({ name: "Acme" });

    expect(result).toStrictEqual({
      ok: false,
      error: { code: "rate_limited", message: "Try again in about 1 hour." },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(state.transactionsOpened).toBe(0);
    expect(state.revalidatedPaths).toStrictEqual([]);
  });

  it("does not consult the ceiling for input that fails validation first", async () => {
    const action = withTenantAction({
      name: "requestUpload",
      input,
      rateLimit: UPLOAD,
      handler: async () => "done",
    });

    const result = await action({ name: "" });

    expect(result.ok ? undefined : result.error.code).toBe("validation");
    expect(state.consume).not.toHaveBeenCalled();
  });

  it("does not consult the ceiling for a caller the role guard already stopped", async () => {
    state.ctx = { ...state.ctx, role: "member" };
    const action = withTenantAction({
      name: "requestUpload",
      input,
      requireRole: "admin",
      rateLimit: UPLOAD,
      handler: async () => "done",
    });

    const result = await action({ name: "Acme" });

    expect(result.ok ? undefined : result.error.code).toBe("forbidden");
    expect(state.consume).not.toHaveBeenCalled();
  });
});
