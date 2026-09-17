/**
 * covers: spec 0014 AC-6, AC-8, AC-9
 *
 * One pager shared by the projects, files and invoices lists: nothing at
 * one page, the boundary links only where a neighbour actually exists, the
 * current page marked, an ellipsis once the run is too long to show in full,
 * and every href built from the base path with no query string on page one.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import { PortalPagination } from "./portal-pagination";

describe("PortalPagination", () => {
  it("renders nothing at a single page", () => {
    const { container } = render(
      <PortalPagination basePath="/portal/projects" page={1} pageCount={1} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("hides Previous on page one and Next on the last page", () => {
    const { rerender } = render(
      <PortalPagination basePath="/portal/projects" page={1} pageCount={3} />,
    );

    expect(
      screen.queryByRole("link", { name: "Go to previous page" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to next page" }),
    ).toBeInTheDocument();

    rerender(
      <PortalPagination basePath="/portal/projects" page={3} pageCount={3} />,
    );

    expect(
      screen.getByRole("link", { name: "Go to previous page" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Go to next page" }),
    ).not.toBeInTheDocument();
  });

  it("marks the current page and builds page one's href with no query string", () => {
    render(
      <PortalPagination basePath="/portal/files" page={2} pageCount={3} />,
    );

    expect(screen.getByRole("link", { name: "Page 2" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Page 1" })).toHaveAttribute(
      "href",
      "/portal/files",
    );
    expect(screen.getByRole("link", { name: "Page 3" })).toHaveAttribute(
      "href",
      "/portal/files?page=3",
    );
  });

  it("shows every page with no ellipsis at 7 pages or fewer", () => {
    render(
      <PortalPagination basePath="/portal/invoices" page={4} pageCount={7} />,
    );

    for (let page = 1; page <= 7; page += 1) {
      expect(
        screen.getByRole("link", { name: `Page ${page}` }),
      ).toBeInTheDocument();
    }
    expect(screen.queryByText("More pages")).not.toBeInTheDocument();
  });

  it("collapses a long run to first, last, current and one neighbour each side", () => {
    render(
      <PortalPagination basePath="/portal/invoices" page={5} pageCount={10} />,
    );

    // Kept: 1, 4, 5, 6, 10 — a gap on both sides of that run.
    for (const page of [1, 4, 5, 6, 10]) {
      expect(
        screen.getByRole("link", { name: `Page ${page}` }),
      ).toBeInTheDocument();
    }
    for (const page of [2, 3, 7, 8, 9]) {
      expect(
        screen.queryByRole("link", { name: `Page ${page}` }),
      ).not.toBeInTheDocument();
    }
    expect(screen.getAllByText("More pages")).toHaveLength(2);
  });

  it("keeps one neighbour and one ellipsis when the current page sits at an edge", () => {
    render(
      <PortalPagination basePath="/portal/invoices" page={1} pageCount={10} />,
    );

    // Kept: 1, 2, 10 — page 1 has no left neighbour and no earlier gap.
    for (const page of [1, 2, 10]) {
      expect(
        screen.getByRole("link", { name: `Page ${page}` }),
      ).toBeInTheDocument();
    }
    expect(screen.getAllByText("More pages")).toHaveLength(1);
  });

  it.each(THEMES)("has no axe violation, in the %s theme", async (theme) => {
    const { container } = render(
      <PortalPagination basePath="/portal/invoices" page={5} pageCount={10} />,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
