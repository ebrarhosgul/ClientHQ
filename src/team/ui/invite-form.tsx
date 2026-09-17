"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import type { ActionError } from "@/db/tenant";
import type { MembershipRole } from "@/db/schema";
import { inviteTeamMember } from "@/team/invite-team-member";
import { roleLabel } from "@/team/rules";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/primitives/select";
import { SubmitButton } from "@/ui/primitives/submit-button";

type FormState = {
  readonly email: string;
  readonly error?: ActionError;
  readonly sentTo?: string;
  /** Bumped on success so the uncontrolled input resets to empty. */
  readonly generation: number;
};

export type InviteFormProps = {
  readonly agencyName: string;
  readonly headingId?: string;
};

/**
 * The invite card at the top of `/team` (spec 0015, AC-2, AC-3).
 *
 * A duplicate address comes back as `conflict` with a field error, so it
 * sits beside the email field like a validation failure; every other failure
 * goes in the alert line above the button. Success clears the address, keeps
 * the role, announces who was invited, and refreshes so the pending list
 * shows the new row.
 */
export function InviteForm({
  agencyName,
  headingId = "invite-heading",
}: InviteFormProps) {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<MembershipRole>("member");

  const [state, submit] = useActionState<FormState, FormData>(
    async (previous, form) => {
      const email = String(form.get("email") ?? "");

      const result = await inviteTeamMember({ email, role });

      if (!result.ok) {
        return { ...previous, email, error: result.error, sentTo: undefined };
      }

      router.refresh();

      return {
        email: "",
        sentTo: email.trim().toLowerCase(),
        generation: previous.generation + 1,
      };
    },
    { email: "", generation: 0 },
  );

  // The `key={state.generation}` below remounts the form on success, so
  // focusing at submit time (before the remount) would focus an input that
  // is about to be torn down. Wait for the remount to land, then focus the
  // fresh one. Skipped on the initial mount, when generation hasn't changed.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    emailRef.current?.focus();
  }, [state.generation]);

  const fieldErrors = state.error?.fieldErrors;
  const generalError =
    state.error && fieldErrors === undefined ? state.error : undefined;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-base font-semibold tracking-tight">
          Invite someone
        </h2>
        <p className="text-xs text-muted-foreground">
          They get an email with a link to join {agencyName}. Admins manage
          billing and the team; members do everything else.
        </p>
      </div>

      <form
        key={state.generation}
        action={submit}
        noValidate
        aria-labelledby={headingId}
        className="flex flex-col gap-3"
      >
        {generalError ? (
          <p role="alert" className="text-sm text-destructive">
            <ActionErrorMessage error={generalError} />
          </p>
        ) : undefined}

        <div className="grid gap-3 sm:grid-cols-[1fr_11rem_auto] sm:items-start">
          <Field name="email" label="Email" required error={fieldErrors?.email}>
            {(props) => (
              <Input
                {...props}
                ref={emailRef}
                type="email"
                name="email"
                defaultValue={state.email}
                maxLength={254}
                autoComplete="off"
                placeholder="alex@yourstudio.example"
              />
            )}
          </Field>

          <Field name="role" label="Role">
            {(props) => (
              <Select
                value={role}
                onValueChange={(value) => setRole(value as MembershipRole)}
              >
                <SelectTrigger
                  id={props.id}
                  aria-describedby={props["aria-describedby"]}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">{roleLabel("member")}</SelectItem>
                  <SelectItem value="admin">{roleLabel("admin")}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>

          {/* `mt-6` lines the button up with the controls below their labels. */}
          <SubmitButton className="sm:mt-6" pendingLabel="Sending…">
            <Send />
            Send invitation
          </SubmitButton>
        </div>

        <p
          role="status"
          aria-live="polite"
          className="text-xs text-muted-foreground"
        >
          {state.sentTo ? `Invitation sent to ${state.sentTo}.` : undefined}
        </p>
      </form>
    </section>
  );
}
