/**
 * covers: spec 0009 AC-3
 *
 * `sendInvitation` is mocked (it has its own tests in
 * `contacts.db.test.ts`); this file is about what the button does with the
 * result: it always refreshes (even on failure, since a provider refusal
 * still changes the row to `unsent`), and it renders the failure inline,
 * addressed to the contact by name.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendInvitation: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/contacts/send-invitation", () => ({
  sendInvitation: mocks.sendInvitation,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const { SendInvitationButton } = await import("./send-invitation-button");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SendInvitationButton", () => {
  it("names the contact in the accessible name, using the given label", () => {
    render(
      <SendInvitationButton
        contactId="c1"
        contactName="Ada Lovelace"
        label="Send invitation"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Send invitation to Ada Lovelace" }),
    ).toBeInTheDocument();
  });

  it("sends and refreshes on success, with no error shown", async () => {
    const user = userEvent.setup();
    mocks.sendInvitation.mockResolvedValue({ ok: true, data: {} });

    render(
      <SendInvitationButton contactId="c1" contactName="Ada" label="Resend" />,
    );
    await user.click(screen.getByRole("button", { name: "Resend to Ada" }));

    expect(mocks.sendInvitation).toHaveBeenCalledWith({ contactId: "c1" });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still refreshes and shows the error when the provider refuses (AC-6)", async () => {
    const user = userEvent.setup();
    mocks.sendInvitation.mockResolvedValue({
      ok: false,
      error: {
        code: "unavailable",
        message: "The email could not be sent. Try again in a moment.",
      },
    });

    render(
      <SendInvitationButton contactId="c1" contactName="Ada" label="Resend" />,
    );
    await user.click(screen.getByRole("button", { name: "Resend to Ada" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "The email could not be sent. Try again in a moment.",
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
