"use client";

import { useClerk } from "@clerk/nextjs";

import { Button } from "@/ui/primitives/button";

/**
 * The `/portal/unavailable` page's own way out (spec 0014, AC-3): a real
 * sign out, not a link to `/sign-in` that leaves the session open. Styled as
 * a link, since `variant="link"` is exactly a link's own type and appearance
 * with a click handler where an anchor cannot carry one.
 */
export function PortalSignOutLink() {
  const { signOut } = useClerk();

  return (
    <Button
      variant="link"
      className="h-auto p-0"
      onClick={() => void signOut({ redirectUrl: "/" })}
    >
      Sign out
    </Button>
  );
}
