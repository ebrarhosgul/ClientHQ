"use client";

import { Archive } from "lucide-react";
import { useRouter } from "next/navigation";

import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { ConfirmDialog } from "@/ui/patterns/confirm-dialog";
import { Button } from "@/ui/primitives/button";

import { archiveProject } from "../archive-project";

/**
 * Admin only (spec 0010, AC-11, AC-12): the page never renders this for a
 * member, and the action itself refuses one with `forbidden` regardless.
 */
export function ArchiveProjectButton({
  projectId,
  projectName,
}: {
  readonly projectId: string;
  readonly projectName: string;
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
      title={`Archive ${projectName}?`}
      description="It keeps its status and leaves the open list. An admin can restore it later."
      confirmLabel="Archive"
      pendingLabel="Archiving…"
      variant="destructive"
      onConfirm={async () => {
        const result = await archiveProject({ id: projectId });

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
