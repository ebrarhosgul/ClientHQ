/**
 * covers: spec 0007 AC-19, spec 0004 AC-14
 *
 * What `/billing` shows while the row is read: a real header, and one region
 * that announces the wait in words while the grey shapes inside it stay out of
 * the accessibility tree.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import BillingLoading from "./loading";

describe("BillingLoading", () => {
  it("keeps the real page title, because it is known before the query runs", () => {
    render(<BillingLoading />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Billing" }),
    ).toBeInTheDocument();
  });

  it("announces the wait once, in words, as a busy status region (AC-19)", () => {
    render(<BillingLoading />);

    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("Loading your subscription");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("hides every skeleton shape from assistive technology (spec 0004, AC-14)", () => {
    const { container } = render(<BillingLoading />);

    const shapes = container.querySelectorAll('[data-slot="skeleton"]');
    expect(shapes.length).toBeGreaterThan(0);
    shapes.forEach((shape) => {
      expect(shape).toHaveAttribute("aria-hidden", "true");
    });
  });

  it("offers nothing to click while loading, so nobody acts on a state that is not there yet", () => {
    render(<BillingLoading />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it.each(THEMES)(
    "has no axe violation in the %s theme (AC-19)",
    async (theme) => {
      const { container } = render(<BillingLoading />);

      await withTheme(theme, () => expectNoAccessibilityViolations(container));
    },
  );
});
