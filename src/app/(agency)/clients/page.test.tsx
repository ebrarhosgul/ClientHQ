/**
 * covers: spec 0006 AC-4, AC-5, AC-13, spec 0004 AC-22
 *
 * `listClients`, `ClientsFilterBar` and `ClientsPagination` are all mocked
 * (each has its own tests); this file is only about which params
 * `ClientsPage` reads out of the URL and passes on, and which of the empty
 * state, the table, or the pagination it shows for a given result.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  agencyContext: vi.fn(),
  listClients: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/auth/context", () => ({ agencyContext: mocks.agencyContext }));
vi.mock("@/clients/queries", async (importActual) => {
  const actual = await importActual<typeof import("@/clients/queries")>();
  return { ...actual, listClients: mocks.listClients };
});
vi.mock("@/clients/ui/clients-filter-bar", () => ({
  ClientsFilterBar: (props: Record<string, unknown>) => (
    <div data-testid="filter-bar">{JSON.stringify(props)}</div>
  ),
}));
vi.mock("@/clients/ui/clients-pagination", () => ({
  ClientsPagination: (props: Record<string, unknown>) => (
    <div data-testid="pagination">{JSON.stringify(props)}</div>
  ),
}));

const { default: ClientsPage } = await import("./page");

async function renderAwaited(searchParams: Record<string, string> = {}) {
  return render(
    await ClientsPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

const ROW = {
  id: "client-1",
  name: "Northwind Coffee",
  companyEmail: "hello@northwind.example",
  phone: "555-0100",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.agencyContext.mockResolvedValue({ orgId: "org-1" });
  mocks.listClients.mockResolvedValue({
    rows: [ROW],
    page: 1,
    pageCount: 1,
    total: 1,
  });
});

describe("ClientsPage", () => {
  it("renders the empty list with no session at all when Clerk has no credentials (spec 0004, AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderAwaited();

    expect(mocks.listClients).not.toHaveBeenCalled();
    expect(screen.getByText("No clients yet")).toBeInTheDocument();
  });

  it("reads page, q and archived out of the URL and passes them to listClients", async () => {
    await renderAwaited({ page: "2", q: "ada", archived: "true" });

    expect(mocks.agencyContext).toHaveBeenCalledTimes(1);
    expect(mocks.listClients).toHaveBeenCalledWith(
      { orgId: "org-1" },
      { pageParam: "2", search: "ada", archived: true },
    );
  });

  it("treats archived as false unless the param is exactly 'true'", async () => {
    await renderAwaited({ archived: "yes" });

    expect(mocks.listClients).toHaveBeenCalledWith(
      { orgId: "org-1" },
      { pageParam: undefined, search: undefined, archived: false },
    );
  });

  it("shows the table and its caption when there are rows (AC-4)", async () => {
    await renderAwaited();

    expect(
      screen.getByRole("table", { name: "Active clients, 1 total" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Northwind Coffee")).toBeInTheDocument();
    expect(screen.getByText("hello@northwind.example")).toBeInTheDocument();
  });

  it("shows the default empty state, with a New client action, for a brand new agency (AC-13)", async () => {
    mocks.listClients.mockResolvedValue({
      rows: [],
      page: 1,
      pageCount: 1,
      total: 0,
    });

    await renderAwaited();

    expect(screen.getByText("No clients yet")).toBeInTheDocument();
    // One in the page header, and a second inside the empty state itself.
    expect(screen.getAllByRole("link", { name: /new client/i })).toHaveLength(
      2,
    );
  });

  it("shows the search specific empty state, with no action, when a search matches nothing (AC-5)", async () => {
    mocks.listClients.mockResolvedValue({
      rows: [],
      page: 1,
      pageCount: 1,
      total: 0,
    });

    await renderAwaited({ q: "nobody" });

    expect(
      screen.getByText("No clients match your search"),
    ).toBeInTheDocument();
    // Only the page header's, since a filtered empty state offers no action.
    expect(screen.getAllByRole("link", { name: /new client/i })).toHaveLength(
      1,
    );
  });

  it("shows the archived specific empty state when the archived filter has no rows", async () => {
    mocks.listClients.mockResolvedValue({
      rows: [],
      page: 1,
      pageCount: 1,
      total: 0,
    });

    await renderAwaited({ archived: "true" });

    expect(screen.getByText("No archived clients")).toBeInTheDocument();
  });
});
