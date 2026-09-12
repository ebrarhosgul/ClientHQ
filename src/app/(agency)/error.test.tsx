/**
 * covers: spec 0008 AC-12, AC-14
 *
 * The agency area's error boundary, which is where a failed subscription read
 * in the gated layout lands: the error state, not a stack trace, a retry, and
 * a way to billing, since that page has its own read and its own boundary.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import AgencyError from "./error";

const failure = Object.assign(new Error("connection to db-host-1 reset"), {
  digest: "1234567890",
});

describe("AgencyError", () => {
  it("announces the failure as an alert, and says the subscription is not affected", () => {
    render(<AgencyError error={failure} reset={vi.fn()} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
    expect(alert).toHaveTextContent(/subscription is not affected/i);
  });

  it("never shows the error message or its digest", () => {
    render(<AgencyError error={failure} reset={vi.fn()} />);

    expect(screen.queryByText(/db-host-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1234567890/)).not.toBeInTheDocument();
  });

  it("retries through reset", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    render(<AgencyError error={failure} reset={reset} />);

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("offers billing as the way out, the one page outside the gate", () => {
    render(<AgencyError error={failure} reset={vi.fn()} />);

    expect(screen.getByRole("link", { name: "Open billing" })).toHaveAttribute(
      "href",
      "/billing",
    );
  });

  it.each(THEMES)(
    "has no axe violation in the %s theme (AC-14)",
    async (theme) => {
      const { container } = render(
        <AgencyError error={failure} reset={vi.fn()} />,
      );

      await withTheme(theme, () => expectNoAccessibilityViolations(container));
    },
  );
});
