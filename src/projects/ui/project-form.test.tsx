/**
 * covers: spec 0010 AC-1, AC-2, AC-3, AC-7
 *
 * `createProject` and `updateProject` are mocked (each has its own tests
 * already); this file is about the form's own job: which action it calls in
 * which mode, only offering active clients on create, showing a field error
 * beside its field while keeping what was typed, clearing the due date on
 * edit, and navigating to the saved project on success.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientOption } from "@/clients/queries";
import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import type { ProjectDetail } from "../queries";

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
  push: vi.fn(),
}));

vi.mock("../create-project", () => ({ createProject: mocks.createProject }));
vi.mock("../update-project", () => ({ updateProject: mocks.updateProject }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

const { ProjectForm } = await import("./project-form");

const CLIENT_OPTIONS: readonly ClientOption[] = [
  { id: "client-1", name: "Northwind Coffee" },
  { id: "client-2", name: "Acme" },
];

const PROJECT: ProjectDetail = {
  id: "p1",
  orgId: "org-1",
  clientId: "client-1",
  clientName: "Northwind Coffee",
  name: "Website relaunch",
  description: "New marketing site",
  status: "planning",
  dueDate: "2026-03-01",
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProjectForm, creating", () => {
  it("only offers the agency's active clients, none preselected by default (AC-3)", () => {
    render(<ProjectForm clientOptions={CLIENT_OPTIONS} />);

    const select = screen.getByRole("combobox", { name: /client/i });
    expect(select).toHaveValue("");
    expect(
      screen.getByRole("option", { name: "Northwind Coffee" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create project" }),
    ).toBeInTheDocument();
  });

  it("preselects the client named by the URL when it resolves (AC-3)", () => {
    render(
      <ProjectForm
        clientOptions={CLIENT_OPTIONS}
        preselectedClientId="client-2"
      />,
    );

    expect(screen.getByRole("combobox", { name: /client/i })).toHaveValue(
      "client-2",
    );
  });

  it("creates a project with just a client and a name, then navigates to it (AC-1)", async () => {
    const user = userEvent.setup();
    mocks.createProject.mockResolvedValue({ ok: true, data: { id: "new-1" } });

    render(<ProjectForm clientOptions={CLIENT_OPTIONS} />);
    await user.selectOptions(
      screen.getByRole("combobox", { name: /client/i }),
      "client-1",
    );
    await user.type(
      screen.getByRole("textbox", { name: /project name/i }),
      "Website relaunch",
    );
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(mocks.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-1",
        name: "Website relaunch",
      }),
    );
    expect(mocks.updateProject).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("/projects/new-1");
  });

  it("shows a field error beside its field and keeps what was typed (AC-2)", async () => {
    const user = userEvent.setup();
    mocks.createProject.mockResolvedValue({
      ok: false,
      error: {
        code: "validation",
        message: "",
        fieldErrors: { name: ["Enter a name."] },
      },
    });

    render(<ProjectForm clientOptions={CLIENT_OPTIONS} />);
    await user.selectOptions(
      screen.getByRole("combobox", { name: /client/i }),
      "client-1",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Description" }),
      "Draft notes",
    );
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByText("Enter a name.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
      "Draft notes",
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("shows a non field failure as an alert", async () => {
    const user = userEvent.setup();
    mocks.createProject.mockResolvedValue({
      ok: false,
      error: { code: "not_found", message: "" },
    });

    render(<ProjectForm clientOptions={CLIENT_OPTIONS} />);
    await user.selectOptions(
      screen.getByRole("combobox", { name: /client/i }),
      "client-1",
    );
    await user.type(
      screen.getByRole("textbox", { name: /project name/i }),
      "Website relaunch",
    );
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That is not here any more. It may have been removed.",
    );
  });
});

describe("ProjectForm, editing", () => {
  it("prefills every field from the project, showing the client as read only text (AC-7)", () => {
    render(<ProjectForm project={PROJECT} />);

    expect(screen.getByRole("textbox", { name: /project name/i })).toHaveValue(
      "Website relaunch",
    );
    expect(screen.getByText("Northwind Coffee")).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: /client/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
  });

  it("turns a null description into an empty string rather than the literal 'null'", () => {
    render(<ProjectForm project={{ ...PROJECT, description: null }} />);

    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
      "",
    );
  });

  it("saves an edit through updateProject, carrying the project's id (AC-7)", async () => {
    const user = userEvent.setup();
    mocks.updateProject.mockResolvedValue({ ok: true, data: { id: "p1" } });

    render(<ProjectForm project={PROJECT} />);
    await user.clear(screen.getByRole("textbox", { name: /project name/i }));
    await user.type(
      screen.getByRole("textbox", { name: /project name/i }),
      "Renamed",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(mocks.updateProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p1", name: "Renamed" }),
    );
    expect(mocks.createProject).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("/projects/p1");
  });

  it("saves a cleared due date as an empty string (AC-7)", async () => {
    const user = userEvent.setup();
    mocks.updateProject.mockResolvedValue({ ok: true, data: { id: "p1" } });

    render(<ProjectForm project={PROJECT} />);
    await user.clear(screen.getByLabelText("Due date"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(mocks.updateProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p1", dueDate: "" }),
    );
  });
});

describe.each(THEMES)("in the %s theme", (theme) => {
  it("has no axe violation creating, including the client select's disabled placeholder option (AC-1, AC-3)", async () => {
    const { container } = render(
      <ProjectForm clientOptions={CLIENT_OPTIONS} />,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });

  it("has no axe violation editing, with the client shown as read only text (AC-7)", async () => {
    const { container } = render(<ProjectForm project={PROJECT} />);

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });

  it("has no axe violation with a field error shown beside its field (AC-2)", async () => {
    const user = userEvent.setup();
    mocks.createProject.mockResolvedValue({
      ok: false,
      error: {
        code: "validation",
        message: "",
        fieldErrors: { name: ["Enter a name."] },
      },
    });

    const { container } = render(
      <ProjectForm clientOptions={CLIENT_OPTIONS} />,
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: /client/i }),
      "client-1",
    );
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await screen.findByText("Enter a name.");

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
