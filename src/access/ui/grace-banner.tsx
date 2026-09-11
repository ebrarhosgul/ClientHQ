import { ExternalLink, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useId } from "react";

import type { StaffContext } from "@/db/tenant";
import { formatBillingDateTime } from "@/payments/billing-state";
import { OpenBillingPortalButton } from "@/payments/ui/billing-actions";
import { Button } from "@/ui/primitives/button";

export type GraceBannerProps = {
  /** When the window closes: `past_due_since` plus 7 days. */
  readonly graceEndsAt: Date;
  /** From the Clerk session claim. Decides what the banner offers, never who may read. */
  readonly role: StaffContext["role"];
};

/**
 * The one thing on screen that says why nothing will save (spec 0008, AC-5,
 * AC-14).
 *
 * Rendered by the gated layout above every page while the agency is in its
 * grace window, and in no other level. It is a region landmark with its own
 * accessible name, so a screen reader can jump to it and past it; the meaning
 * is in the words and the icon, and the warning tint only reinforces them.
 *
 * Two variants, one difference: an admin can fix it, so they get the portal
 * button; a member cannot, so they are told who can and pointed at `/billing`
 * for the detail. Nothing here decides access. The wrapper refuses the write
 * whether or not this banner rendered.
 */
export function GraceBanner({ graceEndsAt, role }: GraceBannerProps) {
  const titleId = useId();
  const until = formatBillingDateTime(graceEndsAt);

  return (
    <section
      aria-labelledby={titleId}
      data-slot="grace-banner"
      className="flex flex-wrap items-start gap-x-4 gap-y-3 rounded-lg border border-border bg-chip-warning px-4 py-3 text-chip-warning-foreground"
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p id={titleId} className="text-sm font-semibold">
          Your last payment failed, so changes are paused
        </p>
        <p className="text-sm">
          You can still read everything, but nothing will save until the card is
          updated. If it is not sorted out by{" "}
          <time dateTime={graceEndsAt.toISOString()}>{until}</time>, access
          pauses until it is. Nothing is deleted either way.
        </p>
        {role === "member" ? (
          <p className="text-sm">
            Only an admin of this agency can update the card.
          </p>
        ) : undefined}
      </div>

      <div className="flex w-full shrink-0 items-center sm:w-auto">
        {role === "admin" ? (
          <OpenBillingPortalButton>
            <ExternalLink />
            Update your card
          </OpenBillingPortalButton>
        ) : (
          <Button asChild variant="outline">
            <Link href="/billing">See billing</Link>
          </Button>
        )}
      </div>
    </section>
  );
}
