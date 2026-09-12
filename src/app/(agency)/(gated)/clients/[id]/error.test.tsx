/**
 * covers: spec 0006 AC-13
 *
 * An unexpected read failure on the detail page: the error state, not a
 * stack trace or a blank screen, with a way back and a way to retry.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_ERROR_HEADING } from "@/ui/patterns/error-state";
import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import ClientError from "./error";

describe("ClientError", () => {
  it("announces the failure rather than showing a stack trace (AC-13)", () => {
    render(<ClientError error={new Error("boom")} reset={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent(DEFAULT_ERROR_HEADING);
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
  });

  it("retries through reset, not a full navigation", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    render(<ClientError error={new Error("boom")} reset={reset} />);

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("offers a way back to the client list", () => {
    render(<ClientError error={new Error("boom")} reset={vi.fn()} />);

    expect(
      screen.getByRole("link", { name: "Back to clients" }),
    ).toHaveAttribute("href", "/clients");
  });

  it.each(THEMES)(
    "has no axe violation in the %s theme (AC-13)",
    async (theme) => {
      const { container } = render(
        <ClientError error={new Error("boom")} reset={vi.fn()} />,
      );

      await withTheme(theme, () => expectNoAccessibilityViolations(container));
    },
  );
});
