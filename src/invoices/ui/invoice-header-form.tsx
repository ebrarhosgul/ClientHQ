"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";

import type { ClientOption } from "@/clients/queries";
import type { ActionError } from "@/db/tenant";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { Alert, AlertDescription, AlertTitle } from "@/ui/primitives/alert";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";
import { SubmitButton } from "@/ui/primitives/submit-button";
import { Textarea } from "@/ui/primitives/textarea";

import { updateInvoiceDraft } from "../update-invoice-draft";
import { formatTaxRate } from "./invoice-totals";

type HeaderValues = {
  readonly clientId: string;
  readonly dueDate: string;
  readonly taxRatePercent: string;
  readonly notes: string;
};

type FormState = {
  readonly values: HeaderValues;
  readonly error?: ActionError;
  readonly saved: boolean;
};

export type InvoiceHeaderFormProps = {
  readonly invoiceId: string;
  readonly clientId: string;
  readonly dueDate: string | null;
  readonly taxRateBp: number;
  readonly notes: string | null;
  readonly currency: string;
  /** The agency's active clients, plus the current one if it has since been archived. */
  readonly clientOptions: readonly ClientOption[];
};

function valuesFromForm(form: FormData): HeaderValues {
  const read = (name: keyof HeaderValues) => String(form.get(name) ?? "");

  return {
    clientId: read("clientId"),
    dueDate: read("dueDate"),
    taxRatePercent: read("taxRatePercent"),
    notes: read("notes"),
  };
}

/**
 * The draft's header, saved as one form through one Server Action (spec
 * 0012, AC-2): client, due date, tax rate and notes. The currency is shown
 * but never edited; it was copied from the agency at creation and is frozen.
 * A tax rate change recalculates the totals on the server in the same write,
 * and the page refresh brings them back.
 */
export function InvoiceHeaderForm({
  invoiceId,
  clientId,
  dueDate,
  taxRateBp,
  notes,
  currency,
  clientOptions,
}: InvoiceHeaderFormProps) {
  const router = useRouter();

  const [state, submit] = useActionState<FormState, FormData>(
    async (_previous, form) => {
      const values = valuesFromForm(form);

      const result = await updateInvoiceDraft({ id: invoiceId, ...values });

      if (!result.ok) {
        return { values, error: result.error, saved: false };
      }

      router.refresh();

      return { values, saved: true };
    },
    {
      values: {
        clientId,
        dueDate: dueDate ?? "",
        taxRatePercent: formatTaxRate(taxRateBp).replace(/%$/, ""),
        notes: notes ?? "",
      },
      saved: false,
    },
  );

  const fieldErrors = state.error?.fieldErrors;

  return (
    <form action={submit} noValidate className="flex flex-col gap-4">
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="clientId"
          label="Client"
          required
          error={fieldErrors?.clientId}
        >
          {(props) => (
            <select
              {...props}
              name="clientId"
              defaultValue={state.values.clientId}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-surface aria-invalid:border-destructive"
            >
              {clientOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field
          name="dueDate"
          label="Due date"
          required
          error={fieldErrors?.dueDate}
        >
          {(props) => (
            <Input
              {...props}
              type="date"
              name="dueDate"
              defaultValue={state.values.dueDate}
            />
          )}
        </Field>

        <Field
          name="taxRatePercent"
          label="Tax rate (%)"
          required
          description="0 to 100, with at most two decimals. Applied to the subtotal."
          error={fieldErrors?.taxRatePercent}
        >
          {(props) => (
            <Input
              {...props}
              type="text"
              inputMode="decimal"
              name="taxRatePercent"
              defaultValue={state.values.taxRatePercent}
              maxLength={6}
              className="max-w-32 tabular-nums"
            />
          )}
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Currency</span>
          <p className="text-sm text-muted-foreground">
            {currency}. Set when the draft was created, from your agency
            settings.
          </p>
        </div>

        <Field
          name="notes"
          label="Notes"
          className="sm:col-span-2"
          description="Printed under the lines: payment terms, a thank you, a purchase order reference."
          error={fieldErrors?.notes}
        >
          {(props) => (
            <Textarea
              {...props}
              name="notes"
              defaultValue={state.values.notes}
              maxLength={5000}
              rows={3}
            />
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="outline" pendingLabel="Saving…">
          Save details
        </SubmitButton>
        {state.saved && state.error === undefined ? (
          <p role="status" className="text-xs text-muted-foreground">
            Saved.
          </p>
        ) : undefined}
      </div>
    </form>
  );
}
