"use client";

import { LogOut, UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId } from "react";

import { removeTeamMember } from "@/team/remove-team-member";
import { LAST_ADMIN_REASON } from "@/team/rules";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { ConfirmDialog } from "@/ui/patterns/confirm-dialog";
import { Button } from "@/ui/primitives/button";

import { useSessionSync } from "./session-sync";

export type RemoveMemberButtonProps = {
  readonly membershipId: string;
  readonly memberName: string;
  readonly agencyName: string;
  readonly self: boolean;
  readonly lockedAsLastAdmin: boolean;
};

/**
 * Remove a member, or leave the agency yourself, after a confirm dialog that
 * names the person (spec 0015, AC-6, AC-7, AC-14). Leaving ends this
 * session's organization and lands on `/onboarding`.
 */
export function RemoveMemberButton({
  membershipId,
  memberName,
  agencyName,
  self,
  lockedAsLastAdmin,
}: RemoveMemberButtonProps) {
  const router = useRouter();
  const session = useSessionSync();
  const reasonId = useId();

  const label = self ? "Leave agency" : `Remove ${memberName}`;

  if (lockedAsLastAdmin) {
    return (
      <>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled
          aria-label={label}
          aria-describedby={reasonId}
        >
          {self ? <LogOut /> : <UserMinus />}
        </Button>
        {/* Not a tooltip (AC-14): a `title` on a disabled button is not
            keyboard reachable, not shown on touch, and inconsistently
            exposed by screen readers. The Role cell already carries this
            reason as visible text; this ties it to the button itself. */}
        <span id={reasonId} className="sr-only">
          {LAST_ADMIN_REASON}
        </span>
      </>
    );
  }

  return (
    <ConfirmDialog
      trigger={
        <Button size="icon-sm" variant="ghost" aria-label={label}>
          {self ? <LogOut /> : <UserMinus />}
        </Button>
      }
      title={
        self
          ? `Leave ${agencyName}?`
          : `Remove ${memberName} from ${agencyName}?`
      }
      description={
        self
          ? "You will be signed out of this agency and will need a new invitation to return."
          : "They lose access immediately."
      }
      confirmLabel={self ? "Leave" : "Remove"}
      pendingLabel={self ? "Leaving…" : "Removing…"}
      variant="destructive"
      onConfirm={async () => {
        const result = await removeTeamMember({ membershipId });

        if (!result.ok) {
          return {
            ok: false,
            message: <ActionErrorMessage error={result.error} />,
          };
        }

        if (result.data.self) {
          await session?.leftAgency();
          router.push("/onboarding");
        } else {
          router.refresh();
        }

        return { ok: true };
      }}
    />
  );
}
