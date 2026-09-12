import type { ContactSummary } from "@/contacts/queries";
import { contactActions } from "@/contacts/status";

import { SendInvitationButton } from "./send-invitation-button";

export type ContactActionsProps = {
  readonly contact: ContactSummary;
  readonly archived: boolean;
};

/** The label the send button wears in each status that allows a send. */
function sendLabel(status: ContactSummary["status"]): string {
  switch (status) {
    case "not_invited":
      return "Send invitation";
    case "unsent":
      return "Send again";
    default:
      return "Resend";
  }
}

/**
 * The per row action set, from `contactActions(status)` (spec 0009, AC-14).
 *
 * On an archived client the send is withheld rather than offered and refused:
 * the action would answer `conflict`, and a button that always fails is worse
 * than none. Edit and remove stay, because they are allowed either way.
 */
export function ContactActions({ contact, archived }: ContactActionsProps) {
  const allowed = contactActions(contact.status);
  const canSend =
    !archived && (allowed.includes("send") || allowed.includes("resend"));

  return (
    <div className="flex flex-wrap items-start justify-end gap-2">
      {canSend ? (
        <SendInvitationButton
          contactId={contact.id}
          contactName={contact.name}
          label={sendLabel(contact.status)}
        />
      ) : undefined}
    </div>
  );
}
