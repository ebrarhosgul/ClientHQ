"use client";

/**
 * The consent banner (spec 0019, AC-18).
 *
 * A landmark, not a dialog: `<section aria-label="Cookie preferences">`,
 * fixed to the bottom of the viewport, no focus trap, reached by keyboard in
 * document order after the page's own content. One sentence, a link to the
 * notice, and two buttons of equal weight, because declining has to be as
 * easy as accepting.
 *
 * It sits centred at the bottom, so the toast region in the bottom right
 * corner stays clear, and it never covers the skip link target at the top. Shown only while
 * the choice is `undecided` and never under `/portal`, where no analytics
 * script exists to consent to.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";

import { messageForCode } from "@/ui/patterns/error-messages";
import { Button } from "@/ui/primitives/button";

import { setCookieConsent } from "../consent";
import { useConsent } from "../consent-context";
import type { ConsentState } from "../consent-state";
import { isTrackedPath } from "../tracked-path";

export function CookieBanner() {
  const pathname = usePathname();
  const { consent, setConsent } = useConsent();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>(undefined);

  if (consent !== "undecided" || !isTrackedPath(pathname)) {
    return null;
  }

  const choose = (choice: Exclude<ConsentState, "undecided">) => {
    startTransition(async () => {
      const result = await setCookieConsent(choice);

      if (result.ok) {
        setError(undefined);
        setConsent(choice);
      } else {
        setError(messageForCode(result.error.code));
      }
    });
  };

  return (
    <section
      aria-label="Cookie preferences"
      data-slot="cookie-banner"
      className="fixed bottom-4 left-1/2 z-40 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg"
    >
      <p className="text-sm">
        Page view analytics run without a cookie until you accept one. Read what
        is collected in the{" "}
        <Link href="/privacy" className="link-accent-inline">
          privacy notice
        </Link>
        .
      </p>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : undefined}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => choose("accepted")}
        >
          Accept
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => choose("declined")}
        >
          Decline
        </Button>
      </div>
    </section>
  );
}
