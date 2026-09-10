/**
 * covers: spec 0006 AC-9
 *
 * No confirmation gate here at all: this is a plain form, unlike
 * `ArchiveClientButton`.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  restoreClient: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/clients/archive-client", () => ({
  restoreClient: mocks.restoreClient,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const { RestoreClientButton } = await import("./restore-client-button");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RestoreClientButton", () => {
  it("renders no confirm dialog, just the button (AC-9)", () => {
    render(<RestoreClientButton clientId="c1" />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /restore/i }),
    ).toBeInTheDocument();
  });

  it("restores and refreshes on click, with no confirmation step", async () => {
    const user = userEvent.setup();
    mocks.restoreClient.mockResolvedValue({
      ok: true,
      data: { archivedAt: null },
    });

    render(<RestoreClientButton clientId="c1" />);
    await user.click(screen.getByRole("button", { name: /restore/i }));

    expect(mocks.restoreClient).toHaveBeenCalledWith({ id: "c1" });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the error message and does not refresh when the action fails", async () => {
    const user = userEvent.setup();
    mocks.restoreClient.mockResolvedValue({
      ok: false,
      error: { code: "not_found", message: "" },
    });

    render(<RestoreClientButton clientId="c1" />);
    await user.click(screen.getByRole("button", { name: /restore/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toBe("");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
