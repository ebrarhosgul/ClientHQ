"use client";

import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useRef } from "react";

import { addContact } from "@/contacts/add-contact";
import type { ActionError } from "@/db/tenant";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";
import { SubmitButton } from "@/ui/primitives/submit-button";

type Values = {
  readonly name: string;
  readonly email: string;
};

type FormState = {
  readonly values: Values;
  readonly error?: ActionError;
  /** Bumped on success so the uncontrolled inputs reset to empty. */
  readonly generation: number;
};

const EMPTY: Values = { name: "", email: "" };

/**
 * The inline add form at the foot of the Contacts section (spec 0009, AC-1).
 *
 * A duplicate email comes back as `conflict` with a field error, so it renders
 * beside the email field like a validation failure would; every other failure
 * goes in the alert line above the button. On success the inputs are cleared
 * and the page refreshed so the new row appears in the list.
 */
export function AddContactForm({ clientId }: { readonly clientId: string }) {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);

  const [state, submit] = useActionState<FormState, FormData>(
    async (previous, form) => {
      const values: Values = {
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
      };

      const result = await addContact({ clientId, ...values });

      if (!result.ok) {
        return { ...previous, values, error: result.error };
      }

      router.refresh();
      nameRef.current?.focus();

      return { values: EMPTY, generation: previous.generation + 1 };
    },
    { values: EMPTY, generation: 0 },
  );

  const fieldErrors = state.error?.fieldErrors;
  const generalError =
    state.error && fieldErrors === undefined ? state.error : undefined;

  return (
    <form
      key={state.generation}
      action={submit}
      noValidate
      aria-labelledby="add-contact-heading"
      className="flex flex-col gap-3"
    >
      <h3 id="add-contact-heading" className="text-sm font-medium">
        Add a contact
      </h3>

      {generalError ? (
        <p role="alert" className="text-sm text-destructive">
          <ActionErrorMessage error={generalError} />
        </p>
      ) : undefined}

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
        <Field name="name" label="Name" required error={fieldErrors?.name}>
          {(props) => (
            <Input
              {...props}
              ref={nameRef}
              name="name"
              defaultValue={state.values.name}
              maxLength={200}
              autoComplete="off"
              placeholder="Ada Lovelace"
            />
          )}
        </Field>

        <Field name="email" label="Email" required error={fieldErrors?.email}>
          {(props) => (
            <Input
              {...props}
              type="email"
              name="email"
              defaultValue={state.values.email}
              maxLength={320}
              autoComplete="off"
              placeholder="ada@northwind.example"
            />
          )}
        </Field>

        {/* `mt-6` lines the button up with the inputs below their labels. */}
        <SubmitButton
          variant="outline"
          className="sm:mt-6"
          pendingLabel="Adding…"
        >
          <UserPlus />
          Add contact
        </SubmitButton>
      </div>
    </form>
  );
}
