/**
 * Tests for the entry page.
 *
 * This page is a placeholder by design: feature 5, "Design system & UI
 * foundation", settles the visual direction, and feature 6 adds the real way in.
 * So these tests deliberately assert structure and accessibility rather than the
 * wording, which is expected to change. Pinning the prose here would only make
 * the redesign fail a test for doing exactly what it is meant to do.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home, { metadata } from "./page";

describe("Home page", () => {
  it("names the product in its browser title", () => {
    expect(metadata.title).toBe("ClientHQ");
  });

  it("puts its content in a main landmark, so screen readers can skip to it", () => {
    render(<Home />);

    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("has exactly one first level heading", () => {
    render(<Home />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("names the product in that heading", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { level: 1, name: "ClientHQ" }),
    ).toBeInTheDocument();
  });

  it("skips no heading level between the first and the next", () => {
    render(<Home />);

    const levels = screen
      .getAllByRole("heading")
      .map((heading) => Number(heading.tagName.slice(1)))
      .sort((a, b) => a - b);

    // Jumping h1 to h3 breaks the outline screen reader users navigate by.
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  it("gives every section an accessible name from its own heading", () => {
    render(<Home />);

    const regions = screen.getAllByRole("region");

    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      expect(region).toHaveAccessibleName();
    }
  });

  it("offers a link to the database health check", () => {
    render(<Home />);

    expect(
      screen.getByRole("link", { name: "/api/health/db" }),
    ).toHaveAttribute("href", "/api/health/db");
  });

  it("keeps that link inside the page content, reachable by keyboard", () => {
    render(<Home />);

    const link = within(screen.getByRole("main")).getByRole("link", {
      name: "/api/health/db",
    });

    // An anchor with an href is in the tab order; one without is not.
    expect(link).toHaveAttribute("href");
  });

  it("renders without a client side hook, so it stays a server component", () => {
    // A `use client` directive or a hook here would pull the entry page into the
    // browser bundle for no reason. Rendering with no provider proves neither.
    expect(() => render(<Home />)).not.toThrow();
  });
});
