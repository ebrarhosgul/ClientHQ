"use client";

import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ActionError } from "@/db/tenant";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { Alert, AlertDescription, AlertTitle } from "@/ui/primitives/alert";

import { ResendButton } from "./invoice-actions";

/**
 * Shown when the invoice's most recent notification attempt failed (spec
 * 0012, AC-11): names the reason from the event's note and offers Resend,
 * which is subject to the same cooldown as the button in the actions group.
 * An error is never only in a toast, so the resend's own failure renders
 * here too.
 */
export function NotificationWarning({
  invoiceId,
  reason,
  canResend,
}: {
  readonly invoiceId: string;
  readonly reason: string;
  /** False on a paid or void invoice, where resend is not offered. */
  readonly canResend: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<ActionError | undefined>(undefined);

  return (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertTitle>
        The client may not have been told about this invoice
      </AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <p>The last notification attempt did not reach everyone: {reason}.</p>
        {canResend ? (
          <ResendButton
            invoiceId={invoiceId}
            onDone={(nextError) => {
              setError(nextError);
              router.refresh();
            }}
          />
        ) : undefined}
        {error ? (
          <p role="alert">
            <ActionErrorMessage error={error} />
          </p>
        ) : undefined}
      </AlertDescription>
    </Alert>
  );
}
