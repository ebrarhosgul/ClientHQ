/**
 * covers: spec 0009 AC-7
 *
 * `revokeInvitation` is mocked (it has its own tests in
 * `contacts.db.test.ts`); this file is about the button's own job: no confirm
 * dialog, refresh on success, and an inline error addressed to the contact
 * that leaves the row unchanged.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revokeInvitation: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/contacts/revoke-invitation", () => ({
  revokeInvitation: mocks.revokeInvitation,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const { RevokeInvitationButton } = await import("./revoke-invitation-button");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RevokeInvitationButton", () => {
  it("renders no confirm dialog, just the button, named for the contact", () => {
    render(<RevokeInvitationButton contactId="c1" contactName="Ada" />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Revoke the invitation to Ada" }),
    ).toBeInTheDocument();
  });

  it("revokes and refreshes on success, with no error shown", async () => {
    const user = userEvent.setup();
    mocks.revokeInvitation.mockResolvedValue({ ok: true, data: {} });

    render(<RevokeInvitationButton contactId="c1" contactName="Ada" />);
    await user.click(
      screen.getByRole("button", { name: "Revoke the invitation to Ada" }),
    );

    expect(mocks.revokeInvitation).toHaveBeenCalledWith({ contactId: "c1" });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the error and still refreshes when the action refuses", async () => {
    const user = userEvent.setup();
    mocks.revokeInvitation.mockResolvedValue({
      ok: false,
      error: { code: "conflict", message: "" },
    });

    render(<RevokeInvitationButton contactId="c1" contactName="Ada" />);
    await user.click(
      screen.getByRole("button", { name: "Revoke the invitation to Ada" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toBe("");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
