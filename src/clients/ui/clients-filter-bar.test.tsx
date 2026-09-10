/**
 * covers: spec 0006 AC-4, AC-5, Value sourcing
 *
 * A plain GET form and two links, entirely URL driven: no page number in
 * either, so the search box and the toggle always land on page 1.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ClientsFilterBar } from "./clients-filter-bar";

describe("ClientsFilterBar", () => {
  it("labels the search box for a screen reader, even though it looks unlabelled", () => {
    render(<ClientsFilterBar archived={false} />);

    expect(
      screen.getByRole("searchbox", { name: "Search clients by name" }),
    ).toBeInTheDocument();
  });

  it("prefills the search box from the current query", () => {
    render(<ClientsFilterBar archived={false} search="ada" />);

    expect(screen.getByRole("searchbox")).toHaveValue("ada");
  });

  it("marks Active current by default, Archived otherwise (AC-4)", () => {
    render(<ClientsFilterBar archived={false} />);

    expect(screen.getByRole("link", { name: "Active" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("link", { name: "Archived" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks Archived current when archived is true", () => {
    render(<ClientsFilterBar archived />);

    expect(screen.getByRole("link", { name: "Archived" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("link", { name: "Active" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("carries no page number in the toggle links, so switching always lands on page 1", () => {
    render(<ClientsFilterBar archived={false} search="ada" />);

    const archivedLink = screen.getByRole("link", { name: "Archived" });
    expect(archivedLink.getAttribute("href")).not.toContain("page=");
    expect(archivedLink).toHaveAttribute(
      "href",
      "/clients?q=ada&archived=true",
    );
  });

  it("plain links to /clients with no query when there is nothing to carry (AC-5)", () => {
    render(<ClientsFilterBar archived={false} />);

    expect(screen.getByRole("link", { name: "Active" })).toHaveAttribute(
      "href",
      "/clients",
    );
  });

  it("preserves the current search when switching the archived toggle (AC-5)", () => {
    render(<ClientsFilterBar archived search="ada" />);

    expect(screen.getByRole("link", { name: "Active" })).toHaveAttribute(
      "href",
      "/clients?q=ada",
    );
  });

  it("shows the hidden archived field in the search form only when archived is true", () => {
    const { container, rerender } = render(
      <ClientsFilterBar archived={false} />,
    );
    expect(container.querySelector('input[name="archived"]')).toBeNull();

    rerender(<ClientsFilterBar archived />);
    expect(container.querySelector('input[name="archived"]')).toHaveValue(
      "true",
    );
  });

  it("names the status toggle group for a screen reader", () => {
    render(<ClientsFilterBar archived={false} />);

    expect(
      screen.getByRole("group", { name: "Filter by status" }),
    ).toBeInTheDocument();
  });
});
