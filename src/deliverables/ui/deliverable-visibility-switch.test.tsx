/**
 * covers: spec 0011 AC-11
 *
 * The switch is labelled with the file's name, flips optimistically, calls
 * `setDeliverableVisibility` and refreshes on success, and reverts with an
 * error message on failure.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

const mocks = vi.hoisted(() => ({
  setDeliverableVisibility: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("../set-deliverable-visibility", () => ({
  setDeliverableVisibility: mocks.setDeliverableVisibility,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const { DeliverableVisibilitySwitch } =
  await import("./deliverable-visibility-switch");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DeliverableVisibilitySwitch", () => {
  it("labels the switch with the file's name and reflects the starting value", () => {
    render(
      <DeliverableVisibilitySwitch
        deliverableId="d1"
        name="Contract.pdf"
        visibleToClient={false}
      />,
    );

    const toggle = screen.getByRole("switch", {
      name: "Visible to client: Contract.pdf",
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("starts checked when the file is already visible to the client", () => {
    render(
      <DeliverableVisibilitySwitch
        deliverableId="d1"
        name="Contract.pdf"
        visibleToClient={true}
      />,
    );

    expect(
      screen.getByRole("switch", { name: "Visible to client: Contract.pdf" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("flips on click, calls the action, and refreshes on success (AC-11)", async () => {
    const user = userEvent.setup();
    mocks.setDeliverableVisibility.mockResolvedValue({
      ok: true,
      data: { visibleToClient: true },
    });

    render(
      <DeliverableVisibilitySwitch
        deliverableId="d1"
        name="Contract.pdf"
        visibleToClient={false}
      />,
    );

    const toggle = screen.getByRole("switch", {
      name: "Visible to client: Contract.pdf",
    });
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(mocks.setDeliverableVisibility).toHaveBeenCalledWith({
      deliverableId: "d1",
      visibleToClient: true,
    });

    await vi.waitFor(() => {
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reverts the switch and shows an error when the action fails", async () => {
    const user = userEvent.setup();
    mocks.setDeliverableVisibility.mockResolvedValue({
      ok: false,
      error: { code: "conflict", message: "" },
    });

    render(
      <DeliverableVisibilitySwitch
        deliverableId="d1"
        name="Contract.pdf"
        visibleToClient={false}
      />,
    );

    const toggle = screen.getByRole("switch", {
      name: "Visible to client: Contract.pdf",
    });
    await user.click(toggle);

    await vi.waitFor(() => {
      expect(toggle).toHaveAttribute("aria-checked", "false");
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).not.toBe("");
  });

  it("clears a previous error once a later toggle succeeds", async () => {
    const user = userEvent.setup();
    mocks.setDeliverableVisibility
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "conflict", message: "" },
      })
      .mockResolvedValueOnce({ ok: true, data: { visibleToClient: true } });

    render(
      <DeliverableVisibilitySwitch
        deliverableId="d1"
        name="Contract.pdf"
        visibleToClient={false}
      />,
    );

    const toggle = screen.getByRole("switch", {
      name: "Visible to client: Contract.pdf",
    });
    await user.click(toggle);
    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    await user.click(toggle);
    await vi.waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});

describe.each(THEMES)("in the %s theme", (theme) => {
  it("has no axe violation", async () => {
    const { container } = render(
      <DeliverableVisibilitySwitch
        deliverableId="d1"
        name="Contract.pdf"
        visibleToClient={false}
      />,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
