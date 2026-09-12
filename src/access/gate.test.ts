/**
 * @vitest-environment node
 *
 * covers: spec 0008 AC-3, AC-8, AC-9, AC-12
 *
 * The cached read behind the gated layout. The pure function is proven in
 * `level.test.ts`; this file is about what `agencyAccess()` reads, through
 * what, for whom, and that a failure propagates. The real SQL and the promise
 * that nothing changes are in `gate.db.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ctx: {
    kind: "staff" as const,
    orgId: "org-1",
    clerkOrgId: "clerk-org-1",
    userId: "user-1",
    clerkUserId: "clerk-user-1",
    role: "admin" as "admin" | "member",
  },
  findFirst: vi.fn(),
  tenantDbCalls: [] as unknown[],
  stripeTouched: vi.fn(),
}));

vi.mock("@/auth/context", () => ({
  agencyContext: async () => state.ctx,
}));

vi.mock("@/db/tenant", () => ({
  tenantDb: (ctx: unknown) => {
    state.tenantDbCalls.push(ctx);

    return { findFirst: state.findFirst };
  },
}));

vi.mock("@/payments/stripe", () => ({
  stripeClient: state.stripeTouched,
}));

const { agencyAccess } = await import("./gate");

const NOW = new Date("2026-09-11T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const warned: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  state.ctx = { ...state.ctx, role: "admin" };
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

describe("agencyAccess", () => {
  it("reads the row through the scoped accessor for the resolved organization (AC-9)", async () => {
    state.findFirst.mockResolvedValue({ status: "active", pastDueSince: null });

    const access = await agencyAccess();

    expect(access).toStrictEqual({ level: "full", role: "admin" });
    expect(state.tenantDbCalls).toStrictEqual([state.ctx]);
    expect(state.findFirst).toHaveBeenCalledTimes(1);
  });

  it("is unsubscribed with no row", async () => {
    state.findFirst.mockResolvedValue(undefined);

    await expect(agencyAccess()).resolves.toStrictEqual({
      level: "unsubscribed",
      role: "admin",
    });
  });

  it("carries the window's end on grace, and the role from the session claim", async () => {
    state.ctx = { ...state.ctx, role: "member" };
    const since = new Date(NOW.getTime() - DAY);
    state.findFirst.mockResolvedValue({
      status: "past_due",
      pastDueSince: since,
    });

    await expect(agencyAccess()).resolves.toStrictEqual({
      level: "grace",
      graceEndsAt: new Date(since.getTime() + 7 * DAY),
      role: "member",
    });
  });

  it("logs the invariant break with the organization id, once (AC-3)", async () => {
    state.findFirst.mockResolvedValue({
      status: "past_due",
      pastDueSince: null,
    });

    const access = await agencyAccess();

    expect(access.level).toBe("locked");
    expect(warned.map((raw) => JSON.parse(raw) as unknown)).toStrictEqual([
      expect.objectContaining({
        event: "access.invariant",
        reason: "past_due_without_since",
        orgId: "org-1",
      }),
    ]);
  });

  it("logs nothing on the normal path", async () => {
    state.findFirst.mockResolvedValue({
      status: "trialing",
      pastDueSince: null,
    });

    await agencyAccess();

    expect(warned).toHaveLength(0);
  });

  it("never calls Stripe (AC-8)", async () => {
    state.findFirst.mockResolvedValue({ status: "unpaid", pastDueSince: null });

    await agencyAccess();

    expect(state.stripeTouched).not.toHaveBeenCalled();
  });

  it("propagates a database failure rather than settling on a level (AC-12)", async () => {
    const outage = new Error("connection refused");
    state.findFirst.mockRejectedValue(outage);

    await expect(agencyAccess()).rejects.toBe(outage);
  });
});
