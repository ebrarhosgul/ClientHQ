"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";

import type { ClientOption } from "@/clients/queries";
import type { ActionError } from "@/db/tenant";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { Alert, AlertDescription, AlertTitle } from "@/ui/primitives/alert";
import { Field } from "@/ui/primitives/field";
import { SubmitButton } from "@/ui/primitives/submit-button";

import { createInvoiceDraft } from "../create-invoice-draft";

type FormState = {
  readonly clientId: string;
  readonly error?: ActionError;
};

export type NewInvoiceFormProps = {
  /** The agency's active clients for the picker. */
  readonly clientOptions: readonly ClientOption[];
  /** Pre selects a client from `?client=` on `/invoices/new`, when it resolves. */
  readonly preselectedClientId?: string;
  /** The currency the draft will carry, for the explanatory line. */
  readonly defaultCurrency: string;
};

/**
 * The one step create (spec 0012, AC-1): pick a client, get a draft, land in
 * the editor. Everything else about the invoice (lines, tax, due date, notes)
 * is set on the draft itself, which is why this form has one field.
 *
 * The client is a native `<select>`, as on the project form: a plain control
 * that submits with no JavaScript is the right shape for a picker that only
 * ever narrows to one value.
 */
export function NewInvoiceForm({
  clientOptions,
  preselectedClientId,
  defaultCurrency,
}: NewInvoiceFormProps) {
  const router = useRouter();

  const [state, submit] = useActionState<FormState, FormData>(
    async (previous, form) => {
      const clientId = String(form.get("clientId") ?? "");
      const result = await createInvoiceDraft({ clientId });

      if (!result.ok) {
        return { clientId, error: result.error };
      }

      router.push(`/invoices/${result.data.id}`);

      return previous;
    },
    { clientId: preselectedClientId ?? "" },
  );

  const fieldErrors = state.error?.fieldErrors;

  return (
    <form action={submit} noValidate className="flex flex-col gap-6">
      {state.error && state.error.code !== "validation" ? (
        <Alert variant="destructive">
          <AlertTitle>That did not save</AlertTitle>
          <AlertDescription>
            <p>
              <ActionErrorMessage error={state.error} />
            </p>
          </AlertDescription>
        </Alert>
      ) : undefined}

      <Field
        name="clientId"
        label="Client"
        required
        description={`The draft starts in ${defaultCurrency}, with no tax and a due date thirty days out. You can change all of that before issuing it.`}
        error={fieldErrors?.clientId}
      >
        {(props) => (
          <select
            {...props}
            name="clientId"
            defaultValue={state.clientId}
            className="h-9 w-full max-w-md rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-surface aria-invalid:border-destructive"
          >
            <option value="" disabled>
              Choose a client
            </option>
            {clientOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        )}
      </Field>

      <SubmitButton className="self-start" pendingLabel="Creating draft…">
        Create draft
      </SubmitButton>
    </form>
  );
}
