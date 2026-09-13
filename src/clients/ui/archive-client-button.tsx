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
 *
 * `activeProjectCount` names how many of the client's projects are still
 * active, so archiving does not surprise anyone with open work (spec 0010,
 * AC-14). Archiving the client never touches those projects: they stay
 * active and listed on `/projects`, which the dialog copy says outright.
 */
export function ArchiveClientButton({
  clientId,
  clientName,
  activeProjectCount,
}: {
  readonly clientId: string;
  readonly clientName: string;
  readonly activeProjectCount: number;
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
      description={
        activeProjectCount > 0
          ? `This removes them from your active client list. Nothing is deleted, and you can restore them at any time. They have ${activeProjectCount} active project${activeProjectCount === 1 ? "" : "s"}, which will stay active and listed on Projects.`
          : "This removes them from your active client list. Nothing is deleted, and you can restore them at any time."
      }
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
