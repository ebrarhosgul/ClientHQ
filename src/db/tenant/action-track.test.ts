/**
 * @vitest-environment node
 *
 * covers: spec 0019 AC-10, AC-21
 *
 * The `track` slot: one fire case and four no fire cases, against a fake
 * sink. The database, the context and the cache are stubbed the same way
 * `action.test.ts` stubs them; the analytics module is swapped for a client
 * over a recording sink so the calls can be read back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const state = vi.hoisted(() => ({
  thrownByContext: undefined as unknown,
  role: "admin" as "admin" | "member",
  subscriptionRow: { status: "active", pastDueSince: null } as unknown,
  committed: 0,
}));

vi.mock("./context", async (importActual) => {
  const actual = await importActual<typeof import("./context")>();

  return {
    ...actual,
    tenantContext: async () => {
      if (state.thrownByContext !== undefined) {
        throw state.thrownByContext;
      }

      return {
        kind: "staff",
        orgId: "org-1",
        clerkOrgId: "clerk-org-1",
        userId: "user-1",
        clerkUserId: "clerk-user-1",
        role: state.role,
      };
    },
  };
});

vi.mock("./accessor", () => ({
  tenantDb: () => ({
    findFirst: async () => state.subscriptionRow,
  }),
}));

vi.mock("./executor", () => ({
  pooledDb: async () => ({
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const result = await fn({});
      state.committed += 1;

      return result;
    },
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  updateTag: () => undefined,
}));

const { recordingSink } = await import("@/analytics/sink");
const sink = recordingSink();

vi.mock("@/analytics", async (importActual) => {
  const actual = await importActual<typeof import("@/analytics")>();
  const client = actual.createAnalytics({ sink });

  return { ...actual, analytics: () => client };
});

const { withTenantAction } = await import("./action");
const { tenantResolutionError } = await import("./errors");

const input = z.object({ clientId: z.string().min(1) });

function captures() {
  return sink.calls.filter((call) => call.kind === "capture");
}

beforeEach(() => {
  sink.reset();
  state.thrownByContext = undefined;
  state.role = "admin";
  state.subscriptionRow = { status: "active", pastDueSince: null };
  state.committed = 0;
});

describe("the track slot fires after success only (AC-10)", () => {
  it("fires once, after the commit, with the context's ids and the derived properties", async () => {
    const order: string[] = [];
    const action = withTenantAction({
      name: "createClient",
      input,
      transaction: true,
      handler: async ({ input: parsed }) => {
        order.push("handler");

        return { id: `${parsed.clientId}-row` };
      },
      track: {
        event: "client.created",
        properties: (_input, result) => ({ client_id: result.id }),
      },
    });

    const result = await action({ clientId: "c1" });

    expect(result).toStrictEqual({ ok: true, data: { id: "c1-row" } });
    expect(state.committed).toBe(1);
    expect(captures()).toEqual([
      {
        kind: "capture",
        message: {
          distinctId: "clerk-user-1",
          event: "client.created",
          properties: { client_id: "c1-row", org_id: "org-1" },
        },
      },
    ]);
  });

  it("does not fire on a parse failure", async () => {
    const action = withTenantAction({
      name: "x",
      input,
      handler: async () => "never",
      track: { event: "agency.created" },
    });

    const result = await action({ clientId: "" });

    expect(result.ok).toBe(false);
    expect(captures()).toEqual([]);
  });

  it("does not fire on a role refusal", async () => {
    state.role = "member";
    const action = withTenantAction({
      name: "x",
      input,
      requireRole: "admin",
      handler: async () => "never",
      track: { event: "agency.created" },
    });

    const result = await action({ clientId: "c1" });

    expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(captures()).toEqual([]);
  });

  it("does not fire on a subscription refusal", async () => {
    state.subscriptionRow = undefined;
    const action = withTenantAction({
      name: "x",
      input,
      handler: async () => "never",
      track: { event: "agency.created" },
    });

    const result = await action({ clientId: "c1" });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "subscription_inactive" },
    });
    expect(captures()).toEqual([]);
  });

  it("does not fire when the handler throws, even inside a transaction", async () => {
    const action = withTenantAction({
      name: "x",
      input,
      transaction: true,
      handler: async () => {
        throw tenantResolutionError("no_session");
      },
      track: { event: "agency.created" },
    });

    const result = await action({ clientId: "c1" });

    expect(result.ok).toBe(false);
    expect(state.committed).toBe(0);
    expect(captures()).toEqual([]);
  });

  it("does not fire when the context cannot be resolved", async () => {
    state.thrownByContext = tenantResolutionError("no_session");
    const action = withTenantAction({
      name: "x",
      input,
      handler: async () => "never",
      track: { event: "agency.created" },
    });

    await action({ clientId: "c1" });

    expect(captures()).toEqual([]);
  });
});

describe("a provider failure never changes the result (AC-21)", () => {
  it("still returns ok when the sink throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { createAnalytics } = await import("@/analytics/client");
    const failing = recordingSink({ failing: true });
    const client = createAnalytics({ sink: failing });
    const analyticsModule = await import("@/analytics");
    const spy = vi.spyOn(analyticsModule, "analytics").mockReturnValue(client);

    const action = withTenantAction({
      name: "issueInvoice",
      input,
      handler: async () => "issued",
      track: { event: "agency.created" },
    });

    await expect(action({ clientId: "c1" })).resolves.toStrictEqual({
      ok: true,
      data: "issued",
    });
    expect(failing.calls.map((call) => call.kind)).toEqual(["capture"]);
    expect(warn).toHaveBeenCalledTimes(1);

    spy.mockRestore();
    warn.mockRestore();
  });
});
