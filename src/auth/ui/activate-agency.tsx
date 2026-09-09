"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";

import { ActivationFailed } from "./activation-failed";
import { useActivateAgency } from "./use-activate-agency";

export type ActivateAgencyProps = {
  readonly clerkOrgId: string;
  readonly name: string;
};

/**
 * One agency, one membership, nothing to choose: open it.
 *
 * Returning staff should not be asked which agency they work for on every
 * session (AC-6), so this activates on arrival and moves on. The person sees a
 * short busy state rather than a dead page, announced through `role="status"`
 * rather than carried by the spinner, which is decorative and does not turn
 * under `prefers-reduced-motion`.
 */
export function ActivateAgency({ clerkOrgId, name }: ActivateAgencyProps) {
  const { ready, state, activate } = useActivateAgency();
  const started = useRef(false);

  useEffect(() => {
    if (!ready || started.current) {
      return;
    }

    started.current = true;
    void activate(clerkOrgId);
  }, [ready, activate, clerkOrgId]);

  if (state === "failed") {
    return (
      <ActivationFailed
        name={name}
        onRetry={() => {
          void activate(clerkOrgId);
        }}
      />
    );
  }

  return (
    <p
      role="status"
      className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
    >
      <LoaderCircle aria-hidden className="size-4 animate-spin" />
      Opening {name}…
    </p>
  );
}
