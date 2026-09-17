/**
 * @vitest-environment node
 *
 * covers: spec 0013 AC-1, AC-2, AC-6, AC-7; spec 0014 AC-13
 *
 * `handleInvoicePdfRequest` with every dependency mocked: the 404 rule for a
 * bad id, no Clerk key, a resolution error and a missing row or agency; the
 * gate redirect for staff, and `portalAccess`'s own redirect for a contact;
 * the 200 headers; and the 500 page with its context aware link and its one
 * log line, on a throwing renderer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContactContext, StaffContext } from "@/db/tenant";
import type { InvoicePresentation } from "@/invoices/presentation";
import type { InvoiceDocumentRow } from "@/invoices/queries";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  tenantContext: vi.fn(),
  agencyAccess: vi.fn(),
  portalAccess: vi.fn(),
  agencyProfile: vi.fn(),
  getInvoiceDocument: vi.fn(),
  renderInvoicePdf: vi.fn(),
  redirect: vi.fn((to: string): never => {
    throw Object.assign(new Error("NEXT_REDIRECT"), {
      digest: `NEXT_REDIRECT;replace;${to}`,
    });
  }),
}));

class FakeResolutionError extends Error {}

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/access/gate", () => ({ agencyAccess: mocks.agencyAccess }));
vi.mock("@/portal/gate", () => ({
  portalAccess: mocks.portalAccess,
  isPortalReadable: (level: string) => level === "full" || level === "grace",
  PORTAL_UNAVAILABLE_PATH: "/portal/unavailable",
}));
vi.mock("@/db/tenant", () => ({
  tenantContext: mocks.tenantContext,
  agencyProfile: mocks.agencyProfile,
  isTenantResolutionError: (thrown: unknown) =>
    thrown instanceof FakeResolutionError,
}));
vi.mock("@/invoices/queries", () => ({
  getInvoiceDocument: mocks.getInvoiceDocument,
}));
vi.mock("./render", () => ({ renderInvoicePdf: mocks.renderInvoicePdf }));

const { handleInvoicePdfRequest } = await import("./handle-request");

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

const DOCUMENT: InvoiceDocumentRow = {
  number: 42,
  status: "sent",
  issueDate: "2026-09-01",
  dueDate: "2026-10-01",
  currency: "USD",
  taxRateBp: 725,
  subtotalCents: 180000,
  taxCents: 13050,
  totalCents: 193050,
  notes: null,
  paidAt: null,
  client: {
    name: "Northwind",
    billingAddressLine1: null,
    billingAddressLine2: null,
    billingCity: null,
    billingRegion: null,
    billingPostalCode: null,
    billingCountry: null,
  },
  lines: [],
};

const AGENCY = {
  id: "org-a",
  name: "Acme Agency",
  slug: "acme",
  defaultCurrency: "USD",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.tenantContext.mockResolvedValue(STAFF);
  mocks.agencyAccess.mockResolvedValue({ level: "full", role: "admin" });
  mocks.portalAccess.mockResolvedValue({ level: "full" });
  mocks.getInvoiceDocument.mockResolvedValue(DOCUMENT);
  mocks.agencyProfile.mockResolvedValue(AGENCY);
  mocks.renderInvoicePdf.mockResolvedValue(Buffer.from("%PDF-fake"));
});

describe("handleInvoicePdfRequest", () => {
  it("answers 404 for a non uuid id, before any session is resolved", async () => {
    const response = await handleInvoicePdfRequest("not-a-uuid");

    expect(response.status).toBe(404);
    expect(mocks.tenantContext).not.toHaveBeenCalled();
  });

  it("answers 404 when Clerk is not configured", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    const response = await handleInvoicePdfRequest(VALID_ID);

    expect(response.status).toBe(404);
    expect(mocks.tenantContext).not.toHaveBeenCalled();
  });

  it("answers 404 on a tenant resolution error, not a 500", async () => {
    mocks.tenantContext.mockRejectedValue(
      new FakeResolutionError("no_active_org"),
    );

    const response = await handleInvoicePdfRequest(VALID_ID);

    expect(response.status).toBe(404);
  });

  it("rethrows an error that is not a resolution error", async () => {
    mocks.tenantContext.mockRejectedValue(new Error("boom"));

    await expect(handleInvoicePdfRequest(VALID_ID)).rejects.toThrow("boom");
  });

  it.each(["unsubscribed", "locked"] as const)(
    "redirects staff to /billing when the gate level is %s",
    async (level) => {
      mocks.agencyAccess.mockResolvedValue({ level, role: "admin" });

      await expect(handleInvoicePdfRequest(VALID_ID)).rejects.toThrow(
        "NEXT_REDIRECT",
      );
      expect(mocks.redirect).toHaveBeenCalledWith("/billing");
      expect(mocks.getInvoiceDocument).not.toHaveBeenCalled();
    },
  );

  it.each(["full", "grace"] as const)(
    "does not redirect staff when the gate level is %s",
    async (level) => {
      mocks.agencyAccess.mockResolvedValue({ level, role: "admin" });

      const response = await handleInvoicePdfRequest(VALID_ID);

      expect(response.status).toBe(200);
    },
  );

  it("never checks the staff gate for a contact context", async () => {
    mocks.tenantContext.mockResolvedValue(CONTACT);

    const response = await handleInvoicePdfRequest(VALID_ID);

    expect(response.status).toBe(200);
    expect(mocks.agencyAccess).not.toHaveBeenCalled();
    expect(mocks.portalAccess).toHaveBeenCalledWith(CONTACT);
  });

  it.each(["unsubscribed", "locked"] as const)(
    "redirects a contact to /portal/unavailable when the gate level is %s (spec 0014, AC-13)",
    async (level) => {
      mocks.tenantContext.mockResolvedValue(CONTACT);
      mocks.portalAccess.mockResolvedValue({ level });

      await expect(handleInvoicePdfRequest(VALID_ID)).rejects.toThrow(
        "NEXT_REDIRECT",
      );
      expect(mocks.redirect).toHaveBeenCalledWith("/portal/unavailable");
      expect(mocks.getInvoiceDocument).not.toHaveBeenCalled();
    },
  );

  it.each(["full", "grace"] as const)(
    "does not redirect a contact when the gate level is %s",
    async (level) => {
      mocks.tenantContext.mockResolvedValue(CONTACT);
      mocks.portalAccess.mockResolvedValue({ level });

      const response = await handleInvoicePdfRequest(VALID_ID);

      expect(response.status).toBe(200);
    },
  );

  it("never checks the contact gate for a staff context", async () => {
    await handleInvoicePdfRequest(VALID_ID);

    expect(mocks.portalAccess).not.toHaveBeenCalled();
  });

  it("answers 404 when there is no PDF for this status or tenant", async () => {
    mocks.getInvoiceDocument.mockResolvedValue(undefined);

    const response = await handleInvoicePdfRequest(VALID_ID);

    expect(response.status).toBe(404);
  });

  it("answers 404 when the agency row cannot be read", async () => {
    mocks.agencyProfile.mockResolvedValue(undefined);

    const response = await handleInvoicePdfRequest(VALID_ID);

    expect(response.status).toBe(404);
  });

  it("answers 200 with the PDF headers on the happy path", async () => {
    const response = await handleInvoicePdfRequest(VALID_ID);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="INV-0042.pdf"',
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("%PDF-fake");
  });

  it("passes presentInvoice's rows straight through to the renderer", async () => {
    await handleInvoicePdfRequest(VALID_ID);

    const presentation = mocks.renderInvoicePdf.mock
      .calls[0]?.[0] as InvoicePresentation;

    expect(presentation.number).toBe("INV-0042");
    expect(presentation.agencyName).toBe("Acme Agency");
  });

  it("answers the 500 page with the staff link, and logs one JSON line without the presentation, when rendering throws", async () => {
    mocks.renderInvoicePdf.mockRejectedValue(new Error("font missing"));
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await handleInvoicePdfRequest(VALID_ID);

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain("The PDF could not be generated");
    expect(body).toContain("Back to the invoice");
    expect(body).not.toContain("Acme Agency");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0]?.[0] as string) as Record<
      string,
      unknown
    >;
    expect(logged.event).toBe("invoices.pdf.render_failed");
    expect(logged.invoiceId).toBe(VALID_ID);
    expect(logged.message).toBe("font missing");
    expect(typeof logged.at).toBe("string");

    errorSpy.mockRestore();
  });

  it("answers the 500 page with the portal link for a contact context", async () => {
    mocks.tenantContext.mockResolvedValue(CONTACT);
    mocks.renderInvoicePdf.mockRejectedValue(new Error("font missing"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await handleInvoicePdfRequest(VALID_ID);

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain("Back to the portal");
  });
});
