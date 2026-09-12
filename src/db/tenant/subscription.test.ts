/**
 * @vitest-environment node
 *
 * covers: spec 0008 AC-3, AC-6, AC-8, AC-9, AC-11, AC-12
 *
 * The write side guard on its own: which levels it lets through, what it
 * throws, what it logs, and that it reads through the scoped accessor and
 * nothing else. The wrapper's ordering around it is in `action.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  findFirst: vi.fn(),
  tenantDbCalls: [] as unknown[],
}));

vi.mock("./accessor", () => ({
  tenantDb: (ctx: unknown) => {
    state.tenantDbCalls.push(ctx);

    return { findFirst: state.findFirst };
  },
}));

const { requireFullAccess, SUBSCRIPTION_INACTIVE_MESSAGE } =
  await import("./subscription");
const { isTenantActionError } = await import("./errors");

const CTX = {
  kind: "staff" as const,
  orgId: "org-1",
  clerkOrgId: "clerk-org-1",
  userId: "user-1",
  clerkUserId: "clerk-user-1",
  role: "admin" as const,
};

const NOW = new Date("2026-09-11T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const warned: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  state.findFirst.mockReset();
  state.tenantDbCalls.length = 0;
  warned.length = 0;
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    warned.push(String(line));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function logged(): Record<string, unknown>[] {
  return warned.map((raw) => JSON.parse(raw) as Record<string, unknown>);
}

async function refusal(): Promise<unknown> {
  try {
    await requireFullAccess(CTX, "createClient");
  } catch (thrown) {
    return thrown;
  }

  return undefined;
}

describe("requireFullAccess", () => {
  it.each(["trialing", "active"])(
    "lets a %s agency through, and logs nothing (AC-11)",
    async (status) => {
      state.findFirst.mockResolvedValue({ status, pastDueSince: null });

      await expect(
        requireFullAccess(CTX, "createClient"),
      ).resolves.toBeUndefined();
      expect(warned).toHaveLength(0);
    },
  );

  it("reads the row through the scoped accessor for the organization on the context (AC-9)", async () => {
    state.findFirst.mockResolvedValue({ status: "active", pastDueSince: null });

    await requireFullAccess(CTX, "createClient");

    expect(state.tenantDbCalls).toStrictEqual([CTX]);
    expect(state.findFirst).toHaveBeenCalledTimes(1);
  });

  it("refuses an agency with no row as unsubscribed", async () => {
    state.findFirst.mockResolvedValue(undefined);

    const thrown = await refusal();

    expect(isTenantActionError(thrown)).toBe(true);
    expect(
      isTenantActionError(thrown) ? thrown.error : undefined,
    ).toStrictEqual({
      code: "subscription_inactive",
      message: SUBSCRIPTION_INACTIVE_MESSAGE,
    });
    expect(logged()).toStrictEqual([
      expect.objectContaining({
        event: "tenant.refusal",
        operation: "createClient",
        reason: "subscription_inactive:unsubscribed",
        userId: "user-1",
        orgId: "org-1",
      }),
    ]);
  });

  it("refuses a write in the grace window, with the level in the log (AC-6, AC-11)", async () => {
    state.findFirst.mockResolvedValue({
      status: "past_due",
      pastDueSince: new Date(NOW.getTime() - DAY),
    });

    const thrown = await refusal();

    expect(isTenantActionError(thrown) ? thrown.error.code : undefined).toBe(
      "subscription_inactive",
    );
    expect(logged().map((line) => line.reason)).toStrictEqual([
      "subscription_inactive:grace",
    ]);
  });

  it("refuses a locked agency", async () => {
    state.findFirst.mockResolvedValue({
      status: "past_due",
      pastDueSince: new Date(NOW.getTime() - 8 * DAY),
    });

    const thrown = await refusal();

    expect(isTenantActionError(thrown) ? thrown.error.code : undefined).toBe(
      "subscription_inactive",
    );
    expect(logged().map((line) => line.reason)).toStrictEqual([
      "subscription_inactive:locked",
    ]);
  });

  it("never names the Stripe status in the message a person sees", async () => {
    state.findFirst.mockResolvedValue({ status: "unpaid", pastDueSince: null });

    const thrown = await refusal();
    const message = isTenantActionError(thrown) ? thrown.error.message : "";

    expect(message).not.toMatch(/unpaid|past_due|canceled/);
  });

  it("logs the invariant break for past_due with no start, then refuses as locked (AC-3)", async () => {
    state.findFirst.mockResolvedValue({
      status: "past_due",
      pastDueSince: null,
    });

    await refusal();

    expect(logged()).toStrictEqual([
      expect.objectContaining({
        event: "access.invariant",
        reason: "past_due_without_since",
        orgId: "org-1",
      }),
      expect.objectContaining({
        event: "tenant.refusal",
        reason: "subscription_inactive:locked",
      }),
    ]);
  });

  it("lets a database failure propagate rather than failing open or closed as a Result (AC-12)", async () => {
    const outage = new Error("connection refused");
    state.findFirst.mockRejectedValue(outage);

    await expect(requireFullAccess(CTX, "createClient")).rejects.toBe(outage);
    expect(warned).toHaveLength(0);
  });

  it("only ever reads: the accessor it is handed has no write it could call (AC-8)", async () => {
    state.findFirst.mockResolvedValue({ status: "active", pastDueSince: null });

    await requireFullAccess(CTX, "createClient");

    // The mock offers `findFirst` alone. If the guard reached for insert,
    // update or delete it would have thrown on an undefined method.
    expect(state.findFirst).toHaveBeenCalledTimes(1);
  });
});
