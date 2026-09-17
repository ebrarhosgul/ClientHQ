"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import type { MembershipRole } from "@/db/schema";
import type { ActionError } from "@/db/tenant";
import { changeTeamMemberRole } from "@/team/change-team-member-role";
import { LAST_ADMIN_REASON, roleLabel } from "@/team/rules";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/primitives/select";

import { useSessionSync } from "./session-sync";

export type MemberRoleSelectProps = {
  readonly membershipId: string;
  readonly memberName: string;
  readonly role: MembershipRole;
  readonly self: boolean;
  readonly clerkOrgId: string;
  /** The acting admin is the only admin, so their own row is locked (AC-14). */
  readonly lockedAsLastAdmin: boolean;
};

type Outcome =
  | { readonly kind: "idle" }
  | { readonly kind: "updated" }
  | { readonly kind: "failed"; readonly error: ActionError };

/**
 * The per row role control (spec 0015, AC-5, AC-7, AC-14): saves on change,
 * shows a pending state, and announces the result in a live region beside
 * the control. On the acting admin's own row, when they are the only admin,
 * it is disabled with the reason as visible text.
 */
export function MemberRoleSelect({
  membershipId,
  memberName,
  role,
  self,
  clerkOrgId,
  lockedAsLastAdmin,
}: MemberRoleSelectProps) {
  const router = useRouter();
  const session = useSessionSync();
  const statusId = useId();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState<MembershipRole>(role);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  const change = (next: MembershipRole) => {
    if (next === current) {
      return;
    }

    startTransition(async () => {
      const result = await changeTeamMemberRole({ membershipId, role: next });

      if (!result.ok) {
        setOutcome({ kind: "failed", error: result.error });
        return;
      }

      setCurrent(result.data.role);
      setOutcome({ kind: "updated" });

      if (result.data.self) {
        await session?.roleChanged(clerkOrgId);
      }

      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <Select
        value={current}
        onValueChange={(value) => change(value as MembershipRole)}
        disabled={lockedAsLastAdmin || pending}
      >
        <SelectTrigger
          size="sm"
          aria-label={`Role for ${self ? "you" : memberName}`}
          aria-describedby={statusId}
          aria-busy={pending || undefined}
          className="w-32"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="member">{roleLabel("member")}</SelectItem>
          <SelectItem value="admin">{roleLabel("admin")}</SelectItem>
        </SelectContent>
      </Select>

      <p
        id={statusId}
        role="status"
        aria-live="polite"
        className={
          outcome.kind === "failed"
            ? "text-xs text-destructive"
            : "text-xs text-muted-foreground"
        }
      >
        {lockedAsLastAdmin ? (
          LAST_ADMIN_REASON
        ) : pending ? (
          "Saving…"
        ) : outcome.kind === "updated" ? (
          "Role updated"
        ) : outcome.kind === "failed" ? (
          <ActionErrorMessage error={outcome.error} />
        ) : undefined}
      </p>
    </div>
  );
}
