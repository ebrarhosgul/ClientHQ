/**
 * @vitest-environment node
 *
 * covers: spec 0003 AC-15 and the "first door" rules (a hand written tenant
 * query demands a reason in writing, records one line, and runs on the caller's
 * executor when there is one)
 *
 * The predicate itself is the caller's to write, so there is nothing here that
 * can prove a given call site scoped correctly. What this file proves is that
 * the door is conspicuous: no anonymous use, one countable log line each time,
 * and the context handed straight to the caller so the organization is in reach.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pool = vi.hoisted(() => ({ calls: 0, handle: { marker: "pooled" } }));

vi.mock("./executor", () => ({
  pooledDb: async () => {
    pool.calls += 1;

    return pool.handle;
  },
}));

const { unsafeTenantQuery } = await import("./unsafe");

import type { ContactContext, StaffContext } from "./context";
import type { Executor } from "./executor";

const staff: StaffContext = {
  kind: "staff",
  orgId: "org-row-1",
  clerkOrgId: "org_clerk_1",
  userId: "user-row-1",
  clerkUserId: "user_clerk_1",
  role: "admin",
};

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

function lines(): Record<string, unknown>[] {
  return warned.map((raw) => {
    const parsed: unknown = JSON.parse(raw);

    return parsed as Record<string, unknown>;
  });
}

beforeEach(() => {
  pool.calls = 0;
  warned.length = 0;
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    warned.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("unsafeTenantQuery", () => {
  it("returns whatever the hand written query returns", async () => {
    const rows = await unsafeTenantQuery(
      staff,
      "a grouped total the accessor cannot express",
      async () => [{ total: 4 }],
    );

    expect(rows).toStrictEqual([{ total: 4 }]);
  });

  it("hands the caller the pooled handle when no executor is supplied", async () => {
    const seen = await unsafeTenantQuery(
      staff,
      "a grouped total",
      async (db) => db,
    );

    expect(seen).toStrictEqual(pool.handle);
    expect(pool.calls).toBe(1);
  });

  it("uses the caller's open transaction instead, so the query joins it", async () => {
    const tx = { marker: "open transaction" } as unknown as Executor;

    const seen = await unsafeTenantQuery(
      staff,
      "a grouped total inside an existing transaction",
      async (db) => db,
      { executor: tx },
    );

    expect(seen).toBe(tx);
    expect(pool.calls).toBe(0);
  });

  it("hands the context back, so the organization is right there in the predicate", async () => {
    const seen = await unsafeTenantQuery(
      contact,
      "a report shaped join",
      async (_db, ctx) => ctx,
    );

    expect(seen).toBe(contact);
  });

  it.each([
    ["an empty reason", ""],
    ["a space", " "],
    ["only whitespace", "   \t\n  "],
  ])(
    "refuses %s, so a hand written query is never anonymous",
    async (_label, reason) => {
      await expect(
        unsafeTenantQuery(staff, reason, async () => "ran"),
      ).rejects.toThrow(/needs a reason/u);
    },
  );

  it("does not run the query when the reason is blank", async () => {
    const fn = vi.fn(async () => "ran");

    await expect(unsafeTenantQuery(staff, "", fn)).rejects.toThrow();

    expect(fn).not.toHaveBeenCalled();
    expect(pool.calls).toBe(0);
  });

  it("does not log when it refuses a blank reason", async () => {
    await expect(
      unsafeTenantQuery(staff, "  ", async () => 1),
    ).rejects.toThrow();

    expect(warned).toHaveLength(0);
  });

  it("records exactly one escape hatch line per call, naming the reason", async () => {
    await unsafeTenantQuery(
      staff,
      "monthly revenue rollup, no accessor shape for group by",
      async () => 0,
    );

    expect(warned).toHaveLength(1);
    expect(lines()[0]).toMatchObject({
      event: "tenant.escape_hatch",
      operation: "unsafeTenantQuery",
      reason: "monthly revenue rollup, no accessor shape for group by",
      userId: "user-row-1",
      orgId: "org-row-1",
    });
  });

  it("records the contact's identifiers when a contact uses the door", async () => {
    await unsafeTenantQuery(contact, "a portal summary", async () => 0);

    expect(lines()[0]).toMatchObject({
      userId: "user-row-2",
      orgId: "org-row-1",
    });
  });

  it("never puts the contact's client id in the line, only the organization", async () => {
    await unsafeTenantQuery(contact, "a portal summary", async () => 0);

    const [raw] = warned;

    expect(raw).not.toContain(contact.clientId);
    expect(raw).not.toContain(contact.contactId);
  });

  it("logs the grant before running, so a query that throws is still counted", async () => {
    await expect(
      unsafeTenantQuery(staff, "a query that blows up", async () => {
        throw new Error("syntax error at or near");
      }),
    ).rejects.toThrow("syntax error at or near");

    expect(warned).toHaveLength(1);
  });

  it("lets the query's own error propagate untouched", async () => {
    const boom = new Error("deadlock detected");

    await expect(
      unsafeTenantQuery(staff, "a contended update", async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it("counts each call, so growth past a handful is visible in the logs", async () => {
    await unsafeTenantQuery(staff, "first shape", async () => 0);
    await unsafeTenantQuery(staff, "second shape", async () => 0);

    expect(warned).toHaveLength(2);
    expect(lines().map((line) => line.reason)).toStrictEqual([
      "first shape",
      "second shape",
    ]);
  });

  it("does not log an audited call site, however often it runs", async () => {
    await unsafeTenantQuery(staff, "a per request read", async () => 0, {
      audited: true,
    });
    await unsafeTenantQuery(staff, "a per request read", async () => 0, {
      audited: true,
    });

    expect(warned).toHaveLength(0);
  });

  it("still runs and returns normally when audited", async () => {
    const seen = await unsafeTenantQuery(
      contact,
      "a per request read",
      async (db) => db,
      { audited: true },
    );

    expect(seen).toStrictEqual(pool.handle);
  });

  it("still requires a reason when audited", async () => {
    await expect(
      unsafeTenantQuery(staff, "", async () => "ran", { audited: true }),
    ).rejects.toThrow(/needs a reason/u);
  });

  it("joins the caller's transaction when both an executor and audited are given", async () => {
    const tx = { marker: "open transaction" } as unknown as Executor;

    const seen = await unsafeTenantQuery(
      staff,
      "a per request read inside a transaction",
      async (db) => db,
      { executor: tx, audited: true },
    );

    expect(seen).toBe(tx);
    expect(warned).toHaveLength(0);
  });
});
