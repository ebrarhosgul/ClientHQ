import Link from "next/link";

import { ErrorState } from "@/ui/patterns/error-state";
import { Button } from "@/ui/primitives/button";

/**
 * Every hidden, foreign, missing or malformed id in the portal (spec 0014,
 * AC-7, AC-10, AC-12): one identical page, with a real `404` status, so
 * nothing here reveals which case applied. Renders inside the `(contact)`
 * chrome, the same way `(agency)/not-found.tsx` renders inside the agency
 * shell.
 */
export default function PortalNotFound() {
  return (
    <ErrorState
      className="my-auto"
      heading="This page is not available"
      description="It may have been removed or is no longer shared with you. Ask your agency if you expected to find it here."
      action={
        <Button asChild>
          <Link href="/portal">Back to your portal</Link>
        </Button>
      }
    />
  );
}
