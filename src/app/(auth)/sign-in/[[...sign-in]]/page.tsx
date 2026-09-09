import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthUnavailable } from "@/auth/ui/auth-unavailable";
import { sessionClaims } from "@/db/tenant/session";
import { isClerkConfigured } from "@/lib/env";

export const metadata: Metadata = {
  title: "Sign in",
};

/**
 * The front door, on this product's own route.
 *
 * A catch all segment because Clerk drives verification, second factor and SSO
 * callback steps on sub paths of `/sign-in`; a plain `page.tsx` would 404 on
 * every one of them (AC-1, and the reason the proxy's public list carries
 * `/sign-in(.*)` rather than `/sign-in`).
 *
 * Where a completed sign in lands is not decided here. It comes from
 * `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`, which points at
 * `/onboarding`, and that page works out whether this person has an agency, a
 * choice of agencies, a client portal, or an agency still to create.
 */
export default async function SignInPage() {
  if (!isClerkConfigured()) {
    return (
      <AuthUnavailable
        heading="Sign in is not configured"
        description="This copy of ClientHQ has no Clerk credentials, so there is no sign in to show. Everything that does not need an account still works."
      />
    );
  }

  // Already inside an agency: there is nothing to sign in to (AC-16).
  const { clerkOrgId } = await sessionClaims();

  if (clerkOrgId !== undefined) {
    redirect("/dashboard");
  }

  return (
    <div className="w-full max-w-sm">
      <SignIn />
    </div>
  );
}
