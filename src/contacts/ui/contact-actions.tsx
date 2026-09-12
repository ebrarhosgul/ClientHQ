import type { ContactSummary } from "@/contacts/queries";
import { contactActions } from "@/contacts/status";

import { EditContactDialog } from "./edit-contact-dialog";
import { RemoveContactButton } from "./remove-contact-button";
import { RevokeInvitationButton } from "./revoke-invitation-button";
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
 * than none. Revoke, edit and remove stay, because they are allowed either way.
 */
export function ContactActions({ contact, archived }: ContactActionsProps) {
  const allowed = contactActions(contact.status);
  const canSend =
    !archived && (allowed.includes("send") || allowed.includes("resend"));
  const accepted = contact.status === "accepted";

  return (
    <div className="flex items-start justify-end gap-1 whitespace-nowrap">
      {canSend ? (
        <SendInvitationButton
          contactId={contact.id}
          contactName={contact.name}
          label={sendLabel(contact.status)}
        />
      ) : undefined}
      {allowed.includes("revoke") ? (
        <RevokeInvitationButton
          contactId={contact.id}
          contactName={contact.name}
        />
      ) : undefined}
      {allowed.includes("edit") ? (
        <EditContactDialog
          contactId={contact.id}
          name={contact.name}
          email={contact.email}
          accepted={accepted}
          pending={allowed.includes("revoke")}
        />
      ) : undefined}
      {allowed.includes("remove") ? (
        <RemoveContactButton
          contactId={contact.id}
          contactName={contact.name}
          accepted={accepted}
        />
      ) : undefined}
    </div>
  );
}
