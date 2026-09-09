/**
 * Tests for the entry page.
 *
 * Spec 0004 pins what this page holds (AC-17) and the two paths it links to
 * (AC-23), so unlike the placeholder it replaced, these assertions are on the
 * contract rather than only on structure. The paths in particular are load
 * bearing: feature 6 builds `/sign-in` and `/sign-up` to match them.
 *
 * `ThemeControl` is an async server component that reads a cookie, so it is
 * stubbed here and tested on its own in `src/ui/patterns/theme-control.test.tsx`.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

vi.mock("@/ui/patterns/theme-control", () => ({
  ThemeControl: () => <div data-testid="theme-control" />,
}));

const { default: Home, metadata } = await import("./page");

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

  it("says in one line what the product is", () => {
    render(<Home />);

    expect(
      within(screen.getByRole("main")).getByText(/agency runs its clients/i),
    ).toBeInTheDocument();
  });

  it("offers Sign in as the primary action", () => {
    render(<Home />);

    const signIn = screen.getByRole("link", { name: "Sign in" });

    expect(signIn).toHaveAttribute("href", "/sign-in");
    expect(signIn).toHaveAttribute("data-variant", "default");
  });

  it("offers Create an agency as the secondary action", () => {
    render(<Home />);

    const signUp = screen.getByRole("link", { name: "Create an agency" });

    expect(signUp).toHaveAttribute("href", "/sign-up");
    // Secondary, so the two are not competing for the same weight.
    expect(signUp).toHaveAttribute("data-variant", "outline");
  });

  it("uses the exact paths feature 6 has to build", () => {
    // AC-23 fixes these here so that feature has nothing to choose. Changing
    // either one is a change to the spec, not to this page.
    render(<Home />);

    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href")),
    ).toEqual(["/sign-in", "/sign-up"]);
  });

  it("offers the theme control", () => {
    render(<Home />);

    expect(screen.getByTestId("theme-control")).toBeInTheDocument();
  });

  it("renders without a client side hook, so it stays a server component", () => {
    // A `use client` directive or a hook here would pull the entry page into the
    // browser bundle for no reason. Rendering with no provider proves neither.
    expect(() => render(<Home />)).not.toThrow();
  });

  it.each(THEMES)("has no axe violation in the %s theme", async (theme) => {
    const { container } = render(<Home />);

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
