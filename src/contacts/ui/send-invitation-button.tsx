"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";

import { sendInvitation } from "@/contacts/send-invitation";
import type { ActionError } from "@/db/tenant";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { SubmitButton } from "@/ui/primitives/submit-button";

export type SendInvitationButtonProps = {
  readonly contactId: string;
  readonly contactName: string;
  /** `Send invitation` before any send, `Resend` or `Send again` after. */
  readonly label: string;
};

/**
 * Send, or resend, one contact's invitation (spec 0009, AC-3).
 *
 * A form rather than a click handler, so the pending state and the failure
 * message follow the same pattern as every other write in the product. The
 * accessible name carries the contact's name, because a table of identical
 * "Resend" buttons is a list a screen reader cannot tell apart.
 */
export function SendInvitationButton({
  contactId,
  contactName,
  label,
}: SendInvitationButtonProps) {
  const router = useRouter();

  const [state, submit] = useActionState<
    { readonly error?: ActionError },
    FormData
  >(async () => {
    const result = await sendInvitation({ contactId });

    if (!result.ok) {
      // The row may have changed even on failure (an `unsent` badge after a
      // provider refusal), so refresh either way.
      router.refresh();
      return { error: result.error };
    }

    router.refresh();
    return {};
  }, {});

  return (
    <form action={submit} className="inline-flex flex-col items-end gap-1">
      <SubmitButton
        size="sm"
        variant="outline"
        pendingLabel="Sending…"
        aria-label={`${label} to ${contactName}`}
      >
        <Send />
        {label}
      </SubmitButton>
      {state.error ? (
        <p
          role="alert"
          className="max-w-xs text-right text-xs text-destructive"
        >
          <ActionErrorMessage error={state.error} />
        </p>
      ) : undefined}
    </form>
  );
}
