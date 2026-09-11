/**
 * covers: spec 0007 API surface, error state when the read fails; AC-19
 *
 * An unexpected failure reading the subscription row: the error state, not a
 * stack trace, with the one sentence an agency wants (nothing was charged), a
 * retry and a way back.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import BillingError from "./error";

const failure = Object.assign(new Error("connection to db-host-1 reset"), {
  digest: "1234567890",
});

describe("BillingError", () => {
  it("announces the failure as an alert, in plain words", () => {
    render(<BillingError error={failure} reset={vi.fn()} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Your billing details could not be loaded");
    expect(alert).toHaveTextContent(/nothing has been charged/i);
  });

  it("never shows the error message or its digest", () => {
    render(<BillingError error={failure} reset={vi.fn()} />);

    expect(screen.queryByText(/db-host-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1234567890/)).not.toBeInTheDocument();
  });

  it("retries through reset, not a full navigation", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    render(<BillingError error={failure} reset={reset} />);

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("offers a way back to the dashboard", () => {
    render(<BillingError error={failure} reset={vi.fn()} />);

    expect(
      screen.getByRole("link", { name: "Back to dashboard" }),
    ).toHaveAttribute("href", "/dashboard");
  });

  it("puts both ways forward on the Tab order", async () => {
    const user = userEvent.setup();
    render(<BillingError error={failure} reset={vi.fn()} />);

    await user.tab();
    expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();

    await user.tab();
    expect(
      screen.getByRole("link", { name: "Back to dashboard" }),
    ).toHaveFocus();
  });

  it.each(THEMES)(
    "has no axe violation in the %s theme (AC-19)",
    async (theme) => {
      const { container } = render(
        <BillingError error={failure} reset={vi.fn()} />,
      );

      await withTheme(theme, () => expectNoAccessibilityViolations(container));
    },
  );
});
