import type { Metadata } from "next";

import { agencyContext, currentAgency } from "@/auth/context";
import { isClerkConfigured } from "@/lib/env";
import { loadTeam } from "@/team/queries";
import { ClerkSessionSync } from "@/team/ui/session-sync";
import { TeamPageView } from "@/team/ui/team-page-view";

export const metadata: Metadata = {
  title: "Team",
};

/**
 * `/team` (spec 0015, AC-1): who is in the agency, read live from Clerk, with
 * the invite card and the row controls for an admin and the read only view
 * for a member. The organization comes from the session, never the URL.
 *
 * When Clerk cannot be reached the page frame still renders and the list
 * area shows the error card (AC-11); nothing falls back to the mirror.
 *
 * With no Clerk publishable key there is no session and no team to read, so
 * this renders the error card a brand new environment would see rather than
 * resolving a tenant context that cannot exist (spec 0004, AC-22).
 */
export default async function TeamPage() {
  if (!isClerkConfigured()) {
    return (
      <TeamPageView
        agencyName="your agency"
        clerkOrgId=""
        viewerClerkUserId=""
        viewerRole="member"
        team={undefined}
      />
    );
  }

  const [ctx, agency] = await Promise.all([agencyContext(), currentAgency()]);
  const loaded = await loadTeam(ctx);

  return (
    <TeamPageView
      agencyName={agency?.name ?? "your agency"}
      clerkOrgId={ctx.clerkOrgId}
      viewerClerkUserId={ctx.clerkUserId}
      viewerRole={ctx.role}
      team={loaded.ok ? loaded.team : undefined}
      wrap={(children) => <ClerkSessionSync>{children}</ClerkSessionSync>}
    />
  );
}
