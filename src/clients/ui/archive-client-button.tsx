"use client";

import { Archive } from "lucide-react";
import { useRouter } from "next/navigation";

import { archiveClient } from "@/clients/archive-client";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { ConfirmDialog } from "@/ui/patterns/confirm-dialog";
import { Button } from "@/ui/primitives/button";

/**
 * Archiving asks for confirmation first (spec 0006, AC-8); restoring, right
 * beside it, does not (`RestoreClientButton`).
 */
export function ArchiveClientButton({
  clientId,
  clientName,
}: {
  readonly clientId: string;
  readonly clientName: string;
}) {
  const router = useRouter();

  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline">
          <Archive />
          Archive
        </Button>
      }
      title={`Archive ${clientName}?`}
      description="This removes them from your active client list. Nothing is deleted, and you can restore them at any time."
      confirmLabel="Archive"
      pendingLabel="Archiving…"
      variant="destructive"
      onConfirm={async () => {
        const result = await archiveClient({ id: clientId });

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
