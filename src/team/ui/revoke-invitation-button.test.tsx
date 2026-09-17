/**
 * covers: spec 0015 AC-4
 *
 * `ConfirmDialog` has its own tests in `src/ui/patterns/patterns.test.tsx`
 * and `revokeTeamInvitation` in `../actions.test.ts`. This file is about
 * what the button hands the dialog: the copy names the email, and the
 * confirm callback calls the action and refreshes on success, or hands the
 * refusal back to the dialog as its message.
 */
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revokeTeamInvitation: vi.fn(),
  refresh: vi.fn(),
  confirmDialogProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/team/revoke-team-invitation", () => ({
  revokeTeamInvitation: mocks.revokeTeamInvitation,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/ui/patterns/confirm-dialog", () => ({
  ConfirmDialog: (props: Record<string, unknown>) => {
    mocks.confirmDialogProps.push(props);
    return props.trigger as ReactNode;
  },
}));

const { RevokeInvitationButton } = await import("./revoke-invitation-button");

type OnConfirm = () => Promise<{ ok: boolean; message?: ReactNode }>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirmDialogProps = [];
});

describe("RevokeInvitationButton", () => {
  it("names the email in the trigger and the dialog copy", () => {
    render(
      <RevokeInvitationButton
        invitationId="orginv_2"
        email="alex@northwind.example"
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Revoke invitation to alex@northwind.example",
      }),
    ).toBeInTheDocument();
    expect(mocks.confirmDialogProps[0]).toMatchObject({
      title: "Revoke the invitation to alex@northwind.example?",
      confirmLabel: "Revoke",
      variant: "destructive",
    });
  });

  it("revokes by invitation id and refreshes on success", async () => {
    mocks.revokeTeamInvitation.mockResolvedValue({ ok: true, data: undefined });
    render(
      <RevokeInvitationButton
        invitationId="orginv_2"
        email="alex@northwind.example"
      />,
    );

    const outcome = await (
      mocks.confirmDialogProps[0].onConfirm as OnConfirm
    )();

    expect(mocks.revokeTeamInvitation).toHaveBeenCalledWith({
      invitationId: "orginv_2",
    });
    expect(outcome).toStrictEqual({ ok: true });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("hands a refusal back to the dialog as its message, without refreshing", async () => {
    mocks.revokeTeamInvitation.mockResolvedValue({
      ok: false,
      error: { code: "not_found", message: "That is not here any more." },
    });
    render(
      <RevokeInvitationButton
        invitationId="orginv_2"
        email="alex@northwind.example"
      />,
    );

    const outcome = await (
      mocks.confirmDialogProps[0].onConfirm as OnConfirm
    )();

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toBeDefined();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
