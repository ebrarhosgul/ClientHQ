import type { Metadata } from "next";

import { clerkUser, clerkVerifiedEmails } from "@/auth/clerk";
import { AuthFrame } from "@/auth/ui/auth-frame";
import { AuthUnavailable } from "@/auth/ui/auth-unavailable";
import { parseToken } from "@/contacts/token";
import {
  AcceptInvitationCard,
  type AcceptInvitationState,
} from "@/contacts/ui/accept-invitation-card";
import { inspectInvitation } from "@/db/tenant";
import { sessionClaims } from "@/db/tenant/session";
import { env, isClerkConfigured } from "@/lib/env";

export const metadata: Metadata = {
  title: "Accept your invitation",
};

/** Sign in, then straight back here with the same token. */
function switchAccountUrl(rawToken: string): string {
  const back = new URL("/portal/accept", env().NEXT_PUBLIC_APP_URL);
  back.searchParams.set("token", rawToken);

  const signIn = new URL(
    env().NEXT_PUBLIC_CLERK_SIGN_IN_URL,
    env().NEXT_PUBLIC_APP_URL,
  );
  signIn.searchParams.set("redirect_url", back.toString());

  return signIn.toString();
}

/**
 * Which of the four states this person is in, decided once, without writing
 * (spec 0009, AC-9). The proxy has already required a session; a missing one
 * here is the no Clerk development case, handled by the page.
 */
async function resolveState(
  rawToken: string,
  clerkUserId: string,
): Promise<AcceptInvitationState> {
  const token = parseToken(rawToken);

  if (token === undefined) {
    return { kind: "invalid" };
  }

  const [user, emails] = await Promise.all([
    clerkUser(clerkUserId),
    clerkVerifiedEmails(clerkUserId),
  ]);

  if (!user.ok || !emails.ok) {
    return { kind: "invalid" };
  }

  const outcome = await inspectInvitation({
    token,
    clerkUserId,
    verifiedEmails: emails.data,
  });

  switch (outcome.kind) {
    case "acceptable":
      return {
        kind: "acceptable",
        token: rawToken,
        agencyName: outcome.agencyName,
        clientName: outcome.clientName,
        signedInEmail: user.data.email,
      };
    case "already_yours":
      return { kind: "already_yours", token: rawToken };
    case "wrong_account":
      return {
        kind: "wrong_account",
        signedInEmail: user.data.email,
        switchAccountUrl: switchAccountUrl(rawToken),
      };
    case "invalid":
      return { kind: "invalid" };
  }
}

export default async function AcceptInvitationPage({
  searchParams,
}: PageProps<"/portal/accept">) {
  const { token } = await searchParams;
  const rawToken = typeof token === "string" ? token : "";

  if (!isClerkConfigured()) {
    return (
      <AuthFrame>
        <AuthUnavailable
          heading="Invitations are not configured"
          description="This copy of ClientHQ has no Clerk credentials, so there is no account to accept an invitation with."
        />
      </AuthFrame>
    );
  }

  const { clerkUserId } = await sessionClaims();

  const state: AcceptInvitationState =
    clerkUserId === undefined
      ? { kind: "invalid" }
      : await resolveState(rawToken, clerkUserId);

  return (
    <AuthFrame>
      <AcceptInvitationCard state={state} />
    </AuthFrame>
  );
}
