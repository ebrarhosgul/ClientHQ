"use client";

import Link from "next/link";

import { ErrorState } from "@/ui/patterns/error-state";
import { Button } from "@/ui/primitives/button";

/**
 * An unexpected read failure on a single client's page (spec 0006, API
 * surface). `notFound()` never reaches here: this is only an unexpected
 * failure, not a missing or foreign row.
 */
export default function ClientError({
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <ErrorState
      className="my-auto"
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            <Link href="/clients">Back to clients</Link>
          </Button>
        </div>
      }
    />
  );
}
