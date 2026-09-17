import { RefreshCw } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { MembershipRole } from "@/db/schema";
import type { TeamView } from "@/team/queries";
import { MEMBER_NOTE } from "@/team/rules";
import { ErrorState } from "@/ui/patterns/error-state";
import { PageHeader } from "@/ui/patterns/page-header";
import { Button } from "@/ui/primitives/button";

import { InviteForm } from "./invite-form";
import { MembersTable } from "./members-table";
import { PendingInvitationsTable } from "./pending-invitations-table";

export type TeamPageViewProps = {
  readonly agencyName: string;
  readonly clerkOrgId: string;
  readonly viewerClerkUserId: string;
  readonly viewerRole: MembershipRole;
  /** Absent when the lists could not be loaded (AC-11). */
  readonly team: TeamView | undefined;
  /** Wraps the interactive sections; the page passes the Clerk session sync. */
  readonly wrap?: (children: ReactNode) => ReactNode;
};

export const TEAM_LOAD_FAILED_HEADING = "The team list could not be loaded";
export const TEAM_LOAD_FAILED_BODY = "Try again in a moment.";

/**
 * The whole `/team` surface (spec 0015, AC-1, AC-11, AC-14): the header, the
 * invite card for an admin, the members section, and the pending
 * invitations for an admin. Pure composition: the page resolves the tenant
 * context and the Clerk reads, this renders what it was given, which is
 * what the gallery and the page tests lean on.
 */
export function TeamPageView({
  agencyName,
  clerkOrgId,
  viewerClerkUserId,
  viewerRole,
  team,
  wrap = (children) => children,
}: TeamPageViewProps) {
  const isAdmin = viewerRole === "admin";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team"
        description={
          isAdmin
            ? `The people who work in ${agencyName}. Invite colleagues, set who is an admin, and remove anyone who has moved on.`
            : `The people who work in ${agencyName}. ${MEMBER_NOTE}`
        }
      />

      {team === undefined ? (
        <>
          {isAdmin ? <InviteForm agencyName={agencyName} /> : undefined}
          <ErrorState
            heading={TEAM_LOAD_FAILED_HEADING}
            description={TEAM_LOAD_FAILED_BODY}
            action={
              <Button asChild variant="outline">
                <Link href="/team">
                  <RefreshCw />
                  Try again
                </Link>
              </Button>
            }
          />
        </>
      ) : (
        wrap(
          <>
            {isAdmin ? <InviteForm agencyName={agencyName} /> : undefined}

            <MembersTable
              members={team.members}
              agencyName={agencyName}
              clerkOrgId={clerkOrgId}
              viewerClerkUserId={viewerClerkUserId}
              viewerRole={viewerRole}
            />

            {isAdmin && team.invitations !== undefined ? (
              <PendingInvitationsTable
                invitations={team.invitations}
                agencyName={agencyName}
              />
            ) : undefined}
          </>,
        )
      )}
    </div>
  );
}
