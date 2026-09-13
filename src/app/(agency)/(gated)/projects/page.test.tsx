/**
 * covers: spec 0010 AC-4, AC-5, spec 0004 AC-22
 *
 * `listProjects`, `listClientOptions`, `getClient`, `ProjectsFilterBar` and
 * `ProjectsPagination` are all mocked (each has its own tests); this file is
 * only about which params `ProjectsPage` reads out of the URL and passes on,
 * how it resolves the `client` filter, and which of the empty state, the
 * table, or the pagination it shows for a given result.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  agencyContext: vi.fn(),
  listProjects: vi.fn(),
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
vi.mock("@/projects/queries", async (importActual) => {
  const actual = await importActual<typeof import("@/projects/queries")>();
  return { ...actual, listProjects: mocks.listProjects };
});
vi.mock("@/projects/ui/projects-filter-bar", () => ({
  ProjectsFilterBar: (props: Record<string, unknown>) => (
    <div data-testid="filter-bar">{JSON.stringify(props)}</div>
  ),
}));
vi.mock("@/projects/ui/projects-pagination", () => ({
  ProjectsPagination: (props: Record<string, unknown>) => (
    <div data-testid="pagination">{JSON.stringify(props)}</div>
  ),
}));

const { default: ProjectsPage } = await import("./page");

async function renderAwaited(searchParams: Record<string, string> = {}) {
  return render(
    await ProjectsPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

const ROW = {
  id: "project-1",
  name: "Website relaunch",
  clientName: "Northwind Coffee",
  status: "in_progress",
  dueDate: "2026-01-01",
  overdue: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.agencyContext.mockResolvedValue({ orgId: "org-1" });
  mocks.listClientOptions.mockResolvedValue([]);
  mocks.getClient.mockResolvedValue(undefined);
  mocks.listProjects.mockResolvedValue({
    rows: [ROW],
    page: 1,
    pageCount: 1,
    total: 1,
  });
});

describe("ProjectsPage", () => {
  it("renders the empty list with no session at all when Clerk has no credentials (spec 0004, AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderAwaited();

    expect(mocks.listProjects).not.toHaveBeenCalled();
    expect(mocks.listClientOptions).not.toHaveBeenCalled();
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
  });

  it("defaults status to open when there is no archived filter", async () => {
    await renderAwaited();

    expect(mocks.listProjects).toHaveBeenCalledWith(
      { orgId: "org-1" },
      expect.objectContaining({
        statusParam: undefined,
        archived: false,
        pageParam: undefined,
        clientParam: undefined,
      }),
    );
  });

  it("reads page, status, client and archived out of the URL (AC-4, AC-5)", async () => {
    await renderAwaited({
      page: "2",
      status: "in_review",
      client: "client-9",
      archived: "true",
    });

    expect(mocks.listProjects).toHaveBeenCalledWith(
      { orgId: "org-1" },
      expect.objectContaining({
        pageParam: "2",
        statusParam: "in_review",
        clientParam: "client-9",
        archived: true,
      }),
    );
  });

  it("resolves an active client filter and marks it archived when it is (AC-5)", async () => {
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

  it("clears the client filter from the picker when it does not resolve (AC-5)", async () => {
    mocks.getClient.mockResolvedValue(undefined);

    await renderAwaited({ client: "not-a-real-client" });

    const filterBar = JSON.parse(
      screen.getByTestId("filter-bar").textContent ?? "{}",
    );
    expect(filterBar.clientId).toBeUndefined();
  });

  it("shows the table and its caption, with the overdue badge, when there are rows (AC-4)", async () => {
    await renderAwaited();

    expect(
      screen.getByRole("table", { name: "Active projects, 1 total" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Website relaunch")).toBeInTheDocument();
    expect(screen.getByText("Northwind Coffee")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("shows the default empty state, with a New project action, when there is no filter", async () => {
    mocks.listProjects.mockResolvedValue({
      rows: [],
      page: 1,
      pageCount: 1,
      total: 0,
    });

    await renderAwaited();

    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /new project/i })).toHaveLength(
      2,
    );
  });

  it("shows the filtered empty state, with no action, once a filter is applied", async () => {
    mocks.listProjects.mockResolvedValue({
      rows: [],
      page: 1,
      pageCount: 1,
      total: 0,
    });

    await renderAwaited({ status: "delivered" });

    expect(
      screen.getByText("No projects match these filters"),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /new project/i })).toHaveLength(
      1,
    );
  });
});
