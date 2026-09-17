/**
 * @vitest-environment node
 *
 * covers: spec 0014 AC-1, AC-2
 *
 * `resolveContact()` is shared, unexported, by both `portalContext()` and
 * `portalContextForUnavailable()`: this proves the staff and no-contact
 * redirects it owns, and that any other resolution error (`no_mirror_row`)
 * and a genuine database failure both propagate rather than redirecting, so
 * `error.tsx` gets a chance to show a way forward instead. `portalContext()`
 * alone applies the gate's own redirect; `portalContextForUnavailable()`
 * deliberately does not, which is the one behaviour that tells the two
 * exports apart.
 *
 * Note: `verify.md` (spec 0014) names this file as already covering AC-1's
 * staff and no-contact branches. It did not exist on disk; this is that
 * coverage, written for real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContactContext } from "@/db/tenant";
import { tenantResolutionError } from "@/db/tenant/errors";

const REDIRECTED = "NEXT_REDIRECT";

const CONTACT: ContactContext = {
  kind: "contact",
  orgId: "org-a",
  userId: "user-a1",
  clerkUserId: "clerk-a1",
  clientId: "client-a1",
  contactId: "contact-a1",
};

const STAFF = {
  kind: "staff",
  orgId: "org-a",
  clerkOrgId: "clerk-org-a",
  userId: "user-a1",
  clerkUserId: "clerk-a1",
  role: "admin",
} as const;

const mocks = vi.hoisted(() => ({
  tenantContext: vi.fn(),
  agencyProfile: vi.fn(),
  findFirst: vi.fn(),
  portalAccess: vi.fn(),
  isPortalReadable: vi.fn(),
  redirected: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    mocks.redirected.push(path);
    throw new Error(REDIRECTED);
  },
}));

vi.mock("@/db/tenant", async () => {
  const errors =
    await vi.importActual<typeof import("@/db/tenant/errors")>(
      "@/db/tenant/errors",
    );

  return {
    ...errors,
    tenantContext: mocks.tenantContext,
    agencyProfile: mocks.agencyProfile,
    tenantDb: () => ({ findFirst: mocks.findFirst }),
  };
});

vi.mock("./gate", () => ({
  portalAccess: mocks.portalAccess,
  isPortalReadable: mocks.isPortalReadable,
  PORTAL_UNAVAILABLE_PATH: "/portal/unavailable",
}));

const { portalContext, portalContextForUnavailable } =
  await import("./context");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirected.length = 0;
  mocks.tenantContext.mockResolvedValue(CONTACT);
  mocks.portalAccess.mockResolvedValue({ level: "full" });
  mocks.isPortalReadable.mockReturnValue(true);
  mocks.findFirst.mockResolvedValue({ name: "Northwind Traders" });
  mocks.agencyProfile.mockResolvedValue({ name: "Studio North" });
});

describe("portalContext", () => {
  it("sends a staff session to /dashboard without ever calling the gate (AC-1)", async () => {
    mocks.tenantContext.mockResolvedValue(STAFF);

    await expect(portalContext()).rejects.toThrow(REDIRECTED);

    expect(mocks.redirected).toEqual(["/dashboard"]);
    expect(mocks.portalAccess).not.toHaveBeenCalled();
  });

  it("sends a contactless session to /onboarding (AC-1)", async () => {
    mocks.tenantContext.mockRejectedValue(tenantResolutionError("no_contact"));

    await expect(portalContext()).rejects.toThrow(REDIRECTED);

    expect(mocks.redirected).toEqual(["/onboarding"]);
  });

  it("propagates any other resolution error rather than redirecting", async () => {
    const noMirror = tenantResolutionError("no_mirror_row");

    mocks.tenantContext.mockRejectedValue(noMirror);

    await expect(portalContext()).rejects.toThrow(noMirror);
    expect(mocks.redirected).toEqual([]);
  });

  it("propagates a genuine database failure", async () => {
    const outage = new Error("the database fell over");

    mocks.tenantContext.mockRejectedValue(outage);

    await expect(portalContext()).rejects.toThrow(outage);
    expect(mocks.redirected).toEqual([]);
  });

  it("redirects to /portal/unavailable on an unreadable level, without resolving names (AC-2)", async () => {
    mocks.portalAccess.mockResolvedValue({ level: "locked" });
    mocks.isPortalReadable.mockReturnValue(false);

    await expect(portalContext()).rejects.toThrow(REDIRECTED);

    expect(mocks.redirected).toEqual(["/portal/unavailable"]);
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.agencyProfile).not.toHaveBeenCalled();
  });

  it("resolves the client and agency names for a readable contact", async () => {
    await expect(portalContext()).resolves.toEqual({
      ctx: CONTACT,
      access: { level: "full" },
      clientName: "Northwind Traders",
      agencyName: "Studio North",
    });
  });

  it("falls back to an empty name when the client or agency row is missing", async () => {
    mocks.findFirst.mockResolvedValue(undefined);
    mocks.agencyProfile.mockResolvedValue(undefined);

    await expect(portalContext()).resolves.toMatchObject({
      clientName: "",
      agencyName: "",
    });
  });
});

describe("portalContextForUnavailable", () => {
  it("resolves an unreadable level's names without redirecting (AC-2, AC-3)", async () => {
    mocks.portalAccess.mockResolvedValue({ level: "locked" });
    mocks.isPortalReadable.mockReturnValue(false);

    await expect(portalContextForUnavailable()).resolves.toEqual({
      ctx: CONTACT,
      access: { level: "locked" },
      clientName: "Northwind Traders",
      agencyName: "Studio North",
    });
    expect(mocks.redirected).toEqual([]);
  });

  it("still sends a staff session to /dashboard, the shared resolution step (AC-1)", async () => {
    mocks.tenantContext.mockResolvedValue(STAFF);

    await expect(portalContextForUnavailable()).rejects.toThrow(REDIRECTED);

    expect(mocks.redirected).toEqual(["/dashboard"]);
  });
});
