/**
 * covers: spec 0014 AC-6, spec 0004 AC-22
 *
 * `portalContext` and `listPortalProjects` are mocked (each has its own
 * tests); `PortalPagination` is stubbed to a div recording its props, since
 * it has its own render tests. This file is about which page param
 * `PortalProjectsPage` reads out of the URL and passes on, and whether it
 * shows the empty state, the table, or the pagination for a given result.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  portalContext: vi.fn(),
  listPortalProjects: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/portal/context", () => ({ portalContext: mocks.portalContext }));
vi.mock("@/portal/queries", async (importActual) => {
  const actual = await importActual<typeof import("@/portal/queries")>();
  return { ...actual, listPortalProjects: mocks.listPortalProjects };
});
vi.mock("@/portal/ui/portal-pagination", () => ({
  PortalPagination: (props: Record<string, unknown>) => (
    <div data-testid="pagination">{JSON.stringify(props)}</div>
  ),
}));

const { default: PortalProjectsPage } = await import("./page");

const CTX = {
  kind: "contact" as const,
  orgId: "org-1",
  userId: "user-1",
  clerkUserId: "clerk-user-1",
  clientId: "client-1",
  contactId: "contact-1",
};

async function renderAwaited(searchParams: Record<string, string> = {}) {
  return render(
    await PortalProjectsPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

const ROW = {
  id: "project-1",
  name: "Website relaunch",
  description: "New marketing site",
  status: "in_progress" as const,
  dueDate: "2020-01-01",
  overdue: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.portalContext.mockResolvedValue({
    ctx: CTX,
    access: { level: "full" },
    clientName: "Northwind Coffee",
    agencyName: "Acme Agency",
  });
  mocks.listPortalProjects.mockResolvedValue({
    rows: [ROW],
    page: 1,
    pageCount: 1,
    total: 1,
  });
});

describe("PortalProjectsPage", () => {
  it("renders the empty list with no Clerk key, never resolving a context or a query (AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderAwaited();

    expect(mocks.portalContext).not.toHaveBeenCalled();
    expect(mocks.listPortalProjects).not.toHaveBeenCalled();
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
  });

  it("reads no page param by default", async () => {
    await renderAwaited();

    expect(mocks.listPortalProjects).toHaveBeenCalledWith(CTX, undefined);
  });

  it("reads the page param out of the URL (AC-6)", async () => {
    await renderAwaited({ page: "2" });

    expect(mocks.listPortalProjects).toHaveBeenCalledWith(CTX, 2);
  });

  it("shows the table, its caption, the status and the overdue badge (AC-6)", async () => {
    await renderAwaited();

    expect(
      screen.getByRole("table", { name: "Projects, 1 total" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Website relaunch")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("shows the empty state and no table when there are no rows", async () => {
    mocks.listPortalProjects.mockResolvedValue({
      rows: [],
      page: 1,
      pageCount: 1,
      total: 0,
    });

    await renderAwaited();

    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pagination")).not.toBeInTheDocument();
  });

  it("lets a failed read propagate rather than rendering a partial list", async () => {
    const outage = new Error("connection refused");
    mocks.listPortalProjects.mockRejectedValue(outage);

    await expect(renderAwaited()).rejects.toBe(outage);
  });
});
