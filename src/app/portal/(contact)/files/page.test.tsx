/**
 * covers: spec 0014 AC-8, spec 0004 AC-22
 *
 * `portalContext` and `listPortalFiles` are mocked (each has its own tests,
 * as does `groupFilesByProject`, kept real here since it is a pure grouping
 * of the rows this file already controls); `PortalPagination` is stubbed to
 * a div recording its props. This file is about the page param, the empty
 * state versus the grouped sections, and no Clerk session at all (AC-22).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  portalContext: vi.fn(),
  listPortalFiles: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/portal/context", () => ({ portalContext: mocks.portalContext }));
vi.mock("@/portal/queries", async (importActual) => {
  const actual = await importActual<typeof import("@/portal/queries")>();
  return { ...actual, listPortalFiles: mocks.listPortalFiles };
});
vi.mock("@/portal/ui/portal-pagination", () => ({
  PortalPagination: (props: Record<string, unknown>) => (
    <div data-testid="pagination">{JSON.stringify(props)}</div>
  ),
}));

const { default: PortalFilesPage } = await import("./page");

const CTX = {
  kind: "contact" as const,
  orgId: "org-1",
  userId: "user-1",
  clerkUserId: "clerk-user-1",
  clientId: "client-1",
  contactId: "contact-1",
};

const FILE_A = {
  id: "file-1",
  name: "brand-guide.pdf",
  contentType: "application/pdf",
  sizeBytes: 2048,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  projectId: "project-1",
  projectName: "Website relaunch",
};

const FILE_B = {
  id: "file-2",
  name: "logo.png",
  contentType: "image/png",
  sizeBytes: 4096,
  createdAt: new Date("2026-08-02T00:00:00.000Z"),
  projectId: "project-2",
  projectName: "Rebrand",
};

async function renderAwaited(searchParams: Record<string, string> = {}) {
  return render(
    await PortalFilesPage({
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
  mocks.listPortalFiles.mockResolvedValue({
    rows: [FILE_A, FILE_B],
    page: 1,
    pageCount: 1,
    total: 2,
  });
});

describe("PortalFilesPage", () => {
  it("renders the empty list with no Clerk key, never resolving a context or a query (AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderAwaited();

    expect(mocks.portalContext).not.toHaveBeenCalled();
    expect(mocks.listPortalFiles).not.toHaveBeenCalled();
    expect(screen.getByText("No files shared yet")).toBeInTheDocument();
  });

  it("reads the page param out of the URL (AC-8)", async () => {
    await renderAwaited({ page: "2" });

    expect(mocks.listPortalFiles).toHaveBeenCalledWith(CTX, 2);
  });

  it("groups the files under a heading per project (AC-8)", async () => {
    await renderAwaited();

    expect(
      screen.getByRole("heading", { level: 2, name: "Website relaunch" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Rebrand" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "brand-guide.pdf" }),
    ).toHaveAttribute("href", "/deliverables/file-1/download");
    expect(screen.getByTestId("pagination")).toBeInTheDocument();
  });

  it("shows the empty state and no pagination when there are no rows", async () => {
    mocks.listPortalFiles.mockResolvedValue({
      rows: [],
      page: 1,
      pageCount: 1,
      total: 0,
    });

    await renderAwaited();

    expect(screen.getByText("No files shared yet")).toBeInTheDocument();
    expect(screen.queryByTestId("pagination")).not.toBeInTheDocument();
  });

  it("lets a failed read propagate rather than rendering a partial list", async () => {
    const outage = new Error("connection refused");
    mocks.listPortalFiles.mockRejectedValue(outage);

    await expect(renderAwaited()).rejects.toBe(outage);
  });
});
