/**
 * @vitest-environment node
 *
 * covers: spec 0011 AC-18, spec 0004 AC-22, spec 0014 AC-13
 *
 * The branches that never need a database (storage not configured, no Clerk
 * key at all), plus the access gates: the staff branch's subscription gate,
 * unchanged, and the contact branch's `portalAccess`, wired in for spec 0014.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContactContext, StaffContext } from "@/db/tenant";

const VALID_ID = "0198a000-0000-7000-8000-000000000000";

const STAFF: StaffContext = {
  kind: "staff",
  orgId: "org-a",
  clerkOrgId: "clerk-org-a",
  userId: "user-a",
  clerkUserId: "clerk-user-a",
  role: "admin",
};

const CONTACT: ContactContext = {
  kind: "contact",
  orgId: "org-a",
  userId: "contact-user",
  clerkUserId: "clerk-contact",
  clientId: "client-a1",
  contactId: "contact-a1",
};

const READY_ROW = {
  id: VALID_ID,
  r2Key: `${VALID_ID}/file.pdf`,
  name: "file.pdf",
  status: "ready" as const,
  visibleToClient: true,
  project: { archivedAt: null },
};

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  objectStorage: vi.fn(),
  tenantContext: vi.fn(),
  agencyAccess: vi.fn(),
  portalAccess: vi.fn(),
  findById: vi.fn(),
  findFirst: vi.fn(),
  redirect: vi.fn((to: string): never => {
    throw Object.assign(new Error("NEXT_REDIRECT"), {
      digest: `NEXT_REDIRECT;replace;${to}`,
    });
  }),
}));

class FakeResolutionError extends Error {}

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/storage", () => ({ objectStorage: mocks.objectStorage }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/access/gate", () => ({ agencyAccess: mocks.agencyAccess }));
vi.mock("@/portal/gate", () => ({
  portalAccess: mocks.portalAccess,
  isPortalReadable: (level: string) => level === "full" || level === "grace",
  PORTAL_UNAVAILABLE_PATH: "/portal/unavailable",
}));
vi.mock("@/db/tenant", () => ({
  tenantContext: mocks.tenantContext,
  isTenantResolutionError: (thrown: unknown) =>
    thrown instanceof FakeResolutionError,
  tenantDb: () => ({ findById: mocks.findById, findFirst: mocks.findFirst }),
}));

const { GET } = await import("./route");

function request(id: string) {
  return GET(new Request("http://localhost/x"), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.objectStorage.mockReturnValue({
    head: vi.fn().mockResolvedValue({}),
    presignGet: vi.fn().mockResolvedValue("https://signed.example/file.pdf"),
  });
  mocks.tenantContext.mockResolvedValue(STAFF);
  mocks.agencyAccess.mockResolvedValue({ level: "full", role: "admin" });
  mocks.portalAccess.mockResolvedValue({ level: "full" });
  mocks.findById.mockResolvedValue(READY_ROW);
  mocks.findFirst.mockResolvedValue(READY_ROW);
});

describe("GET /deliverables/[id]/download", () => {
  it("answers 503 with the fixed copy when storage is not configured", async () => {
    mocks.objectStorage.mockReturnValue(undefined);

    const response = await request("not-even-a-uuid");

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("File storage is not configured");
    expect(body).toContain("Downloads are unavailable in this environment.");
  });

  it("answers the app's 404 for a non uuid id, before any session is resolved", async () => {
    const response = await request("not-even-a-uuid");

    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toContain("Page not found");
    expect(mocks.tenantContext).not.toHaveBeenCalled();
  });

  it("answers the app's 404 when Clerk is not configured, rather than resolving a session", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    const response = await request(VALID_ID);

    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toContain("Page not found");
    expect(mocks.tenantContext).not.toHaveBeenCalled();
  });

  it("answers the app's 404 on a tenant resolution error", async () => {
    mocks.tenantContext.mockRejectedValue(
      new FakeResolutionError("no_contact"),
    );

    const response = await request(VALID_ID);

    expect(response.status).toBe(404);
  });

  it.each(["unsubscribed", "locked"] as const)(
    "redirects staff to /billing when the gate level is %s",
    async (level) => {
      mocks.agencyAccess.mockResolvedValue({ level, role: "admin" });

      await expect(request(VALID_ID)).rejects.toThrow("NEXT_REDIRECT");
      expect(mocks.redirect).toHaveBeenCalledWith("/billing");
      expect(mocks.findById).not.toHaveBeenCalled();
    },
  );

  it("redirects a signed in staff person to the signed download for a ready row", async () => {
    const response = await request(VALID_ID);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://signed.example/file.pdf",
    );
    expect(mocks.portalAccess).not.toHaveBeenCalled();
  });

  it.each(["unsubscribed", "locked"] as const)(
    "redirects a contact to /portal/unavailable when the gate level is %s (spec 0014, AC-13)",
    async (level) => {
      mocks.tenantContext.mockResolvedValue(CONTACT);
      mocks.portalAccess.mockResolvedValue({ level });

      await expect(request(VALID_ID)).rejects.toThrow("NEXT_REDIRECT");
      expect(mocks.redirect).toHaveBeenCalledWith("/portal/unavailable");
      expect(mocks.findFirst).not.toHaveBeenCalled();
    },
  );

  it.each(["full", "grace"] as const)(
    "redirects a contact to the signed download when the gate level is %s and the file is shared",
    async (level) => {
      mocks.tenantContext.mockResolvedValue(CONTACT);
      mocks.portalAccess.mockResolvedValue({ level });

      const response = await request(VALID_ID);

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(
        "https://signed.example/file.pdf",
      );
    },
  );

  it("answers the app's 404 for a contact when the file is not visible to the client", async () => {
    mocks.tenantContext.mockResolvedValue(CONTACT);
    mocks.findFirst.mockResolvedValue({
      ...READY_ROW,
      visibleToClient: false,
    });

    const response = await request(VALID_ID);

    expect(response.status).toBe(404);
  });

  it("answers the app's 404 for a contact when the file's project is archived", async () => {
    mocks.tenantContext.mockResolvedValue(CONTACT);
    mocks.findFirst.mockResolvedValue({
      ...READY_ROW,
      project: { archivedAt: new Date() },
    });

    const response = await request(VALID_ID);

    expect(response.status).toBe(404);
  });
});
