import { Lock } from "lucide-react";
import { useId } from "react";

import type { StaffContext } from "@/db/tenant";

export type LockedNoticeProps = {
  /** From the Clerk session claim. Decides who the notice says can fix it. */
  readonly role: StaffContext["role"];
};

/**
 * What `/billing` says at the top when the agency is locked out of everything
 * else (spec 0008, AC-10, AC-14).
 *
 * An agency arrives here by redirect from any other page, often without
 * knowing why, so the first thing on the screen says so in plain words, and
 * says the one thing that matters most: nothing has been deleted. That is
 * true by construction, because the gate never writes (AC-8).
 *
 * A region landmark with its own name, in the danger tint, with a lock icon so
 * the meaning does not rest on colour. The role decides only the last
 * sentence: an admin can act, a member is told who can. Rendered from the
 * level and the session, never from anything in the URL.
 */
export function LockedNotice({ role }: LockedNoticeProps) {
  const titleId = useId();

  return (
    <section
      aria-labelledby={titleId}
      data-slot="locked-notice"
      className="flex items-start gap-4 rounded-lg border border-border bg-chip-danger px-4 py-3 text-chip-danger-foreground"
    >
      <Lock aria-hidden className="mt-0.5 size-5 shrink-0" />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p id={titleId} className="text-sm font-semibold">
          Access is paused
        </p>
        <p className="text-sm">
          Your agency&rsquo;s subscription is not active, so the rest of the
          product is closed for now. Nothing has been deleted: every client,
          project and invoice is exactly where you left it.
        </p>
        <p className="text-sm">
          {role === "admin"
            ? "Subscribing again, or updating the card, restores access straight away."
            : "Only an admin of this agency can subscribe again or update the card."}
        </p>
      </div>
    </section>
  );
}
