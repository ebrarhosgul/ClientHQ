/**
 * covers: spec 0010 AC-1, AC-3, spec 0004 AC-22
 *
 * `listClientOptions` and `ProjectForm` are both mocked (each has its own
 * tests); this file is about `NewProjectPage`'s own job: showing a sign in
 * prompt with no Clerk session, an empty state with no active clients at all,
 * and only forwarding `?client=` as a preselection when it names one of the
 * options actually offered (AC-3).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  agencyContext: vi.fn(),
  listClientOptions: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/auth/context", () => ({ agencyContext: mocks.agencyContext }));
vi.mock("@/clients/queries", () => ({
  listClientOptions: mocks.listClientOptions,
}));
vi.mock("@/projects/ui/project-form", () => ({
  ProjectForm: (props: Record<string, unknown>) => (
    <div data-testid="project-form">{JSON.stringify(props)}</div>
  ),
}));

const { default: NewProjectPage } = await import("./page");

async function renderAwaited(searchParams: Record<string, string> = {}) {
  return render(
    await NewProjectPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

const CLIENT_OPTIONS = [
  { id: "client-1", name: "Northwind Coffee" },
  { id: "client-2", name: "Acme" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.agencyContext.mockResolvedValue({ orgId: "org-1" });
  mocks.listClientOptions.mockResolvedValue(CLIENT_OPTIONS);
});

describe("NewProjectPage", () => {
  it("shows the create form with the agency's active clients (AC-1)", async () => {
    await renderAwaited();

    expect(screen.getByTestId("project-form")).toBeInTheDocument();
    expect(mocks.listClientOptions).toHaveBeenCalledWith({ orgId: "org-1" });
  });

  it("preselects the client named by ?client= when it resolves (AC-3)", async () => {
    await renderAwaited({ client: "client-2" });

    const props = JSON.parse(
      screen.getByTestId("project-form").textContent ?? "{}",
    );
    expect(props.preselectedClientId).toBe("client-2");
  });

  it("does not preselect a client id that is not one of the options (AC-3)", async () => {
    await renderAwaited({ client: "someone-elses-client" });

    const props = JSON.parse(
      screen.getByTestId("project-form").textContent ?? "{}",
    );
    expect(props.preselectedClientId).toBeUndefined();
  });

  it("shows an empty state with no active clients, and no form", async () => {
    mocks.listClientOptions.mockResolvedValue([]);

    await renderAwaited();

    expect(screen.getByText("Add a client first")).toBeInTheDocument();
    expect(screen.queryByTestId("project-form")).not.toBeInTheDocument();
  });

  it("shows a sign in prompt instead of a form with no Clerk credentials (spec 0004, AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderAwaited();

    expect(mocks.listClientOptions).not.toHaveBeenCalled();
    expect(screen.getByText("Sign in to create a project")).toBeInTheDocument();
    expect(screen.queryByTestId("project-form")).not.toBeInTheDocument();
  });

  it("gives the page its one heading either way", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderAwaited();

    expect(
      screen.getByRole("heading", { level: 1, name: "New project" }),
    ).toBeInTheDocument();
  });
});
