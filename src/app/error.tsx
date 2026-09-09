"use client";

import Link from "next/link";

import { ErrorState } from "@/ui/patterns/error-state";
import { Button } from "@/ui/primitives/button";

/**
 * The route segment boundary.
 *
 * Renders the shared error state and nothing else (AC-12). `error.digest` is
 * deliberately never shown: it is a number a person cannot act on, and in
 * production it is the only thing here that could hint at the shape of the
 * system. The real detail goes to the server log and, later, to Sentry.
 */
export default function RouteError({
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <ErrorState
        className="w-full max-w-md"
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={reset}>Try again</Button>
            <Button asChild variant="outline">
              <Link href="/">Go to the start</Link>
            </Button>
          </div>
        }
      />
    </main>
  );
}
