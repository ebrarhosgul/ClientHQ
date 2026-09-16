/**
 * covers: spec 0014 AC-12
 *
 * The one page every hidden, foreign, missing or malformed portal id lands
 * on, with the verbatim copy AC-12 pins.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import PortalNotFound from "./not-found";

describe("PortalNotFound", () => {
  it("shows the AC-12 heading, body and link back to the portal", () => {
    render(<PortalNotFound />);

    expect(screen.getByText("This page is not available")).toBeInTheDocument();
    expect(
      screen.getByText(
        "It may have been removed or is no longer shared with you. Ask your agency if you expected to find it here.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to your portal" }),
    ).toHaveAttribute("href", "/portal");
  });

  it("never names which case applied (hidden, foreign, missing or malformed)", () => {
    render(<PortalNotFound />);

    const alert = screen.getByRole("alert");
    expect(alert).not.toHaveTextContent(/hidden|foreign|malformed|archived/i);
  });

  it.each(THEMES)("has no axe violation, in the %s theme", async (theme) => {
    const { container } = render(<PortalNotFound />);

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
