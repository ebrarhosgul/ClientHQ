/**
 * covers: spec 0014 AC-9, spec 0004 AC-22
 *
 * `portalContext` and `listPortalInvoices` are mocked (each has its own
 * tests); `PortalPagination` is stubbed to a div recording its props. This
 * file is about the page param, the empty state versus the table, and no
 * Clerk session at all (AC-22).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  portalContext: vi.fn(),
  listPortalInvoices: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/portal/context", () => ({ portalContext: mocks.portalContext }));
vi.mock("@/portal/queries", async (importActual) => {
  const actual = await importActual<typeof import("@/portal/queries")>();
  return { ...actual, listPortalInvoices: mocks.listPortalInvoices };
});
vi.mock("@/portal/ui/portal-pagination", () => ({
  PortalPagination: (props: Record<string, unknown>) => (
    <div data-testid="pagination">{JSON.stringify(props)}</div>
  ),
}));

const { default: PortalInvoicesPage } = await import("./page");

const CTX = {
  kind: "contact" as const,
  orgId: "org-1",
  userId: "user-1",
  clerkUserId: "clerk-user-1",
  clientId: "client-1",
  contactId: "contact-1",
};

const ROW = {
  id: "invoice-1",
  number: 1,
  status: "sent" as const,
  issueDate: "2026-08-01",
  dueDate: "2026-09-01",
  totalCents: 15000,
  currency: "USD",
  pastDue: false,
};

async function renderAwaited(searchParams: Record<string, string> = {}) {
  return render(
    await PortalInvoicesPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.portalContext.mockResolvedValue({
    ctx: CTX,
    access: { level: "full" },
    clientName: "Northwind Coffee",
    agencyName: "Acme Agency",
  });
  mocks.listPortalInvoices.mockResolvedValue({
    rows: [ROW],
    page: 1,
    pageCount: 1,
    total: 1,
  });
});

describe("PortalInvoicesPage", () => {
  it("renders the empty list with no Clerk key, never resolving a context or a query (AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderAwaited();

    expect(mocks.portalContext).not.toHaveBeenCalled();
    expect(mocks.listPortalInvoices).not.toHaveBeenCalled();
    expect(screen.getByText("No invoices yet")).toBeInTheDocument();
  });

  it("reads the page param out of the URL (AC-9)", async () => {
    await renderAwaited({ page: "2" });

    expect(mocks.listPortalInvoices).toHaveBeenCalledWith(CTX, {
      pageParam: 2,
    });
  });

  it("shows the table, its caption and the invoice number, status and total (AC-9)", async () => {
    await renderAwaited();

    expect(
      screen.getByRole("table", { name: "Invoices, 1 total" }),
    ).toBeInTheDocument();
    expect(screen.getByText("INV-0001")).toBeInTheDocument();
    expect(screen.getByText("$150.00")).toBeInTheDocument();
  });

  it("shows the empty state and no table when there are no rows", async () => {
    mocks.listPortalInvoices.mockResolvedValue({
      rows: [],
      page: 1,
      pageCount: 1,
      total: 0,
    });

    await renderAwaited();

    expect(screen.getByText("No invoices yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("lets a failed read propagate rather than rendering a partial list", async () => {
    const outage = new Error("connection refused");
    mocks.listPortalInvoices.mockRejectedValue(outage);

    await expect(renderAwaited()).rejects.toBe(outage);
  });
});
