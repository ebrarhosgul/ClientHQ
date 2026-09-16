/**
 * covers: spec 0012 AC-10, AC-12, spec 0004 AC-22
 *
 * `listInvoices`, `listClientOptions`, `getClient`, `InvoicesFilterBar` and
 * `InvoicesPagination` are all mocked (each has its own tests); this file is
 * only about which params `InvoicesPage` reads out of the URL and passes on,
 * how it resolves the `client` filter, and which of the empty state, the
 * table, or the pagination it shows for a given result.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  agencyContext: vi.fn(),
  listInvoices: vi.fn(),
  listClientOptions: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/auth/context", () => ({ agencyContext: mocks.agencyContext }));
vi.mock("@/clients/queries", async (importActual) => {
  const actual = await importActual<typeof import("@/clients/queries")>();
  return {
    ...actual,
    listClientOptions: mocks.listClientOptions,
    getClient: mocks.getClient,
  };
});
vi.mock("@/invoices/queries", async (importActual) => {
  const actual = await importActual<typeof import("@/invoices/queries")>();
  return { ...actual, listInvoices: mocks.listInvoices };
});
vi.mock("@/invoices/ui/invoices-filter-bar", () => ({
  InvoicesFilterBar: (props: Record<string, unknown>) => (
    <div data-testid="filter-bar">{JSON.stringify(props)}</div>
  ),
}));
vi.mock("@/invoices/ui/invoices-pagination", () => ({
  InvoicesPagination: (props: Record<string, unknown>) => (
    <div data-testid="pagination">{JSON.stringify(props)}</div>
  ),
}));

const { default: InvoicesPage } = await import("./page");

async function renderAwaited(searchParams: Record<string, string> = {}) {
  return render(
    await InvoicesPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

const ROW = {
  id: "invoice-1",
  number: 1,
  clientName: "Northwind Coffee",
  status: "sent",
  totalCents: 15000,
  currency: "USD",
  issueDate: "2026-08-01",
  dueDate: "2026-08-31",
  pastDue: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.agencyContext.mockResolvedValue({ orgId: "org-1" });
  mocks.listClientOptions.mockResolvedValue([]);
  mocks.getClient.mockResolvedValue(undefined);
  mocks.listInvoices.mockResolvedValue({
    rows: [ROW],
    page: 1,
    pageCount: 1,
    total: 1,
  });
});

describe("InvoicesPage", () => {
  it("renders the empty list with no session at all when Clerk has no credentials (spec 0004, AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderAwaited();

    expect(mocks.listInvoices).not.toHaveBeenCalled();
    expect(mocks.listClientOptions).not.toHaveBeenCalled();
    expect(screen.getByText("No invoices yet")).toBeInTheDocument();
  });

  it("defaults to every status but void, with no page or client filter", async () => {
    await renderAwaited();

    expect(mocks.listInvoices).toHaveBeenCalledWith(
      { orgId: "org-1" },
      expect.objectContaining({
        pageParam: undefined,
        statusParam: undefined,
        clientParam: undefined,
        includeVoid: false,
      }),
    );
  });

  it("reads page, status, client and the void toggle out of the URL (AC-10)", async () => {
    await renderAwaited({
      page: "2",
      status: "paid",
      client: "client-9",
      void: "true",
    });

    expect(mocks.listInvoices).toHaveBeenCalledWith(
      { orgId: "org-1" },
      expect.objectContaining({
        pageParam: "2",
        statusParam: "paid",
        clientParam: "client-9",
        includeVoid: true,
      }),
    );
  });

  it("ignores a status param that is not a real invoice status", async () => {
    await renderAwaited({ status: "cancelled" });

    expect(mocks.listInvoices).toHaveBeenCalledWith(
      { orgId: "org-1" },
      expect.objectContaining({ statusParam: undefined }),
    );
  });

  it("resolves an active client filter and marks it archived when it is (AC-10)", async () => {
    mocks.getClient.mockResolvedValue({
      id: "client-9",
      name: "Old Co",
      archivedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    await renderAwaited({ client: "client-9" });

    const filterBar = JSON.parse(
      screen.getByTestId("filter-bar").textContent ?? "{}",
    );
    expect(filterBar.clientId).toBe("client-9");
    expect(filterBar.clientOptions).toContainEqual({
      id: "client-9",
      name: "Old Co",
      archived: true,
    });
  });

  it("clears the client filter from the picker when it does not resolve", async () => {
    mocks.getClient.mockResolvedValue(undefined);

    await renderAwaited({ client: "not-a-real-client" });

    const filterBar = JSON.parse(
      screen.getByTestId("filter-bar").textContent ?? "{}",
    );
    expect(filterBar.clientId).toBeUndefined();
  });

  it("shows the table, its caption, the invoice number and the past due badge (AC-10, AC-12)", async () => {
    await renderAwaited();

    expect(
      screen.getByRole("table", { name: "Invoices, 1 total" }),
    ).toBeInTheDocument();
    expect(screen.getByText("INV-0001")).toBeInTheDocument();
    expect(screen.getByText("Northwind Coffee")).toBeInTheDocument();
    expect(screen.getByText("Past due")).toBeInTheDocument();
  });

  it("shows Draft, not a number, for an unissued row", async () => {
    mocks.listInvoices.mockResolvedValue({
      rows: [{ ...ROW, number: null, pastDue: false }],
      page: 1,
      pageCount: 1,
      total: 1,
    });

    await renderAwaited();

    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.queryByText("Past due")).not.toBeInTheDocument();
  });

  it("shows the default empty state, with a New invoice action, when there is no filter", async () => {
    mocks.listInvoices.mockResolvedValue({
      rows: [],
      page: 1,
      pageCount: 1,
      total: 0,
    });

    await renderAwaited();

    expect(screen.getByText("No invoices yet")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /new invoice/i })).toHaveLength(
      2,
    );
  });

  it("shows the filtered empty state, with a clear filters action, once a filter is applied", async () => {
    mocks.listInvoices.mockResolvedValue({
      rows: [],
      page: 1,
      pageCount: 1,
      total: 0,
    });

    await renderAwaited({ status: "paid" });

    expect(
      screen.getByText("No invoices match these filters"),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /new invoice/i })).toHaveLength(
      1,
    );
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute(
      "href",
      "/invoices",
    );
  });

  it("treats the void toggle alone as a filter for the empty state", async () => {
    mocks.listInvoices.mockResolvedValue({
      rows: [],
      page: 1,
      pageCount: 1,
      total: 0,
    });

    await renderAwaited({ void: "true" });

    expect(
      screen.getByText("No invoices match these filters"),
    ).toBeInTheDocument();
  });
});
