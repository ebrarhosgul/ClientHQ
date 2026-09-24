/**
 * covers: spec 0020 AC-2, AC-8, AC-10, AC-15
 *
 * The shared frame every real section and every loading skeleton renders
 * inside: heading id wiring, the optional "view all" link, and the loading
 * region's announced label. Each section's own data shaping is covered where
 * it lives (`overdue-invoices-section.test.tsx` and its siblings).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DashboardSection,
  DashboardSectionSkeleton,
} from "./dashboard-section";

describe("DashboardSection", () => {
  it("wires the heading id to the section's aria-labelledby (AC-15)", () => {
    render(
      <DashboardSection
        headingId="heading-1"
        heading="Overdue invoices"
        countLine={<p>0 overdue invoices</p>}
      >
        <p>content</p>
      </DashboardSection>,
    );

    const section = screen.getByRole("region", { name: "Overdue invoices" });
    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Overdue invoices",
    });

    expect(heading).toHaveAttribute("id", "heading-1");
    expect(section).toHaveAttribute("aria-labelledby", "heading-1");
  });

  it("renders the count line and the section's children", () => {
    render(
      <DashboardSection
        headingId="heading-1"
        heading="Open projects"
        countLine={<p>3 open projects</p>}
      >
        <p>the rows</p>
      </DashboardSection>,
    );

    expect(screen.getByText("3 open projects")).toBeInTheDocument();
    expect(screen.getByText("the rows")).toBeInTheDocument();
  });

  it("renders no view all link when viewAll is omitted (AC-8)", () => {
    render(
      <DashboardSection
        headingId="heading-1"
        heading="Recent deliverables"
        countLine={<p>None added in the last 7 days</p>}
      >
        <p>content</p>
      </DashboardSection>,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders the view all link with its href and label when provided", () => {
    render(
      <DashboardSection
        headingId="heading-1"
        heading="Overdue invoices"
        countLine={<p>2 overdue invoices</p>}
        viewAll={{
          href: "/invoices?status=overdue",
          label: "View all overdue invoices",
        }}
      >
        <p>content</p>
      </DashboardSection>,
    );

    const link = screen.getByRole("link", {
      name: "View all overdue invoices",
    });

    expect(link).toHaveAttribute("href", "/invoices?status=overdue");
  });
});

describe("DashboardSectionSkeleton", () => {
  it("announces its loading label and keeps the same heading (AC-10, AC-15)", () => {
    render(
      <DashboardSectionSkeleton
        headingId="heading-1"
        heading="Overdue invoices"
        label="Loading overdue invoices"
      />,
    );

    const region = screen.getByRole("status");
    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Overdue invoices",
    });

    expect(region).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading overdue invoices")).toBeInTheDocument();
    expect(heading).toHaveAttribute("id", "heading-1");
  });
});
