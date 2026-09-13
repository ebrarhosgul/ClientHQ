/**
 * covers: spec 0010 AC-13
 *
 * `listProjectsForClient` has its own tests; this file is about
 * `ProjectsSection`'s own job: showing each row's name, status, due date and
 * overdue badge, the New project and archived links, an empty state with no
 * active projects, and containing a failed read as a reload prompt rather
 * than taking the client page down -- except a tenant resolution failure,
 * which belongs to the layout and must still propagate.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agencyContext: vi.fn(),
  listProjectsForClient: vi.fn(),
}));

vi.mock("@/auth/context", () => ({ agencyContext: mocks.agencyContext }));
vi.mock("@/projects/queries", () => ({
  listProjectsForClient: mocks.listProjectsForClient,
}));

const { ProjectsSection } = await import("./projects-section");

const CLIENT = { id: "client-1", name: "Northwind Coffee" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.agencyContext.mockResolvedValue({ orgId: "org-1" });
});

describe("ProjectsSection", () => {
  it("lists each project's name, status, due date and overdue badge (AC-13)", async () => {
    mocks.listProjectsForClient.mockResolvedValue([
      {
        id: "p1",
        name: "Website relaunch",
        status: "in_progress",
        dueDate: "2026-01-01",
        overdue: true,
      },
      {
        id: "p2",
        name: "Brand refresh",
        status: "planning",
        dueDate: null,
        overdue: false,
      },
    ]);

    render(await ProjectsSection({ client: CLIENT }));

    expect(mocks.listProjectsForClient).toHaveBeenCalledWith(
      { orgId: "org-1" },
      "client-1",
      expect.any(String),
    );
    expect(
      screen.getByRole("link", { name: /Website relaunch/ }),
    ).toHaveAttribute("href", "/projects/p1");
    expect(screen.getByText("2026-01-01")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("No due date")).toBeInTheDocument();
  });

  it("offers a New project link pre-filled with the client, and an archived link (AC-13)", async () => {
    mocks.listProjectsForClient.mockResolvedValue([]);

    render(await ProjectsSection({ client: CLIENT }));

    expect(screen.getByRole("link", { name: /New project/ })).toHaveAttribute(
      "href",
      "/projects/new?client=client-1",
    );
    expect(screen.getByRole("link", { name: "View archived" })).toHaveAttribute(
      "href",
      "/projects?client=client-1&archived=true&status=all",
    );
  });

  it("shows an empty state naming the client when it has no active projects", async () => {
    mocks.listProjectsForClient.mockResolvedValue([]);

    render(await ProjectsSection({ client: CLIENT }));

    expect(screen.getByText("No active projects")).toBeInTheDocument();
    expect(
      screen.getByText("Northwind Coffee has no open projects yet."),
    ).toBeInTheDocument();
  });

  it("shows a reload prompt instead of the list when the read fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listProjectsForClient.mockRejectedValue(
      new Error("connection reset"),
    );

    render(await ProjectsSection({ client: CLIENT }));

    expect(
      screen.getByText("Projects could not be loaded"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reload" })).toHaveAttribute(
      "href",
      "/clients/client-1",
    );

    errorSpy.mockRestore();
  });

  it("lets a tenant resolution failure propagate to the layout", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const resolutionFailure = Object.assign(new Error("no session"), {
      name: "TenantResolutionError",
    });
    mocks.listProjectsForClient.mockRejectedValue(resolutionFailure);

    await expect(ProjectsSection({ client: CLIENT })).rejects.toThrow(
      resolutionFailure,
    );

    errorSpy.mockRestore();
  });
});
