"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { ConfirmDialog } from "@/ui/patterns/confirm-dialog";
import { Button } from "@/ui/primitives/button";

import { deleteDeliverable } from "../delete-deliverable";

/** Behind a confirm, exactly like `ArchiveProjectButton` (spec 0011, AC-15). */
export function DeleteDeliverableButton({
  deliverableId,
  name,
}: {
  readonly deliverableId: string;
  readonly name: string;
}) {
  const router = useRouter();

  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${name}`}>
          <Trash2 />
        </Button>
      }
      title={`Delete ${name}?`}
      description="This removes the file from storage. It cannot be undone."
      confirmLabel="Delete"
      pendingLabel="Deleting…"
      variant="destructive"
      onConfirm={async () => {
        const result = await deleteDeliverable({ deliverableId });

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
