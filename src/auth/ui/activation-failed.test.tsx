/**
 * covers: spec 0005 AC-18
 *
 * What a failed `setActive()` looks like: beside the thing that failed, never
 * only in a toast, with the one action that helps.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ActivationFailed } from "./activation-failed";

describe("ActivationFailed", () => {
  it("names the agency it could not open", () => {
    render(<ActivationFailed name="Northwind" onRetry={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "We could not switch you into Northwind.",
    );
  });

  it("falls back to a name free sentence when there is nothing to name", () => {
    render(<ActivationFailed name={undefined} onRetry={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "We could not switch you into that agency.",
    );
  });

  it("says nothing was lost, and offers to try again", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(<ActivationFailed name="Northwind" onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Nothing was lost.");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
