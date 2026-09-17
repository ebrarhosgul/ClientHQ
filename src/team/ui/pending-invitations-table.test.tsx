/**
 * covers: spec 0015 AC-1, AC-4
 *
 * The Pending invitations table: the caption, the count, the row content and
 * the revoke action per row, the sent date formatting, and the empty state
 * (there is no resend, only revoke and invite again).
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FIXTURE_AGENCY_NAME, INVITATION_FIXTURES } from "./fixtures";
import {
  NO_PENDING_INVITATIONS,
  PendingInvitationsTable,
} from "./pending-invitations-table";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/team/revoke-team-invitation", () => ({
  revokeTeamInvitation: vi.fn(),
}));

describe("PendingInvitationsTable", () => {
  it("lists every invitation with its email, role and a revoke action", () => {
    render(
      <PendingInvitationsTable
        invitations={INVITATION_FIXTURES}
        agencyName={FIXTURE_AGENCY_NAME}
      />,
    );

    const table = screen.getByRole("table", {
      name: `Pending invitations to ${FIXTURE_AGENCY_NAME}`,
    });

    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(
      within(table).getByText("alex@northwind.example"),
    ).toBeInTheDocument();
    expect(
      within(table).getByText("sam@northwind.example"),
    ).toBeInTheDocument();
    expect(within(table).getByText("Member")).toBeInTheDocument();
    expect(within(table).getByText("Admin")).toBeInTheDocument();
    expect(
      within(table).getByRole("button", {
        name: "Revoke invitation to alex@northwind.example",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 pending")).toBeInTheDocument();
  });

  it("formats the sent date as day, month, year (UTC)", () => {
    render(
      <PendingInvitationsTable
        invitations={INVITATION_FIXTURES}
        agencyName={FIXTURE_AGENCY_NAME}
      />,
    );

    const time = screen.getByText("16 September 2026 (UTC)");

    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", "2026-09-16T11:30:00.000Z");
  });

  it("shows no table and the no pending copy when the list is empty", () => {
    render(
      <PendingInvitationsTable
        invitations={[]}
        agencyName={FIXTURE_AGENCY_NAME}
      />,
    );

    expect(screen.getByText(NO_PENDING_INVITATIONS)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("0 pending")).toBeInTheDocument();
  });
});
