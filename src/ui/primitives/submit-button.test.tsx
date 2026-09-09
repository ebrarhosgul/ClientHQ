import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import { SubmitButton } from "./submit-button";

/**
 * `useFormStatus` reads the state of the enclosing `<form>`, so every case
 * needs a real form with a real (if deferred) action, not just the button in
 * isolation.
 */
function DeferredForm({
  action,
  ...props
}: { readonly action: () => Promise<void> } & Omit<
  Parameters<typeof SubmitButton>[0],
  "children"
> & { readonly children?: React.ReactNode }) {
  return (
    <form action={action}>
      <SubmitButton {...props}>Save client</SubmitButton>
    </form>
  );
}

function deferred(): {
  readonly action: () => Promise<void>;
  readonly resolve: () => void;
} {
  let resolve!: () => void;
  const action = () =>
    new Promise<void>((res) => {
      resolve = res;
    });

  return { action, resolve: () => resolve() };
}

describe("SubmitButton", () => {
  it("renders its children and a submit type while idle", () => {
    const { action } = deferred();
    render(<DeferredForm action={action} />);

    const button = screen.getByRole("button", { name: "Save client" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("swaps to the pending label and disables itself once its form is in flight", async () => {
    const user = userEvent.setup();
    const { action, resolve } = deferred();
    render(<DeferredForm action={action} />);

    await user.click(screen.getByRole("button", { name: "Save client" }));

    const pending = await screen.findByRole("button", { name: "Working…" });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");

    // Settle the action before the test ends: an action left forever pending
    // carries into whichever test runs next and makes its timing unreliable.
    resolve();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save client" }),
      ).toBeInTheDocument(),
    );
  });

  it("returns to its resting label once the action settles", async () => {
    const user = userEvent.setup();
    const { action, resolve } = deferred();
    render(<DeferredForm action={action} />);

    await user.click(screen.getByRole("button", { name: "Save client" }));
    await screen.findByRole("button", { name: "Working…" });

    resolve();

    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: "Save client" }),
        ).toBeInTheDocument(),
      { timeout: 5000, interval: 20 },
    );
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("accepts a custom pending label", async () => {
    const user = userEvent.setup();
    const { action, resolve } = deferred();
    render(<DeferredForm action={action} pendingLabel="Sending…" />);

    await user.click(screen.getByRole("button", { name: "Save client" }));

    expect(
      await screen.findByRole("button", { name: "Sending…" }),
    ).toBeInTheDocument();

    resolve();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save client" }),
      ).toBeInTheDocument(),
    );
  });

  it("stays disabled for a reason the caller passed in, even while idle", () => {
    const { action } = deferred();
    render(<DeferredForm action={action} disabled />);

    expect(screen.getByRole("button", { name: "Save client" })).toBeDisabled();
  });

  it("hides its spinner from assistive technology, so aria-busy carries the state instead of motion", async () => {
    const user = userEvent.setup();
    const { action, resolve } = deferred();
    const { container } = render(<DeferredForm action={action} />);

    await user.click(screen.getByRole("button", { name: "Save client" }));
    await screen.findByRole("button", { name: "Working…" });

    const spinner = container.querySelector("svg");
    expect(spinner).toHaveAttribute("aria-hidden");

    resolve();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save client" }),
      ).toBeInTheDocument(),
    );
  });

  describe.each(THEMES)("in the %s theme", (theme) => {
    it("has no axe violation while idle", async () => {
      const { action } = deferred();
      const { container } = render(<DeferredForm action={action} />);

      await withTheme(theme, () => expectNoAccessibilityViolations(container));
    });
  });
});
