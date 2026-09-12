"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";

import { updateContact } from "@/contacts/update-contact";
import type { ActionError } from "@/db/tenant";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { Button } from "@/ui/primitives/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ui/primitives/dialog";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";
import { SubmitButton } from "@/ui/primitives/submit-button";

export type EditContactDialogProps = {
  readonly contactId: string;
  readonly name: string;
  readonly email: string;
  /** Accepted contacts keep their email: the field is read only (AC-2). */
  readonly accepted: boolean;
  /** A pending invitation is cleared by an email change, and the dialog says so. */
  readonly pending: boolean;
};

type Values = { readonly name: string; readonly email: string };

type FormState = {
  readonly values: Values;
  readonly error?: ActionError;
};

/**
 * Edit a contact's name and email in place (spec 0009, AC-2).
 *
 * The field ids are prefixed so they cannot collide with the add form's on
 * the same page; the Zod field names stay `name` and `email`, which is what
 * the error lookups read.
 */
export function EditContactDialog({
  contactId,
  name,
  email,
  accepted,
  pending,
}: EditContactDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [state, submit] = useActionState<FormState, FormData>(
    async (previous, form) => {
      const values: Values = {
        name: String(form.get("name") ?? ""),
        // A read only field is still submitted; an accepted contact's email
        // therefore always round trips unchanged.
        email: accepted ? email : String(form.get("email") ?? ""),
      };

      const result = await updateContact({ contactId, ...values });

      if (!result.ok) {
        return { values, error: result.error };
      }

      setOpen(false);
      router.refresh();

      return { values, error: undefined };
    },
    { values: { name, email } },
  );

  const fieldErrors = state.error?.fieldErrors;
  const generalError =
    state.error && fieldErrors === undefined ? state.error : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`Edit ${name}`}>
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Edit contact</DialogTitle>
            <DialogDescription>
              {accepted
                ? "This contact has accepted their invitation, so their email address is fixed. To change it, remove them and add them again."
                : pending
                  ? "Changing the email address cancels the invitation that was sent; send a new one afterwards."
                  : "Update the name or email address on file."}
            </DialogDescription>
          </DialogHeader>

          {generalError ? (
            <p role="alert" className="text-sm text-destructive">
              <ActionErrorMessage error={generalError} />
            </p>
          ) : undefined}

          <Field
            name={`edit-${contactId}-name`}
            label="Name"
            required
            error={fieldErrors?.name}
          >
            {(props) => (
              <Input
                {...props}
                name="name"
                defaultValue={state.values.name}
                maxLength={200}
                autoComplete="off"
              />
            )}
          </Field>

          <Field
            name={`edit-${contactId}-email`}
            label="Email"
            required={!accepted}
            error={fieldErrors?.email}
          >
            {(props) => (
              <Input
                {...props}
                type="email"
                name="email"
                defaultValue={state.values.email}
                maxLength={320}
                autoComplete="off"
                readOnly={accepted}
              />
            )}
          </Field>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
