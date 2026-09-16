"use client";

import Link from "next/link";

import { ErrorState } from "@/ui/patterns/error-state";
import { Button } from "@/ui/primitives/button";

/**
 * The portal's own error boundary (spec 0014, AC-15).
 *
 * It catches a failing page or query inside `(contact)`, with the chrome
 * still around it and a `Try again` button. It does not catch a failure in
 * `(contact)/layout.tsx` itself (Next's own rule: `error.js` never catches a
 * throw from its own segment's `layout.js`), so a genuine `portalContext()`
 * resolution error there (anything but the redirects `resolveContact` already
 * handles) still falls through to the root boundary; a documented, accepted
 * gap rather than a silent one.
 */
export default function PortalError({
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <ErrorState
      className="my-auto"
      description="This page could not be loaded. Nothing you did caused it, and nothing has been lost."
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            <Link href="/portal">Back to your portal</Link>
          </Button>
        </div>
      }
    />
  );
}
