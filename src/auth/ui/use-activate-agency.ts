"use client";

import { useOrganizationList } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

export type ActivationState = "idle" | "working" | "failed";

/**
 * Make one agency the active organization, then go to its dashboard.
 *
 * Activation is a client call because that is where the session lives:
 * `setActive()` writes the Clerk session cookie in the browser, and the session
 * claim the proxy and the tenant layer both read comes from that cookie. The
 * `await` is the whole point (AC-6). Navigating first would arrive at
 * `/dashboard` with no organization claim yet, the proxy would send the person
 * straight back to `/onboarding`, and the loop would look like the button was
 * broken.
 */
export function useActivateAgency() {
  const { setActive } = useOrganizationList();
  const router = useRouter();
  const [state, setState] = useState<ActivationState>("idle");

  const activate = useCallback(
    async (clerkOrgId: string): Promise<void> => {
      if (setActive === undefined) {
        return;
      }

      setState("working");

      try {
        await setActive({ organization: clerkOrgId });
        router.replace("/dashboard");
      } catch {
        setState("failed");
      }
    },
    [setActive, router],
  );

  return {
    /** Clerk has loaded and `activate` will do something. */
    ready: setActive !== undefined,
    state,
    activate,
  };
}
