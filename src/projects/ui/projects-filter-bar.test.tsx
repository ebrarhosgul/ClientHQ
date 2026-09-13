/**
 * covers: spec 0010 AC-4, AC-5, Value sourcing
 *
 * A plain GET form for status and client, and two links for the archived
 * toggle, all URL driven: neither carries a page number, so choosing any of
 * them always lands on page 1.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
