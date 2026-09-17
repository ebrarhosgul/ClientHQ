/**
 * @vitest-environment node
 *
 * covers: spec 0014 AC-2
 *
 * `isPortalReadable` over every level, then `portalAccess`: what it reads,
 * through what, and that a failure propagates. Mirrors
 * `src/access/gate.test.ts`, the agency side's equivalent file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContactContext } from "@/db/tenant";

const state = vi.hoisted(() => ({
  findFirst: vi.fn(),
  unsafeCalls: [] as unknown[],
}));

vi.mock("@/db/tenant", () => ({
  unsafeTenantQuery: async (
    ctx: unknown,
    reason: string,
    fn: (db: unknown) => unknown,
    options: unknown,
  ) => {
    state.unsafeCalls.push({ ctx, reason, options });

    return fn({ query: { subscriptions: { findFirst: state.findFirst } } });
  },
}));

const { isPortalReadable, portalAccess, PORTAL_UNAVAILABLE_PATH } =
  await import("./gate");

const CTX: ContactContext = {
  kind: "contact",
  orgId: "org-1",
  userId: "user-1",
  clerkUserId: "clerk-user-1",
  clientId: "client-1",
  contactId: "contact-1",
};

const NOW = new Date("2026-09-11T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const warned: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  state.findFirst.mockReset();
  state.unsafeCalls.length = 0;
  warned.length = 0;
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    warned.push(String(line));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PORTAL_UNAVAILABLE_PATH", () => {
  it("is the one path every redirect and route imports", () => {
    expect(PORTAL_UNAVAILABLE_PATH).toBe("/portal/unavailable");
  });
});

describe("isPortalReadable", () => {
  it("reads full and grace", () => {
    expect(isPortalReadable("full")).toBe(true);
    expect(isPortalReadable("grace")).toBe(true);
  });

  it("does not read locked or unsubscribed", () => {
    expect(isPortalReadable("locked")).toBe(false);
    expect(isPortalReadable("unsubscribed")).toBe(false);
  });
});

describe("portalAccess", () => {
  it("reads through unsafeTenantQuery with a named reason, for the resolved organization", async () => {
    state.findFirst.mockResolvedValue({ status: "active", pastDueSince: null });

    const access = await portalAccess(CTX);

    expect(access).toStrictEqual({ level: "full" });
    expect(state.unsafeCalls).toStrictEqual([
      { ctx: CTX, reason: "portal gate", options: { audited: true } },
    ]);
  });

  it("marks the read audited, so it does not log on every page view", async () => {
    state.findFirst.mockResolvedValue({ status: "active", pastDueSince: null });

    await portalAccess(CTX);

    expect(warned).toHaveLength(0);
  });

  it("is unsubscribed with no row", async () => {
    state.findFirst.mockResolvedValue(undefined);

    await expect(portalAccess(CTX)).resolves.toStrictEqual({
      level: "unsubscribed",
    });
  });

  it("carries the window's end on grace", async () => {
    const since = new Date(NOW.getTime() - DAY);
    state.findFirst.mockResolvedValue({
      status: "past_due",
      pastDueSince: since,
    });

    await expect(portalAccess(CTX)).resolves.toStrictEqual({
      level: "grace",
      graceEndsAt: new Date(since.getTime() + 7 * DAY),
    });
  });

  it("locks a lapsed subscription", async () => {
    state.findFirst.mockResolvedValue({
      status: "canceled",
      pastDueSince: null,
    });

    await expect(portalAccess(CTX)).resolves.toStrictEqual({
      level: "locked",
    });
  });

  it("logs the invariant break with the organization id, once", async () => {
    state.findFirst.mockResolvedValue({
      status: "past_due",
      pastDueSince: null,
    });

    const access = await portalAccess(CTX);

    expect(access.level).toBe("locked");
    expect(warned.map((raw) => JSON.parse(raw) as unknown)).toStrictEqual([
      expect.objectContaining({
        event: "access.invariant",
        reason: "past_due_without_since",
        orgId: "org-1",
      }),
    ]);
  });

  it("propagates a database failure rather than settling on a level", async () => {
    const outage = new Error("connection refused");
    state.findFirst.mockRejectedValue(outage);

    await expect(portalAccess(CTX)).rejects.toBe(outage);
  });
});
