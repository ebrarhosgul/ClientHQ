/**
 * covers: spec 0015 AC-5, AC-7, AC-14
 *
 * The per row role control: it saves on change, announces the outcome in its
 * own live region, only syncs the Clerk session when the action reports the
 * change was to the acting person's own row, and is a disabled, reasoned
 * no-op when the acting admin is the only one.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LAST_ADMIN_REASON } from "@/team/rules";

// jsdom implements neither pointer capture nor ResizeObserver, and Radix
// Select's trigger checks pointer capture on open (see primitives.test.tsx).
if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (typeof window.HTMLElement.prototype.hasPointerCapture === "undefined") {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.releasePointerCapture = () => {};
}
if (typeof window.HTMLElement.prototype.scrollIntoView === "undefined") {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

const mocks = vi.hoisted(() => ({
  changeTeamMemberRole: vi.fn(),
  refresh: vi.fn(),
  roleChanged: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/team/change-team-member-role", () => ({
  changeTeamMemberRole: mocks.changeTeamMemberRole,
}));
vi.mock("./session-sync", () => ({
  useSessionSync: () => ({
    roleChanged: mocks.roleChanged,
    leftAgency: vi.fn(),
  }),
}));

const { MemberRoleSelect } = await import("./member-role-select");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MemberRoleSelect (AC-5)", () => {
  it("saves the new role on change, announces it, and refreshes", async () => {
    mocks.changeTeamMemberRole.mockResolvedValue({
      ok: true,
      data: { role: "admin", self: false },
    });
    const user = userEvent.setup();

    render(
      <MemberRoleSelect
        membershipId="orgmem_3"
        memberName="Grace Hopper"
        role="member"
        self={false}
        clerkOrgId="org_northwind"
        lockedAsLastAdmin={false}
      />,
    );

    const trigger = screen.getByRole("combobox", {
      name: "Role for Grace Hopper",
    });
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "Admin" }));

    expect(mocks.changeTeamMemberRole).toHaveBeenCalledWith({
      membershipId: "orgmem_3",
      role: "admin",
    });
    expect(await screen.findByText("Role updated")).toBeInTheDocument();
    expect(trigger).toHaveTextContent("Admin");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.roleChanged).not.toHaveBeenCalled();
  });

  it("syncs the Clerk session when the action reports the change was to the acting person's own row (AC-7)", async () => {
    mocks.changeTeamMemberRole.mockResolvedValue({
      ok: true,
      data: { role: "member", self: true },
    });
    const user = userEvent.setup();

    render(
      <MemberRoleSelect
        membershipId="orgmem_1"
        memberName="Ada Lovelace"
        role="admin"
        self={true}
        clerkOrgId="org_northwind"
        lockedAsLastAdmin={false}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Role for you" }));
    await user.click(await screen.findByRole("option", { name: "Member" }));

    await screen.findByText("Role updated");

    expect(mocks.roleChanged).toHaveBeenCalledWith("org_northwind");
  });

  it("shows the refusal and keeps the previous role when the action fails", async () => {
    mocks.changeTeamMemberRole.mockResolvedValue({
      ok: false,
      error: { code: "conflict", message: "The last admin cannot be removed." },
    });
    const user = userEvent.setup();

    render(
      <MemberRoleSelect
        membershipId="orgmem_3"
        memberName="Grace Hopper"
        role="member"
        self={false}
        clerkOrgId="org_northwind"
        lockedAsLastAdmin={false}
      />,
    );

    const trigger = screen.getByRole("combobox", {
      name: "Role for Grace Hopper",
    });
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "Admin" }));

    expect(
      await screen.findByText("The last admin cannot be removed."),
    ).toBeInTheDocument();
    expect(trigger).toHaveTextContent("Member");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("MemberRoleSelect locked as the last admin (AC-14)", () => {
  it("is disabled and shows the reason as visible text, with no call on click", async () => {
    const user = userEvent.setup();

    render(
      <MemberRoleSelect
        membershipId="orgmem_1"
        memberName="Ada Lovelace"
        role="admin"
        self={true}
        clerkOrgId="org_northwind"
        lockedAsLastAdmin={true}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Role for you" });

    expect(trigger).toBeDisabled();
    expect(screen.getByText(LAST_ADMIN_REASON)).toBeInTheDocument();

    await user.click(trigger);

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(mocks.changeTeamMemberRole).not.toHaveBeenCalled();
  });
});
