/**
 * covers: spec 0005 AC-6
 *
 * Which agency am I acting as? `useActivateAgency` is mocked so each case can
 * drive `ready`/`state` directly; the hook has its own tests.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ready: true,
  state: "idle" as "idle" | "working" | "failed",
  activate: vi.fn(),
}));

vi.mock("./use-activate-agency", () => ({
  useActivateAgency: () => ({
    ready: mocks.ready,
    state: mocks.state,
    activate: mocks.activate,
  }),
}));

const { AgencyPicker } = await import("./agency-picker");

const AGENCIES = [
  { clerkOrgId: "org_1", name: "Northwind", isAdmin: true },
  { clerkOrgId: "org_2", name: "Contoso", isAdmin: false },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ready = true;
  mocks.state = "idle";
});

describe("AgencyPicker", () => {
  it("lists every agency with the caller's role in each (AC-6)", () => {
    render(<AgencyPicker agencies={AGENCIES} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent("Northwind");
    expect(buttons[0]).toHaveTextContent("Admin");
    expect(buttons[1]).toHaveTextContent("Contoso");
    expect(buttons[1]).toHaveTextContent("Member");
  });

  it("activates the chosen agency", async () => {
    const user = userEvent.setup();
    render(<AgencyPicker agencies={AGENCIES} />);

    await user.click(screen.getByRole("button", { name: /Northwind/ }));

    expect(mocks.activate).toHaveBeenCalledWith("org_1");
  });

  it("disables every option until Clerk is ready", () => {
    mocks.ready = false;
    render(<AgencyPicker agencies={AGENCIES} />);

    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });

  it("disables every option while one is activating", async () => {
    const user = userEvent.setup();
    mocks.state = "idle";
    const { rerender } = render(<AgencyPicker agencies={AGENCIES} />);

    await user.click(screen.getByRole("button", { name: /Northwind/ }));

    mocks.state = "working";
    rerender(<AgencyPicker agencies={AGENCIES} />);

    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });

  it("shows a retry when activation fails, and retries the same agency", async () => {
    const user = userEvent.setup();
    mocks.state = "idle";
    const { rerender } = render(<AgencyPicker agencies={AGENCIES} />);

    await user.click(screen.getByRole("button", { name: /Contoso/ }));
    mocks.activate.mockClear();

    mocks.state = "failed";
    rerender(<AgencyPicker agencies={AGENCIES} />);

    expect(
      screen.getByText(/We could not switch you into Contoso/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.activate).toHaveBeenCalledWith("org_2");
  });
});
