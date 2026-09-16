/**
 * covers: spec 0014 AC-15
 *
 * The portal's own error boundary: the error state, not a stack trace, a
 * `Try again` button, and a way back to the portal.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import PortalError from "./error";

const failure = Object.assign(new Error("connection to db-host-1 reset"), {
  digest: "1234567890",
});

describe("PortalError", () => {
  it("announces the failure as an alert", () => {
    render(<PortalError error={failure} reset={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("never shows the error message or its digest", () => {
    render(<PortalError error={failure} reset={vi.fn()} />);

    expect(screen.queryByText(/db-host-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1234567890/)).not.toBeInTheDocument();
  });

  it("retries through reset", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    render(<PortalError error={failure} reset={reset} />);

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("offers a way back to the portal", () => {
    render(<PortalError error={failure} reset={vi.fn()} />);

    expect(
      screen.getByRole("link", { name: "Back to your portal" }),
    ).toHaveAttribute("href", "/portal");
  });

  it.each(THEMES)("has no axe violation, in the %s theme", async (theme) => {
    const { container } = render(
      <PortalError error={failure} reset={vi.fn()} />,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
