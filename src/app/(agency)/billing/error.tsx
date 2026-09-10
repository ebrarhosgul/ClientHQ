"use client";

import Link from "next/link";

import { ErrorState } from "@/ui/patterns/error-state";
import { Button } from "@/ui/primitives/button";

/**
 * An unexpected failure reading the subscription row (spec 0007, API surface:
 * "error state when the read fails").
 *
 * Only the read reaches here. A refused Server Action does not: both return the
 * project's `Result`, which the buttons render as an alert beside themselves,
 * so a failed Subscribe never throws the whole page away.
 *
 * The wording says the one thing an agency looking at a broken billing page
 * actually wants to know, which is that its money is not involved.
 */
export default function BillingError({
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <ErrorState
      className="my-auto"
      heading="Your billing details could not be loaded"
      description="Nothing has changed about your subscription, and nothing has been charged. This is a problem reading the page, not a problem with your account."
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      }
    />
  );
}
