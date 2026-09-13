/**
 * covers: spec 0010 AC-17
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

import ProjectError from "./error";

describe("ProjectError", () => {
  it("announces the failure rather than showing a stack trace", () => {
    render(<ProjectError error={new Error("boom")} reset={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent(DEFAULT_ERROR_HEADING);
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
  });

  it("retries through reset, not a full navigation", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    render(<ProjectError error={new Error("boom")} reset={reset} />);

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("offers a way back to the projects list", () => {
    render(<ProjectError error={new Error("boom")} reset={vi.fn()} />);

    expect(
      screen.getByRole("link", { name: "Back to projects" }),
    ).toHaveAttribute("href", "/projects");
  });

  it.each(THEMES)(
    "has no axe violation in the %s theme (AC-17)",
    async (theme) => {
      const { container } = render(
        <ProjectError error={new Error("boom")} reset={vi.fn()} />,
      );

      await withTheme(theme, () => expectNoAccessibilityViolations(container));
    },
  );
});
