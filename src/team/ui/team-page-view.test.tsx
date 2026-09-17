/**
 * covers: spec 0015 AC-1, AC-11, AC-14
 *
 * The whole `/team` surface from fixtures: what an admin sees, what a member
 * sees, the solo admin lock, the empty pending list, the Clerk error card,
 * and axe in both themes over every one of those states. The Server Actions
 * behind the controls are mocked away; they have their own tests.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  THEMES,
  expectNoAccessibilityViolations,
  withTheme,
} from "@/ui/test/axe";

import {
  FIXTURE_AGENCY_NAME,
  FIXTURE_CLERK_ORG_ID,
  INVITATION_FIXTURES,
  MEMBER_FIXTURES,
  SOLO_ADMIN_FIXTURES,
  VIEWER_CLERK_USER_ID,
} from "./fixtures";
import { TEAM_LOAD_FAILED_HEADING, TeamPageView } from "./team-page-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/team/invite-team-member", () => ({ inviteTeamMember: vi.fn() }));
vi.mock("@/team/revoke-team-invitation", () => ({
  revokeTeamInvitation: vi.fn(),
}));
vi.mock("@/team/change-team-member-role", () => ({
  changeTeamMemberRole: vi.fn(),
}));
vi.mock("@/team/remove-team-member", () => ({ removeTeamMember: vi.fn() }));

type Overrides = Partial<Parameters<typeof TeamPageView>[0]>;

function renderView(overrides: Overrides = {}) {
  return render(
    <TeamPageView
      agencyName={FIXTURE_AGENCY_NAME}
      clerkOrgId={FIXTURE_CLERK_ORG_ID}
      viewerClerkUserId={VIEWER_CLERK_USER_ID}
      viewerRole="admin"
      team={{ members: MEMBER_FIXTURES, invitations: INVITATION_FIXTURES }}
      {...overrides}
    />,
  );
}

describe("TeamPageView as an admin (AC-1, AC-14)", () => {
  it("shows the invite card, the members with controls, and the pending invitations", () => {
    renderView();

    expect(
      screen.getByRole("heading", { level: 1, name: "Team" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Invite someone" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send invitation" }),
    ).toBeInTheDocument();

    const members = screen.getByRole("table", {
      name: `Members of ${FIXTURE_AGENCY_NAME}`,
    });
    expect(within(members).getAllByRole("row")).toHaveLength(4);
    expect(within(members).getByText("You")).toBeInTheDocument();
    expect(
      within(members).getByText("2 September 2026 (UTC)"),
    ).toBeInTheDocument();
    expect(
      within(members).getByRole("combobox", { name: "Role for Grace Hopper" }),
    ).toBeInTheDocument();
    expect(
      within(members).getByRole("button", { name: "Remove Grace Hopper" }),
    ).toBeInTheDocument();
    expect(
      within(members).getByRole("button", { name: "Leave agency" }),
    ).toBeInTheDocument();

    const pending = screen.getByRole("table", {
      name: `Pending invitations to ${FIXTURE_AGENCY_NAME}`,
    });
    expect(within(pending).getAllByRole("row")).toHaveLength(3);
    expect(
      within(pending).getByRole("button", {
        name: "Revoke invitation to alex@northwind.example",
      }),
    ).toBeInTheDocument();
  });

  it("locks the solo admin's own controls with the reason as visible text", () => {
    renderView({ team: { members: SOLO_ADMIN_FIXTURES, invitations: [] } });

    expect(
      screen.getByRole("combobox", { name: "Role for you" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Leave agency" })).toBeDisabled();
    expect(
      screen.getByText(
        "You are the only admin. Make someone else an admin first.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("No pending invitations.")).toBeInTheDocument();
  });
});

describe("TeamPageView as a member (AC-1)", () => {
  it("shows the members as text with no invite card and no controls", () => {
    renderView({
      viewerRole: "member",
      viewerClerkUserId: "user_grace",
      team: { members: MEMBER_FIXTURES, invitations: undefined },
    });

    expect(
      screen.getByText(/Only an admin can invite people or change roles\./),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Invite someone" }),
    ).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove|Leave/ })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Pending invitations" }),
    ).toBeNull();
    expect(screen.getAllByText("Admin")).toHaveLength(2);
    expect(screen.getByText("Member")).toBeInTheDocument();
  });
});

describe("TeamPageView when Clerk could not be reached (AC-11)", () => {
  it("keeps the frame and the invite card and shows the error card with a way back", () => {
    renderView({ team: undefined });

    expect(
      screen.getByRole("heading", { level: 1, name: "Team" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Invite someone" }),
    ).toBeInTheDocument();
    expect(screen.getByText(TEAM_LOAD_FAILED_HEADING)).toBeInTheDocument();
    expect(screen.getByText("Try again in a moment.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      "/team",
    );
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe.each(THEMES)("in the %s theme", (theme) => {
  it("has no axe violation in the admin view", async () => {
    const { container } = renderView();

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });

  it("has no axe violation with the solo admin locked and no pending invitations", async () => {
    const { container } = renderView({
      team: { members: SOLO_ADMIN_FIXTURES, invitations: [] },
    });

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });

  it("has no axe violation in the member view", async () => {
    const { container } = renderView({
      viewerRole: "member",
      team: { members: MEMBER_FIXTURES, invitations: undefined },
    });

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });

  it("has no axe violation on the error card", async () => {
    const { container } = renderView({ team: undefined });

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
