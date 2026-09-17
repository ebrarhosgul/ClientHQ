/**
 * covers: spec 0015 AC-1, AC-14
 *
 * The Members table's own value sourcing, not otherwise pinned down by the
 * composed `team-page-view.test.tsx`: a member with no Clerk name falls back
 * to the email shown once (not twice), the `You` badge follows the viewer's
 * Clerk user id rather than their email, role visibility by viewer role, and
 * the empty state.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  FIXTURE_AGENCY_NAME,
  FIXTURE_CLERK_ORG_ID,
  MEMBER_FIXTURES,
  SOLO_ADMIN_FIXTURES,
  VIEWER_CLERK_USER_ID,
} from "./fixtures";
import { MembersTable } from "./members-table";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/team/change-team-member-role", () => ({
  changeTeamMemberRole: vi.fn(),
}));
vi.mock("@/team/remove-team-member", () => ({ removeTeamMember: vi.fn() }));

describe("MembersTable as an admin (AC-1)", () => {
  it("shows a member's name once as the email when Clerk holds no name, not twice", () => {
    render(
      <MembersTable
        members={MEMBER_FIXTURES}
        agencyName={FIXTURE_AGENCY_NAME}
        clerkOrgId={FIXTURE_CLERK_ORG_ID}
        viewerClerkUserId={VIEWER_CLERK_USER_ID}
        viewerRole="admin"
      />,
    );

    const table = screen.getByRole("table");

    expect(within(table).getAllByText("linus@northwind.example")).toHaveLength(
      1,
    );
  });

  it("puts the You badge on the viewer's own row by Clerk user id, not by email", () => {
    render(
      <MembersTable
        members={MEMBER_FIXTURES}
        agencyName={FIXTURE_AGENCY_NAME}
        clerkOrgId={FIXTURE_CLERK_ORG_ID}
        viewerClerkUserId={VIEWER_CLERK_USER_ID}
        viewerRole="admin"
      />,
    );

    const adaRow = screen.getByText("Ada Lovelace").closest("tr");
    const graceRow = screen.getByText("Grace Hopper").closest("tr");

    expect(adaRow).not.toBeNull();
    expect(graceRow).not.toBeNull();
    expect(within(adaRow!).getByText("You")).toBeInTheDocument();
    expect(within(graceRow!).queryByText("You")).toBeNull();
  });

  it("formats the joined date as day, month, year (UTC), from the ISO instant", () => {
    render(
      <MembersTable
        members={MEMBER_FIXTURES}
        agencyName={FIXTURE_AGENCY_NAME}
        clerkOrgId={FIXTURE_CLERK_ORG_ID}
        viewerClerkUserId={VIEWER_CLERK_USER_ID}
        viewerRole="admin"
      />,
    );

    const time = screen.getByText("2 September 2026 (UTC)");

    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", "2026-09-02T09:15:00.000Z");
  });

  it("gives an admin a role control and a remove action on every row", () => {
    render(
      <MembersTable
        members={MEMBER_FIXTURES}
        agencyName={FIXTURE_AGENCY_NAME}
        clerkOrgId={FIXTURE_CLERK_ORG_ID}
        viewerClerkUserId={VIEWER_CLERK_USER_ID}
        viewerRole="admin"
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Role for Grace Hopper" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Grace Hopper" }),
    ).toBeInTheDocument();
  });

  it("locks the sole admin's own row rather than letting them demote or remove themselves", () => {
    render(
      <MembersTable
        members={SOLO_ADMIN_FIXTURES}
        agencyName={FIXTURE_AGENCY_NAME}
        clerkOrgId={FIXTURE_CLERK_ORG_ID}
        viewerClerkUserId={VIEWER_CLERK_USER_ID}
        viewerRole="admin"
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Role for you" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Leave agency" })).toBeDisabled();
  });
});

describe("MembersTable as a member (AC-1)", () => {
  it("shows every role as text with no controls at all", () => {
    render(
      <MembersTable
        members={MEMBER_FIXTURES}
        agencyName={FIXTURE_AGENCY_NAME}
        clerkOrgId={FIXTURE_CLERK_ORG_ID}
        viewerClerkUserId="user_grace"
        viewerRole="member"
      />,
    );

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove|Leave/ })).toBeNull();
    expect(screen.getAllByText("Admin")).toHaveLength(2);
    expect(screen.getByText("Member")).toBeInTheDocument();
  });
});

describe("MembersTable with no members", () => {
  it("shows the empty state rather than an empty table", () => {
    render(
      <MembersTable
        members={[]}
        agencyName={FIXTURE_AGENCY_NAME}
        clerkOrgId={FIXTURE_CLERK_ORG_ID}
        viewerClerkUserId={VIEWER_CLERK_USER_ID}
        viewerRole="admin"
      />,
    );

    expect(screen.getByText("No members yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
