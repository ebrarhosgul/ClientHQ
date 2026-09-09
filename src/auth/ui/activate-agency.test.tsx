/**
 * covers: spec 0005 AC-6
 *
 * One agency, one membership, nothing to choose: activate on arrival. The
 * thing worth pinning here is the guard against activating twice on a
 * rerender, and the busy state being announced through `role="status"`.
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

const { ActivateAgency } = await import("./activate-agency");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ready = true;
  mocks.state = "idle";
});

describe("ActivateAgency", () => {
  it("activates the given agency once Clerk is ready (AC-6)", () => {
    render(<ActivateAgency clerkOrgId="org_1" name="Northwind" />);

    expect(mocks.activate).toHaveBeenCalledTimes(1);
    expect(mocks.activate).toHaveBeenCalledWith("org_1");
  });

  it("does not activate again on a rerender", () => {
    const { rerender } = render(
      <ActivateAgency clerkOrgId="org_1" name="Northwind" />,
    );

    rerender(<ActivateAgency clerkOrgId="org_1" name="Northwind" />);

    expect(mocks.activate).toHaveBeenCalledTimes(1);
  });

  it("does not activate until Clerk has loaded", () => {
    mocks.ready = false;
    render(<ActivateAgency clerkOrgId="org_1" name="Northwind" />);

    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("announces the busy state through role=status", () => {
    render(<ActivateAgency clerkOrgId="org_1" name="Northwind" />);

    expect(screen.getByRole("status")).toHaveTextContent("Opening Northwind…");
  });

  it("offers a retry that activates the same agency again when it fails", async () => {
    const user = userEvent.setup();
    mocks.state = "failed";

    render(<ActivateAgency clerkOrgId="org_1" name="Northwind" />);
    mocks.activate.mockClear();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(mocks.activate).toHaveBeenCalledWith("org_1");
  });
});
