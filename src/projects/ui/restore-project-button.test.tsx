/**
 * covers: spec 0010 AC-11
 *
 * No confirmation dialog to mock here: just the form's own job of calling
 * `restoreProject`, refreshing on success, and showing the failure inline
 * without one.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  restoreProject: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("../archive-project", () => ({
  restoreProject: mocks.restoreProject,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const { RestoreProjectButton } = await import("./restore-project-button");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RestoreProjectButton", () => {
  it("restores and refreshes on success (AC-11)", async () => {
    const user = userEvent.setup();
    mocks.restoreProject.mockResolvedValue({
      ok: true,
      data: { archivedAt: null },
    });

    render(<RestoreProjectButton projectId="p1" />);
    await user.click(screen.getByRole("button", { name: "Restore" }));

    expect(mocks.restoreProject).toHaveBeenCalledWith({ id: "p1" });
    expect(
      await screen.findByRole("button", { name: "Restore" }),
    ).toBeEnabled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the failure inline, with no confirmation and no refresh", async () => {
    const user = userEvent.setup();
    mocks.restoreProject.mockResolvedValue({
      ok: false,
      error: { code: "forbidden", message: "" },
    });

    render(<RestoreProjectButton projectId="p1" />);
    await user.click(screen.getByRole("button", { name: "Restore" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You do not have permission to do that.",
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
