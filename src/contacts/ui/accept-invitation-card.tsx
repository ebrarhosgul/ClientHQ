import { SignOutButton } from "@clerk/nextjs";
import Link from "next/link";
import type { ReactNode } from "react";

import { AuthCard } from "@/auth/ui/auth-card";
import { Button } from "@/ui/primitives/button";

import { AcceptInvitationForm } from "./accept-invitation-form";

/**
 * The four states of `/portal/accept`, with the copy pinned by spec 0009,
 * AC-9. Presentational: the page decides which state applies and this renders
 * it, which is also what lets `/design` show all four from fixtures.
 *
 * The wrong account state names only the signed in address, never the
 * contact's, and the invalid state is one sentence for every cause so nothing
 * reveals whether a contact exists.
 */
export type AcceptInvitationState =
  | {
      readonly kind: "acceptable";
      readonly token: string;
      readonly agencyName: string;
      readonly clientName: string;
      readonly signedInEmail: string;
    }
  | { readonly kind: "already_yours"; readonly token: string }
  | {
      readonly kind: "wrong_account";
      readonly signedInEmail: string;
      /** Where sign out lands: sign in, carrying this page as the return URL. */
      readonly switchAccountUrl: string;
    }
  | { readonly kind: "invalid" };

export type AcceptInvitationCardProps = {
  readonly state: AcceptInvitationState;
  /**
   * `/design` renders outside `ClerkProvider`, where `SignOutButton` cannot
   * mount; it passes a plain link instead. Real pages leave this unset.
   */
  readonly signOutControl?: ReactNode;
};

const INVALID_BODY =
  "It may have expired, been replaced by a newer one, or already been used. Ask your agency to send a new invitation.";

export function AcceptInvitationCard({
  state,
  signOutControl,
}: AcceptInvitationCardProps) {
  switch (state.kind) {
    case "acceptable":
      return (
        <AuthCard
          title="Accept your invitation"
          description={`${state.agencyName} has invited you to the client portal for ${state.clientName}. You are signed in as ${state.signedInEmail}.`}
          footer="Accepting links this account to your client's portal. Nothing is shared with anyone else."
        >
          <AcceptInvitationForm token={state.token} />
        </AuthCard>
      );

    case "already_yours":
      return (
        <AuthCard
          title="You already accepted this invitation"
          description="This link has done its job. Your portal is ready whenever you are."
        >
          <AcceptInvitationForm token={state.token} label="Go to your portal" />
        </AuthCard>
      );

    case "wrong_account":
      return (
        <AuthCard
          title="This invitation is for a different email address"
          description={`You are signed in as ${state.signedInEmail}. Sign in with the address that received the invitation to accept it.`}
        >
          {signOutControl ?? (
            <SignOutButton redirectUrl={state.switchAccountUrl}>
              <Button
                variant="outline"
                className="h-auto min-h-9 w-full whitespace-normal"
              >
                Sign out and switch account
              </Button>
            </SignOutButton>
          )}
        </AuthCard>
      );

    case "invalid":
      return (
        <AuthCard
          title="This invitation link is not valid"
          description={INVALID_BODY}
        >
          <Button asChild variant="outline" className="w-full">
            <Link href="/">Back to ClientHQ</Link>
          </Button>
        </AuthCard>
      );
  }
}
