import type { ReactNode } from "react";

import { cn } from "@/ui/lib/cn";

/**
 * The one error state, and what `error.tsx`, `not-found.tsx` and
 * `global-error.tsx` all render (AC-12).
 *
 * Three rules it exists to enforce:
 *
 * 1. A heading and a plain sentence, never a stack trace, a driver message or
 *    an `error.digest`. A digest is a number a person cannot act on and it can
 *    leak the shape of the system.
 * 2. Always a way forward: a retry, a link back, or both. An error screen with
 *    no exit is a dead end.
 * 3. `role="alert"`, so someone who was reading elsewhere on the page when the
 *    boundary caught is told rather than left waiting.
 */
export type ErrorStateProps = {
  readonly heading?: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly className?: string;
};

export const DEFAULT_ERROR_HEADING = "Something went wrong";
export const DEFAULT_ERROR_DESCRIPTION =
  "This page could not be loaded. Nothing you did caused it, and nothing has been lost.";

export function ErrorState({
  heading = DEFAULT_ERROR_HEADING,
  description = DEFAULT_ERROR_DESCRIPTION,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card px-6 py-12 text-center",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-card-foreground">
          {heading}
        </p>
        <p className="max-w-prose text-sm text-muted-foreground">
          {description}
        </p>
      </div>

      {action ? <div className="mt-1">{action}</div> : undefined}
    </div>
  );
}
