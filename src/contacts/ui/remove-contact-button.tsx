"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { removeContact } from "@/contacts/remove-contact";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { ConfirmDialog } from "@/ui/patterns/confirm-dialog";
import { Button } from "@/ui/primitives/button";

export type RemoveContactButtonProps = {
  readonly contactId: string;
  readonly contactName: string;
  readonly accepted: boolean;
};

/**
 * Remove a contact, after a confirm dialog (spec 0009, AC-8). The description
 * says what removal costs in this status: an accepted contact loses the
 * portal, a pending one loses the link.
 */
export function RemoveContactButton({
  contactId,
  contactName,
  accepted,
}: RemoveContactButtonProps) {
  const router = useRouter();

  return (
    <ConfirmDialog
      trigger={
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Remove ${contactName}`}
        >
          <Trash2 />
        </Button>
      }
      title={`Remove ${contactName}?`}
      description={
        accepted
          ? "They lose access to the client portal straight away. You can add them again later, which sends a new invitation."
          : "Any invitation link they were sent stops working. You can add them again later."
      }
      confirmLabel="Remove"
      pendingLabel="Removing…"
      variant="destructive"
      onConfirm={async () => {
        const result = await removeContact({ contactId });

        if (!result.ok) {
          return {
            ok: false,
            message: <ActionErrorMessage error={result.error} />,
          };
        }

        router.refresh();

        return { ok: true };
      }}
    />
  );
}
