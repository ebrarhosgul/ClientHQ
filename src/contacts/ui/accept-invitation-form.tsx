"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";

import { acceptInvitation } from "@/contacts/accept-invitation";
import type { ActionError } from "@/db/tenant";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { SubmitButton } from "@/ui/primitives/submit-button";

export type AcceptInvitationFormProps = {
  readonly token: string;
  readonly label?: string;
};

/**
 * The one button on the accept page (spec 0009, AC-9, AC-10).
 *
 * Acceptance is a submit, never a page load: the token rides in a hidden field
 * and the action redirects to `/portal` on success. A failure comes back as a
 * `Result`; the page is refreshed so it re inspects the row and shows the
 * state the row is now in (invalid, or wrong account), and the reason is
 * announced inline meanwhile.
 */
export function AcceptInvitationForm({
  token,
  label = "Accept invitation",
}: AcceptInvitationFormProps) {
  const router = useRouter();

  const [state, submit] = useActionState<
    { readonly error?: ActionError },
    FormData
  >(async (_previous, form) => {
    const result = await acceptInvitation({ token: form.get("token") });

    if (!result.ok) {
      router.refresh();
      return { error: result.error };
    }

    return {};
  }, {});

  return (
    <form action={submit} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          <ActionErrorMessage error={state.error} />
        </p>
      ) : undefined}
      <SubmitButton className="w-full" pendingLabel="Working…">
        {label}
      </SubmitButton>
    </form>
  );
}
