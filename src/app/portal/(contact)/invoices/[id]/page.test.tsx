/**
 * covers: spec 0014 AC-10, AC-12, spec 0004 AC-22
 *
 * `portalContext` and `getInvoiceDocument` are mocked (each has its own
 * tests); `InvoiceDocument` is stubbed to a div recording its props, since it
 * has its own render tests shared with the agency side. This file is about
 * `PortalInvoicePage`'s own job: resolving not found the same way for a
 * malformed id (never even reaching the database), a draft, a void, another
 * client's invoice or a missing one (`getInvoiceDocument` refuses every one
 * of them), and for no Clerk session at all (AC-22); and otherwise the past
 * due badge and the paid caption.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  portalContext: vi.fn(),
  getInvoiceDocument: vi.fn(),
  InvoiceDocument: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/portal/context", () => ({ portalContext: mocks.portalContext }));
vi.mock("@/invoices/queries", async (importActual) => {
  const actual = await importActual<typeof import("@/invoices/queries")>();
  return { ...actual, getInvoiceDocument: mocks.getInvoiceDocument };
});
vi.mock("@/invoices/ui/invoice-document", () => ({
  InvoiceDocument: (props: Record<string, unknown>) => {
    mocks.InvoiceDocument(props);

    return <div data-testid="invoice-document" />;
  },
}));

const { default: PortalInvoicePage } = await import("./page");

const CTX = {
  kind: "contact" as const,
  orgId: "org-1",
  userId: "user-1",
  clerkUserId: "clerk-user-1",
  clientId: "client-1",
  contactId: "contact-1",
};

function invoiceDocument(overrides: Record<string, unknown> = {}) {
  return {
    number: 1,
    status: "sent" as const,
    issueDate: "2026-08-01",
    dueDate: "2099-01-01",
    currency: "USD",
    taxRateBp: 0,
    subtotalCents: 15000,
    taxCents: 0,
    totalCents: 15000,
    notes: null,
    paidAt: null,
    client: { name: "Northwind Coffee" },
    lines: [],
    ...overrides,
  };
}

async function renderPage(id = "9f1c2b3a-1111-4b3a-9c3a-111111111111") {
  return render(
    await PortalInvoicePage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve({}),
    }),
  );
}

const VALID_ID = "9f1c2b3a-1111-4b3a-9c3a-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.portalContext.mockResolvedValue({
    ctx: CTX,
    access: { level: "full" },
    clientName: "Northwind Coffee",
    agencyName: "Acme Agency",
  });
  mocks.getInvoiceDocument.mockResolvedValue(invoiceDocument());
});

describe("PortalInvoicePage", () => {
  it("resolves not found for a malformed id, never reaching the database at all", async () => {
    await expect(renderPage("not-a-uuid")).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    expect(mocks.portalContext).not.toHaveBeenCalled();
    expect(mocks.getInvoiceDocument).not.toHaveBeenCalled();
  });

  it("resolves not found for a draft, a void, another client's invoice or a missing one, the same way (AC-10)", async () => {
    mocks.getInvoiceDocument.mockResolvedValue(undefined);

    await expect(renderPage(VALID_ID)).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    expect(mocks.getInvoiceDocument).toHaveBeenCalledWith(CTX, VALID_ID);
  });

  it("resolves not found with no Clerk session, never resolving a context or a query (AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await expect(renderPage(VALID_ID)).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    expect(mocks.portalContext).not.toHaveBeenCalled();
    expect(mocks.getInvoiceDocument).not.toHaveBeenCalled();
  });

  it("renders the frozen InvoiceDocument, with the agency name and the pdf link derived from the id verbatim (AC-10)", async () => {
    await renderPage(VALID_ID);

    expect(screen.getByTestId("invoice-document")).toBeInTheDocument();
    expect(mocks.InvoiceDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        agencyName: "Acme Agency",
        pdfHref: `/portal/invoices/${VALID_ID}/pdf`,
      }),
    );
  });

  it("shows the past due badge on a sent invoice overdue its due date, not on one still current (AC-12)", async () => {
    mocks.getInvoiceDocument.mockResolvedValue(
      invoiceDocument({ dueDate: "2020-01-01" }),
    );

    await renderPage(VALID_ID);

    expect(screen.getByText("Past due")).toBeInTheDocument();
  });

  it("shows no past due badge for a sent invoice not yet due", async () => {
    await renderPage(VALID_ID);

    expect(screen.queryByText("Past due")).not.toBeInTheDocument();
  });

  it("shows the paid date caption for a paid invoice", async () => {
    mocks.getInvoiceDocument.mockResolvedValue(
      invoiceDocument({
        status: "paid",
        paidAt: new Date("2026-08-15T00:00:00.000Z"),
      }),
    );

    await renderPage(VALID_ID);

    expect(screen.getByText("Paid on 2026-08-15")).toBeInTheDocument();
  });

  it("shows no paid caption for an unpaid invoice", async () => {
    await renderPage(VALID_ID);

    expect(screen.queryByText(/Paid on/)).not.toBeInTheDocument();
  });
});
