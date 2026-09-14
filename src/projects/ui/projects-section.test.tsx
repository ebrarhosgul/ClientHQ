/**
 * covers: spec 0010 AC-13
 *
 * `listProjectsForClient` has its own tests, and the client page's tests
 * cover reading it once and containing a failure; this file is about
 * `ProjectsSection`'s own job: showing each row's name, status, due date and
 * overdue badge, the New project and archived links, an empty state with no
 * active projects, no New project link for an archived client (AC-3), and a
 * reload prompt when the page hands it no rows.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ClientProjectRow } from "@/projects/queries";
import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import { ProjectsSection } from "./projects-section";

const CLIENT = { id: "client-1", name: "Northwind Coffee", archivedAt: null };
const ARCHIVED_CLIENT = {
  ...CLIENT,
  archivedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const PROJECTS = [
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
] as unknown as readonly ClientProjectRow[];

describe("ProjectsSection", () => {
  it("lists each project's name, status, due date and overdue badge (AC-13)", () => {
    render(<ProjectsSection client={CLIENT} projects={PROJECTS} />);

    expect(
      screen.getByRole("link", { name: /Website relaunch/ }),
    ).toHaveAttribute("href", "/projects/p1");
    expect(screen.getByText("2026-01-01")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("No due date")).toBeInTheDocument();
  });

  it("offers a New project link pre-filled with the client, and an archived link showing every status (AC-13)", () => {
    render(<ProjectsSection client={CLIENT} projects={[]} />);

    expect(screen.getByRole("link", { name: /New project/ })).toHaveAttribute(
      "href",
      "/projects/new?client=client-1",
    );
    expect(screen.getByRole("link", { name: "View archived" })).toHaveAttribute(
      "href",
      "/projects?client=client-1&archived=true&status=all",
    );
  });

  it("shows an empty state naming the client when it has no active projects", () => {
    render(<ProjectsSection client={CLIENT} projects={[]} />);

    expect(screen.getByText("No active projects")).toBeInTheDocument();
    expect(
      screen.getByText("Northwind Coffee has no open projects yet."),
    ).toBeInTheDocument();
  });

  it("offers no New project link for an archived client, and says why in the empty state (AC-3)", () => {
    render(<ProjectsSection client={ARCHIVED_CLIENT} projects={[]} />);

    expect(
      screen.queryByRole("link", { name: /New project/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View archived" })).toHaveAttribute(
      "href",
      "/projects?client=client-1&archived=true&status=all",
    );
    expect(
      screen.getByText(
        "This client is archived, so no projects can be added until they are restored.",
      ),
    ).toBeInTheDocument();
  });

  it("still lists an archived client's projects, with a note instead of the New project link (AC-3)", () => {
    render(<ProjectsSection client={ARCHIVED_CLIENT} projects={PROJECTS} />);

    expect(
      screen.queryByRole("link", { name: /New project/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Website relaunch/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This client is archived. Restore them to add projects.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a reload prompt instead of the list when the read failed", () => {
    render(<ProjectsSection client={CLIENT} projects={undefined} />);

    expect(
      screen.getByText("Projects could not be loaded"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reload" })).toHaveAttribute(
      "href",
      "/clients/client-1",
    );
  });
});

describe.each(THEMES)("in the %s theme", (theme) => {
  it("has no axe violation with a list of projects (AC-13)", async () => {
    const { container } = render(
      <ProjectsSection client={CLIENT} projects={PROJECTS} />,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });

  it("has no axe violation when empty", async () => {
    const { container } = render(
      <ProjectsSection client={CLIENT} projects={[]} />,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });

  it("has no axe violation for an archived client with projects", async () => {
    const { container } = render(
      <ProjectsSection client={ARCHIVED_CLIENT} projects={PROJECTS} />,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });

  it("has no axe violation on the reload prompt after a failed read", async () => {
    const { container } = render(
      <ProjectsSection client={CLIENT} projects={undefined} />,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
