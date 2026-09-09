import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthUnavailable } from "@/auth/ui/auth-unavailable";
import { sessionClaims } from "@/db/tenant/session";
import { isClerkConfigured } from "@/lib/env";

export const metadata: Metadata = {
  title: "Create an agency",
};

/**
 * Signing up, on this product's own route.
 *
 * A catch all segment for the same reason as `/sign-in`: Clerk drives email
 * verification and SSO callbacks on sub paths of this one (AC-1).
 *
 * Signing up creates a *person*, not an agency. The agency is created a step
 * later on `/onboarding`, which is where
 * `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` sends a completed sign up,
 * because someone arriving from a client portal invitation should never be
 * asked to create an agency at all (AC-7).
 */
export default async function SignUpPage() {
  if (!isClerkConfigured()) {
    return (
      <AuthUnavailable
        heading="Sign up is not configured"
        description="This copy of ClientHQ has no Clerk credentials, so there is no sign up to show. Everything that does not need an account still works."
      />
    );
  }

  const { clerkOrgId } = await sessionClaims();

  if (clerkOrgId !== undefined) {
    redirect("/dashboard");
  }

  return (
    <div className="w-full max-w-sm">
      <SignUp />
    </div>
  );
}
