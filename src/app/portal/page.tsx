import type { Metadata } from "next";

import { AuthCard } from "@/auth/ui/auth-card";
import { AuthFrame } from "@/auth/ui/auth-frame";

export const metadata: Metadata = {
  title: "Your portal",
};

/**
 * Where an invited client contact lands.
 *
 * **A placeholder. Feature 15, "Client portal", replaces this file rather than
 * extending it**, chrome included: spec 0004 gives the portal its own top bar,
 * no sidebar and no primary buttons, and none of that is built yet.
 *
 * It exists now for one reason. `/onboarding` sends a contact here (AC-7), and
 * without a real page that redirect would land on a 404. It borrows the
 * `(auth)` frame so the landing is a finished surface rather than a bare
 * message.
 *
 * A session is required to reach it and nothing else. The proxy's organization
 * check deliberately excludes this path, because a client contact never carries
 * an organization claim and would otherwise be bounced back to `/onboarding` on
 * every single load (AC-20).
 */
export default function PortalPlaceholder() {
  return (
    <AuthFrame>
      <AuthCard
        title="Your portal is nearly ready"
        description="This is where you will see your projects, the files your agency has shared with you, and your invoices."
        footer="Nothing is missing from your account. This part of ClientHQ is still being built, and your agency will let you know when it opens."
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          You are signed in, and your agency has you on their list. There is
          nothing you need to do.
        </p>
      </AuthCard>
    </AuthFrame>
  );
}
