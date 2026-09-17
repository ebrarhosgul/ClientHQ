/**
 * covers: spec 0015 AC-6, AC-7, AC-14
 *
 * `ConfirmDialog` has its own tests in `src/ui/patterns/patterns.test.tsx`
 * and `removeTeamMember` in `../actions.test.ts`. This file is about what
 * the button hands the dialog: the copy names the person and the agency, the
 * own row reads Leave agency, and the confirm callback follows a self
 * removal with the session step and `/onboarding`.
 */
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  removeTeamMember: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  leftAgency: vi.fn(),
  confirmDialogProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/team/remove-team-member", () => ({
  removeTeamMember: mocks.removeTeamMember,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
}));
vi.mock("@/ui/patterns/confirm-dialog", () => ({
  ConfirmDialog: (props: Record<string, unknown>) => {
    mocks.confirmDialogProps.push(props);
    return props.trigger as ReactNode;
  },
}));
vi.mock("./session-sync", () => ({
  useSessionSync: () => ({
    leftAgency: mocks.leftAgency,
    roleChanged: vi.fn(),
  }),
}));

const { RemoveMemberButton } = await import("./remove-member-button");

type OnConfirm = () => Promise<{ ok: boolean; message?: ReactNode }>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirmDialogProps = [];
});

describe("RemoveMemberButton", () => {
  it("names the person and the agency for another member", () => {
    render(
      <RemoveMemberButton
        membershipId="orgmem_3"
        memberName="Grace Hopper"
        agencyName="Northwind Studio"
        self={false}
        lockedAsLastAdmin={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Remove Grace Hopper" }),
    ).toBeInTheDocument();
    expect(mocks.confirmDialogProps[0]).toMatchObject({
      title: "Remove Grace Hopper from Northwind Studio?",
      description: "They lose access immediately.",
      confirmLabel: "Remove",
      variant: "destructive",
    });
  });

  it("reads Leave agency on the acting person's own row", () => {
    render(
      <RemoveMemberButton
        membershipId="orgmem_1"
        memberName="Ada Lovelace"
        agencyName="Northwind Studio"
        self={true}
        lockedAsLastAdmin={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Leave agency" }),
    ).toBeInTheDocument();
    expect(mocks.confirmDialogProps[0]).toMatchObject({
      title: "Leave Northwind Studio?",
      description:
        "You will be signed out of this agency and will need a new invitation to return.",
      confirmLabel: "Leave",
    });
  });

  it("is disabled with no dialog when the person is the last admin", () => {
    render(
      <RemoveMemberButton
        membershipId="orgmem_1"
        memberName="Ada Lovelace"
        agencyName="Northwind Studio"
        self={true}
        lockedAsLastAdmin={true}
      />,
    );

    expect(screen.getByRole("button", { name: "Leave agency" })).toBeDisabled();
    expect(mocks.confirmDialogProps).toHaveLength(0);
  });

  it("refreshes after removing someone else", async () => {
    mocks.removeTeamMember.mockResolvedValue({
      ok: true,
      data: { self: false },
    });
    render(
      <RemoveMemberButton
        membershipId="orgmem_3"
        memberName="Grace Hopper"
        agencyName="Northwind Studio"
        self={false}
        lockedAsLastAdmin={false}
      />,
    );

    const outcome = await (
      mocks.confirmDialogProps[0].onConfirm as OnConfirm
    )();

    expect(mocks.removeTeamMember).toHaveBeenCalledWith({
      membershipId: "orgmem_3",
    });
    expect(outcome).toStrictEqual({ ok: true });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.leftAgency).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("clears the active organization and goes to /onboarding after leaving (AC-7)", async () => {
    mocks.removeTeamMember.mockResolvedValue({
      ok: true,
      data: { self: true },
    });
    render(
      <RemoveMemberButton
        membershipId="orgmem_1"
        memberName="Ada Lovelace"
        agencyName="Northwind Studio"
        self={true}
        lockedAsLastAdmin={false}
      />,
    );

    await (mocks.confirmDialogProps[0].onConfirm as OnConfirm)();

    expect(mocks.leftAgency).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith("/onboarding");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("hands a refusal back to the dialog as its message", async () => {
    mocks.removeTeamMember.mockResolvedValue({
      ok: false,
      error: { code: "conflict", message: "The last admin cannot be removed." },
    });
    render(
      <RemoveMemberButton
        membershipId="orgmem_1"
        memberName="Ada Lovelace"
        agencyName="Northwind Studio"
        self={false}
        lockedAsLastAdmin={false}
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
