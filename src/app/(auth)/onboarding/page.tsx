import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { agencyMemberships } from "@/auth/clerk";
import { isClientContact } from "@/auth/context";
import { ActivateAgency } from "@/auth/ui/activate-agency";
import { AgencyPicker } from "@/auth/ui/agency-picker";
import { AuthCard } from "@/auth/ui/auth-card";
import { AuthUnavailable } from "@/auth/ui/auth-unavailable";
import { CreateAgencyForm } from "@/auth/ui/create-agency-form";
import { toMembershipRole } from "@/db/tenant";
import { sessionClaims } from "@/db/tenant/session";
import { isClerkConfigured } from "@/lib/env";

export const metadata: Metadata = {
  title: "Getting started",
};

/**
 * The junction every signed in person passes through.
 *
 * Four outcomes, decided in a fixed order (AC-6, AC-7). One agency opens
 * itself. Several ask which. None, plus an accepted client contact row, goes to
 * the portal. None, and no contact row, offers to create an agency.
 *
 * The membership count comes from Clerk rather than the local `memberships`
 * table, and that is deliberate: Clerk is authoritative for membership, the
 * local column is a display mirror that a missed webhook can leave stale. The
 * one place that matters most is right here, where a stale zero would offer to
 * create a second agency for someone who already has one.
 *
 * This route needs a session and nothing more. It is outside the proxy's
 * organization check by construction (AC-20), because a person who has no
 * organization is exactly who it is for.
 */
export default async function OnboardingPage() {
  if (!isClerkConfigured()) {
    return (
      <AuthUnavailable
        heading="Setup is not configured"
        description="This copy of ClientHQ has no Clerk credentials, so there is no account to set up an agency for."
      />
    );
  }

  const { clerkUserId } = await sessionClaims();

  if (clerkUserId === undefined) {
    // Unreachable through the proxy, which protects this path.
    redirect("/sign-in");
  }

  const memberships = await agencyMemberships(clerkUserId);
  const [first] = memberships;

  if (first !== undefined && memberships.length === 1) {
    return (
      <AuthCard
        title="Welcome back"
        description={`Opening ${first.name}. This takes a moment the first time.`}
      >
        <ActivateAgency clerkOrgId={first.clerkOrgId} name={first.name} />
      </AuthCard>
    );
  }

  if (memberships.length > 1) {
    return (
      <AuthCard
        title="Which agency?"
        description="You work with more than one. Everything you do next belongs to the one you pick."
        footer="You can switch at any time from the top of the dashboard."
      >
        <AgencyPicker
          agencies={memberships.map((membership) => ({
            clerkOrgId: membership.clerkOrgId,
            name: membership.name,
            isAdmin: toMembershipRole(membership.clerkOrgRole) === "admin",
          }))}
        />
      </AuthCard>
    );
  }

  if (await isClientContact()) {
    redirect("/portal");
  }

  return (
    <AuthCard
      title="Name your agency"
      description="This is the one thing ClientHQ needs to get started. Everything else you add later."
      footer="Were you invited to a client portal instead? Ask your agency to send the invitation to the address you just signed in with, and you will land there rather than here."
    >
      <CreateAgencyForm />
    </AuthCard>
  );
}
