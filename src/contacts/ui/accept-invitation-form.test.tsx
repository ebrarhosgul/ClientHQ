/**
 * covers: spec 0009 AC-9, AC-10
 *
 * `acceptInvitation` is mocked (it has its own tests in
 * `contacts.db.test.ts`); this file is about the form's own job: it submits
 * the token in a hidden field, and a failure is refreshed and shown inline
 * rather than left as a blank retry.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/contacts/accept-invitation", () => ({
  acceptInvitation: mocks.acceptInvitation,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const { AcceptInvitationForm } = await import("./accept-invitation-form");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AcceptInvitationForm", () => {
  it("renders the given label, defaulting to Accept invitation", () => {
    render(<AcceptInvitationForm token="a.b" />);

    expect(
      screen.getByRole("button", { name: "Accept invitation" }),
    ).toBeInTheDocument();
  });

  it("renders a custom label when given one", () => {
    render(<AcceptInvitationForm token="a.b" label="Go to your portal" />);

    expect(
      screen.getByRole("button", { name: "Go to your portal" }),
    ).toBeInTheDocument();
  });

  it("submits the token and shows no error on success", async () => {
    const user = userEvent.setup();
    mocks.acceptInvitation.mockResolvedValue({ ok: true, data: {} });

    render(<AcceptInvitationForm token="a.b" />);
    await user.click(screen.getByRole("button", { name: "Accept invitation" }));

    expect(mocks.acceptInvitation).toHaveBeenCalledWith({ token: "a.b" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refreshes and shows the reason inline when acceptance is refused", async () => {
    const user = userEvent.setup();
    mocks.acceptInvitation.mockResolvedValue({
      ok: false,
      error: {
        code: "forbidden",
        message: "This invitation is for a different email address.",
      },
    });

    render(<AcceptInvitationForm token="a.b" />);
    await user.click(screen.getByRole("button", { name: "Accept invitation" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "This invitation is for a different email address.",
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
