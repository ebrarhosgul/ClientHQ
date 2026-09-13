/**
 * covers: spec 0010 AC-6, AC-10, AC-11, AC-12, AC-15, spec 0004 AC-22
 *
 * `getProject` and the action buttons are mocked (each has its own tests);
 * this file is about which fields `ProjectDetailPage` shows, which of the
 * archive/restore controls it renders for an admin versus a member (AC-12),
 * that an archived project hides the move buttons (AC-10), and that a
 * missing project -- which includes another agency's id, and every id at all
 * with no Clerk session -- resolves not found (AC-15).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  agencyContext: vi.fn(),
  getProject: vi.fn(),
  todayUtc: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/auth/context", () => ({ agencyContext: mocks.agencyContext }));
vi.mock("@/projects/queries", async (importActual) => {
  const actual = await importActual<typeof import("@/projects/queries")>();
  return { ...actual, getProject: mocks.getProject };
});
vi.mock("@/projects/status", async (importActual) => {
  const actual = await importActual<typeof import("@/projects/status")>();
  return { ...actual, todayUtc: mocks.todayUtc };
});
vi.mock("@/projects/ui/archive-project-button", () => ({
  ArchiveProjectButton: () => <button type="button">Archive</button>,
}));
vi.mock("@/projects/ui/restore-project-button", () => ({
  RestoreProjectButton: () => <button type="button">Restore</button>,
}));
vi.mock("@/projects/ui/project-status-actions", () => ({
  ProjectStatusActions: () => (
    <div role="group" aria-label="Move this project" />
  ),
}));

const { default: ProjectDetailPage } = await import("./page");

const ACTIVE_PROJECT = {
  id: "project-1",
  clientId: "client-1",
  clientName: "Northwind Coffee",
  name: "Website relaunch",
  description: "New marketing site",
  status: "in_progress" as const,
  dueDate: "2026-06-01",
  archivedAt: null,
};

async function renderPage(id = "project-1") {
  return render(
    await ProjectDetailPage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve({}),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.agencyContext.mockResolvedValue({ orgId: "org-1", role: "admin" });
  mocks.todayUtc.mockReturnValue("2026-01-01");
});

describe("ProjectDetailPage", () => {
  it("shows every field and the Archive action for an admin, with the move buttons (AC-6)", async () => {
    mocks.getProject.mockResolvedValue(ACTIVE_PROJECT);

    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Website relaunch" }),
    ).toBeInTheDocument();
    expect(screen.getByText("New marketing site")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Northwind Coffee" }),
    ).toHaveAttribute("href", "/clients/client-1");
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Restore" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Move this project" }),
    ).toBeInTheDocument();
  });

  it("hides Archive and Restore for a member (AC-12)", async () => {
    mocks.getProject.mockResolvedValue(ACTIVE_PROJECT);
    mocks.agencyContext.mockResolvedValue({ orgId: "org-1", role: "member" });

    await renderPage();

    expect(
      screen.queryByRole("button", { name: "Archive" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Restore" }),
    ).not.toBeInTheDocument();
  });

  it("shows the Archived badge, the Restore action, and hides the move buttons (AC-10, AC-11)", async () => {
    mocks.getProject.mockResolvedValue({
      ...ACTIVE_PROJECT,
      archivedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    await renderPage();

    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Archive" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Archived").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("group", { name: "Move this project" }),
    ).not.toBeInTheDocument();
  });

  it("shows the overdue badge for a past due date on an open project (AC-6)", async () => {
    mocks.getProject.mockResolvedValue({
      ...ACTIVE_PROJECT,
      dueDate: "2025-12-31",
    });
    mocks.todayUtc.mockReturnValue("2026-01-01");

    await renderPage();

    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("shows no overdue badge for a due date of today", async () => {
    mocks.getProject.mockResolvedValue({
      ...ACTIVE_PROJECT,
      dueDate: "2026-01-01",
    });
    mocks.todayUtc.mockReturnValue("2026-01-01");

    await renderPage();

    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });

  it("resolves not found for a missing project, the same as a foreign agency's id (AC-15)", async () => {
    mocks.getProject.mockResolvedValue(undefined);

    await expect(renderPage("someone-elses-project")).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    expect(mocks.getProject).toHaveBeenCalledWith(
      { orgId: "org-1", role: "admin" },
      "someone-elses-project",
    );
  });

  it("resolves not found with no Clerk session, never resolving a query at all (spec 0004, AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await expect(renderPage()).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    expect(mocks.agencyContext).not.toHaveBeenCalled();
    expect(mocks.getProject).not.toHaveBeenCalled();
  });
});
