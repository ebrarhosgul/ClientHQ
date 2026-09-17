"use client";

import { MailX } from "lucide-react";
import { useRouter } from "next/navigation";

import { revokeTeamInvitation } from "@/team/revoke-team-invitation";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { ConfirmDialog } from "@/ui/patterns/confirm-dialog";
import { Button } from "@/ui/primitives/button";

export type RevokeInvitationButtonProps = {
  readonly invitationId: string;
  readonly email: string;
};

/** Revoke a pending invitation after a short confirm (spec 0015, AC-4). */
export function RevokeInvitationButton({
  invitationId,
  email,
}: RevokeInvitationButtonProps) {
  const router = useRouter();

  return (
    <ConfirmDialog
      trigger={
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Revoke invitation to ${email}`}
        >
          <MailX />
          Revoke
        </Button>
      }
      title={`Revoke the invitation to ${email}?`}
      description="The link in their email stops working. You can invite them again afterwards."
      confirmLabel="Revoke"
      pendingLabel="Revoking…"
      variant="destructive"
      onConfirm={async () => {
        const result = await revokeTeamInvitation({ invitationId });

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
