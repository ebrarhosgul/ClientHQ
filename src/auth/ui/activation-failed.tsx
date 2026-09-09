"use client";

import { Button } from "@/ui/primitives/button";
import { Alert, AlertDescription, AlertTitle } from "@/ui/primitives/alert";

export type ActivationFailedProps = {
  readonly name: string | undefined;
  readonly onRetry: () => void;
};

/**
 * What a failed `setActive()` looks like.
 *
 * Beside the thing that failed and never only in a toast (design.md,
 * accessibility rule 7), with the one action that helps. `Alert` already
 * carries `role="alert"`, so someone who was not looking at this part of the
 * page still hears it.
 */
export function ActivationFailed({ name, onRetry }: ActivationFailedProps) {
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="destructive">
        <AlertTitle>That did not open</AlertTitle>
        <AlertDescription>
          <p>
            {name === undefined
              ? "We could not switch you into that agency."
              : `We could not switch you into ${name}.`}{" "}
            Nothing was lost. Try again.
          </p>
        </AlertDescription>
      </Alert>

      <Button type="button" onClick={onRetry} className="w-full">
        Try again
      </Button>
    </div>
  );
}
