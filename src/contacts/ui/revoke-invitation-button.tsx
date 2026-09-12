"use client";

import { Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";

import { revokeInvitation } from "@/contacts/revoke-invitation";
import type { ActionError } from "@/db/tenant";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { SubmitButton } from "@/ui/primitives/submit-button";

export type RevokeInvitationButtonProps = {
  readonly contactId: string;
  readonly contactName: string;
};

/**
 * Take back a pending or expired invitation (spec 0009, AC-7). No confirm
 * dialog: nothing is deleted, and sending again puts it right back.
 */
export function RevokeInvitationButton({
  contactId,
  contactName,
}: RevokeInvitationButtonProps) {
  const router = useRouter();

  const [state, submit] = useActionState<
    { readonly error?: ActionError },
    FormData
  >(async () => {
    const result = await revokeInvitation({ contactId });

    router.refresh();

    return result.ok ? {} : { error: result.error };
  }, {});

  return (
    <form action={submit} className="inline-flex flex-col items-start gap-1">
      <SubmitButton
        size="sm"
        variant="ghost"
        pendingLabel="Revoking…"
        aria-label={`Revoke the invitation to ${contactName}`}
      >
        <Undo2 />
        Revoke
      </SubmitButton>
      {state.error ? (
        <p
          role="alert"
          className="w-56 text-left text-xs whitespace-normal text-destructive"
        >
          <ActionErrorMessage error={state.error} />
        </p>
      ) : undefined}
    </form>
  );
}
