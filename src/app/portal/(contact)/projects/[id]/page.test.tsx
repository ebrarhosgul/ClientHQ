/**
 * covers: spec 0014 AC-7, AC-12, spec 0004 AC-22
 *
 * `portalContext`, `getPortalProject` and `listProjectFiles` are mocked
 * (each has its own tests). This file is about `PortalProjectPage`'s own
 * job: resolving not found the same way for a hidden, foreign, missing or
 * malformed id (`getPortalProject` refuses every one of them) and for no
 * Clerk session at all (AC-22), and otherwise the project detail and its
 * files, empty or populated.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  portalContext: vi.fn(),
  getPortalProject: vi.fn(),
  listProjectFiles: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/portal/context", () => ({ portalContext: mocks.portalContext }));
vi.mock("@/portal/queries", async (importActual) => {
  const actual = await importActual<typeof import("@/portal/queries")>();
  return {
    ...actual,
    getPortalProject: mocks.getPortalProject,
    listProjectFiles: mocks.listProjectFiles,
  };
});

const { default: PortalProjectPage } = await import("./page");

const CTX = {
  kind: "contact" as const,
  orgId: "org-1",
  userId: "user-1",
  clerkUserId: "clerk-user-1",
  clientId: "client-1",
  contactId: "contact-1",
};

const PROJECT = {
  id: "project-1",
  name: "Website relaunch",
  description: "New marketing site",
  status: "in_progress" as const,
  dueDate: "2020-01-01",
  overdue: true,
};

const FILE = {
  id: "file-1",
  name: "brand-guide.pdf",
  contentType: "application/pdf",
  sizeBytes: 2048,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  projectId: "project-1",
  projectName: "Website relaunch",
};

async function renderPage(id = "project-1") {
  return render(
    await PortalProjectPage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve({}),
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
  mocks.getPortalProject.mockResolvedValue(PROJECT);
  mocks.listProjectFiles.mockResolvedValue([FILE]);
});

describe("PortalProjectPage", () => {
  it("resolves not found for a hidden, foreign, missing or malformed id, the same way (AC-7)", async () => {
    mocks.getPortalProject.mockResolvedValue(undefined);

    await expect(renderPage("someone-elses-project")).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    expect(mocks.getPortalProject).toHaveBeenCalledWith(
      CTX,
      "someone-elses-project",
    );
    expect(mocks.listProjectFiles).not.toHaveBeenCalled();
  });

  it("resolves not found with no Clerk session, never resolving a context or a query (AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await expect(renderPage()).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    expect(mocks.portalContext).not.toHaveBeenCalled();
    expect(mocks.getPortalProject).not.toHaveBeenCalled();
  });

  it("shows the project's fields, status, overdue badge and its files (AC-7)", async () => {
    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Website relaunch" }),
    ).toBeInTheDocument();
    expect(screen.getByText("New marketing site")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "brand-guide.pdf" }),
    ).toHaveAttribute("href", "/deliverables/file-1/download");
  });

  it("shows no overdue badge for a project not past its due date", async () => {
    mocks.getPortalProject.mockResolvedValue({ ...PROJECT, overdue: false });

    await renderPage();

    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });

  it("shows the no files message when nothing has been shared yet", async () => {
    mocks.listProjectFiles.mockResolvedValue([]);

    await renderPage();

    expect(
      screen.getByText("No files shared on this project yet"),
    ).toBeInTheDocument();
  });

  it("lets a failed files read propagate rather than rendering a partial page", async () => {
    const outage = new Error("connection refused");
    mocks.listProjectFiles.mockRejectedValue(outage);

    await expect(renderPage()).rejects.toBe(outage);
  });
});
