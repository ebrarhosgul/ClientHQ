/**
 * covers: spec 0010 AC-4, AC-5, Value sourcing
 *
 * A plain GET form for status and client, and two links for the archived
 * toggle, all URL driven: neither carries a page number, so choosing any of
 * them always lands on page 1.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import { ProjectsFilterBar } from "./projects-filter-bar";

describe("ProjectsFilterBar", () => {
  it("labels the status and client pickers, defaulted from the URL", () => {
    render(
      <ProjectsFilterBar status="open" archived={false} clientOptions={[]} />,
    );

    expect(screen.getByLabelText("Status")).toHaveValue("open");
    expect(screen.getByLabelText("Client")).toHaveValue("");
  });

  it("marks an archived client in the picker (AC-5)", () => {
    render(
      <ProjectsFilterBar
        status="all"
        clientId="client-1"
        archived
        clientOptions={[
          { id: "client-1", name: "Northwind Coffee", archived: true },
        ]}
      />,
    );

    expect(
      screen.getByRole("option", { name: "Northwind Coffee (archived)" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Client")).toHaveValue("client-1");
  });

  it("marks Active current by default, Archived otherwise (AC-4)", () => {
    render(
      <ProjectsFilterBar status="open" archived={false} clientOptions={[]} />,
    );

    expect(screen.getByRole("link", { name: "Active" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("link", { name: "Archived" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks Archived current when archived is true", () => {
    render(<ProjectsFilterBar status="all" archived clientOptions={[]} />);

    expect(screen.getByRole("link", { name: "Archived" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("link", { name: "Active" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("carries no page number in the toggle links, so switching always lands on page 1", () => {
    render(
      <ProjectsFilterBar
        status="in_progress"
        statusParam="in_progress"
        clientId="client-1"
        archived={false}
        clientOptions={[]}
      />,
    );

    const archivedLink = screen.getByRole("link", { name: "Archived" });
    expect(archivedLink.getAttribute("href")).not.toContain("page=");
    expect(archivedLink).toHaveAttribute(
      "href",
      "/projects?status=in_progress&client=client-1&archived=true",
    );
  });

  it("plain link to /projects with no query when there is nothing to carry", () => {
    render(<ProjectsFilterBar status="" archived={false} clientOptions={[]} />);

    expect(screen.getByRole("link", { name: "Active" })).toHaveAttribute(
      "href",
      "/projects",
    );
  });

  it("does not write the effective open default into the Archived link when no status param is given (spec 0010, AC-4)", () => {
    render(
      <ProjectsFilterBar status="open" archived={false} clientOptions={[]} />,
    );

    expect(screen.getByRole("link", { name: "Archived" })).toHaveAttribute(
      "href",
      "/projects?archived=true",
    );
  });

  it("does not write the effective all default into the Active link when no status param is given (spec 0010, AC-4)", () => {
    render(<ProjectsFilterBar status="all" archived clientOptions={[]} />);

    expect(screen.getByRole("link", { name: "Active" })).toHaveAttribute(
      "href",
      "/projects",
    );
  });

  it("still carries an explicit status param across both toggle links", () => {
    render(
      <ProjectsFilterBar
        status="delivered"
        statusParam="delivered"
        archived={false}
        clientOptions={[]}
      />,
    );

    expect(screen.getByRole("link", { name: "Archived" })).toHaveAttribute(
      "href",
      "/projects?status=delivered&archived=true",
    );
    expect(screen.getByRole("link", { name: "Active" })).toHaveAttribute(
      "href",
      "/projects?status=delivered",
    );
  });

  it("shows the hidden archived field in the status form only when archived is true", () => {
    const { container, rerender } = render(
      <ProjectsFilterBar status="all" archived={false} clientOptions={[]} />,
    );
    expect(container.querySelector('input[name="archived"]')).toBeNull();

    rerender(<ProjectsFilterBar status="all" archived clientOptions={[]} />);
    expect(container.querySelector('input[name="archived"]')).toHaveValue(
      "true",
    );
  });

  it("names the archived toggle group for a screen reader", () => {
    render(
      <ProjectsFilterBar status="open" archived={false} clientOptions={[]} />,
    );

    expect(
      screen.getByRole("group", { name: "Filter by archived" }),
    ).toBeInTheDocument();
  });
});

describe.each(THEMES)("in the %s theme", (theme) => {
  it("has no axe violation with an empty client picker", async () => {
    const { container } = render(
      <ProjectsFilterBar status="open" archived={false} clientOptions={[]} />,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });

  it("has no axe violation with a resolved client and an archived one in the picker (AC-5)", async () => {
    const { container } = render(
      <ProjectsFilterBar
        status="all"
        statusParam="all"
        clientId="client-1"
        archived
        clientOptions={[
          { id: "client-1", name: "Northwind Coffee", archived: true },
          { id: "client-2", name: "Acme" },
        ]}
      />,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
