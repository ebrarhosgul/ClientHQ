/**
 * covers: spec 0010 AC-7, AC-15, spec 0004 AC-22
 *
 * `getProject` and `ProjectForm` are both mocked (each has its own tests);
 * this file is about `EditProjectPage`'s own job: handing the found project
 * to the form pre-filled, on an archived project too (AC-7), and resolving
 * not found -- the same outcome for a missing id, a foreign agency's id, and
 * every id at all with no Clerk session.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  agencyContext: vi.fn(),
  getProject: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/auth/context", () => ({ agencyContext: mocks.agencyContext }));
vi.mock("@/projects/queries", async (importActual) => {
  const actual = await importActual<typeof import("@/projects/queries")>();
  return { ...actual, getProject: mocks.getProject };
});
vi.mock("@/projects/ui/project-form", () => ({
  ProjectForm: ({
    project,
  }: {
    readonly project?: { readonly name: string };
  }) => <div data-testid="project-form">{project?.name}</div>,
}));

const { default: EditProjectPage } = await import("./page");

async function renderPage(id = "project-1") {
  return render(
    await EditProjectPage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve({}),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.agencyContext.mockResolvedValue({ orgId: "org-1" });
});

describe("EditProjectPage", () => {
  it("hands the found project to the form, pre-filled (AC-7)", async () => {
    mocks.getProject.mockResolvedValue({
      id: "project-1",
      name: "Website relaunch",
    });

    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Edit Website relaunch" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("project-form")).toHaveTextContent(
      "Website relaunch",
    );
  });

  it("still succeeds for an archived project (AC-7)", async () => {
    mocks.getProject.mockResolvedValue({
      id: "project-1",
      name: "Website relaunch",
      archivedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    await renderPage();

    expect(screen.getByTestId("project-form")).toBeInTheDocument();
  });

  it("resolves not found for a missing project, the same as a foreign agency's id (AC-15)", async () => {
    mocks.getProject.mockResolvedValue(undefined);

    await expect(renderPage("someone-elses-project")).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
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
