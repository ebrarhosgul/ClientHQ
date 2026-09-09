import Link from "next/link";

import { Button } from "@/ui/primitives/button";

import { AuthCard } from "./auth-card";

export type AuthUnavailableProps = {
  readonly heading: string;
  readonly description: string;
};

/**
 * What sign in, sign up and onboarding render when Clerk has no publishable key
 * on this machine.
 *
 * Spec 0004 made this a deliberate property of the project: the root layout
 * mounts `ClerkProvider` only when there is a key, so the repository can be
 * cloned and looked at without signing up to a provider first, and the browser
 * suite in CI runs with no provider credentials at all. Without this panel the
 * three routes would render nothing, and the axe run over them (AC-3, AC-18)
 * would have nothing real to measure.
 *
 * An honest dead end rather than a pretend form: it says what is missing and
 * offers the one thing that still works, which is going back.
 */
export function AuthUnavailable({
  heading,
  description,
}: AuthUnavailableProps) {
  return (
    <AuthCard
      title={heading}
      description={description}
      footer={
        <>
          Set{" "}
          <code className="font-mono">NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code>{" "}
          and <code className="font-mono">CLERK_SECRET_KEY</code> in{" "}
          <code className="font-mono">.env.local</code>, then restart the dev
          server. See <code className="font-mono">.env.example</code>.
        </>
      }
    >
      <Button asChild variant="outline" className="w-full">
        <Link href="/">Back to the start</Link>
      </Button>
    </AuthCard>
  );
}
