"use client";

import Link from "next/link";

import { ErrorState } from "@/ui/patterns/error-state";
import { useReportedError } from "@/ui/patterns/use-reported-error";
import { Button } from "@/ui/primitives/button";

/**
 * The agency area's own error boundary (spec 0008, AC-12).
 *
 * It sits above the `(gated)` layout, so when the access gate's subscription
 * read fails the throw lands here and renders inside the shell, with the
 * sidebar still there and a way out. That is the fail closed half of the gate:
 * a page whose level nobody could read does not render, and it does not
 * render as a bare 500 either.
 *
 * `/billing` and `/clients/[id]` keep their own boundaries below this one,
 * with wording specific to what those pages were doing. This one only knows
 * that something inside the agency area could not be loaded.
 */
export default function AgencyError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  const reference = useReportedError(error);

  return (
    <ErrorState
      reference={reference}
      className="my-auto"
      description="This page could not be loaded. Nothing you did caused it, nothing has been lost, and your subscription is not affected."
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            <Link href="/billing">Open billing</Link>
          </Button>
        </div>
      }
    />
  );
}
