"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";

import { createClient } from "@/clients/create-client";
import type { ClientRow } from "@/clients/queries";
import { updateClient } from "@/clients/update-client";
import type { ActionError } from "@/db/tenant";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { AddressFields } from "@/ui/patterns/address-fields";
import { Alert, AlertDescription, AlertTitle } from "@/ui/primitives/alert";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";
import { SubmitButton } from "@/ui/primitives/submit-button";
import { Textarea } from "@/ui/primitives/textarea";

type ClientFormValues = {
  readonly name: string;
  readonly companyEmail: string;
  readonly phone: string;
  readonly industry: string;
  readonly notes: string;
  readonly billingAddressLine1: string;
  readonly billingAddressLine2: string;
  readonly billingCity: string;
  readonly billingRegion: string;
  readonly billingPostalCode: string;
  readonly billingCountry: string;
};

const EMPTY_VALUES: ClientFormValues = {
  name: "",
  companyEmail: "",
  phone: "",
  industry: "",
  notes: "",
  billingAddressLine1: "",
  billingAddressLine2: "",
  billingCity: "",
  billingRegion: "",
  billingPostalCode: "",
  billingCountry: "",
};

function valuesFrom(client: ClientRow | undefined): ClientFormValues {
  if (client === undefined) {
    return EMPTY_VALUES;
  }

  return {
    name: client.name,
    companyEmail: client.companyEmail ?? "",
    phone: client.phone ?? "",
    industry: client.industry ?? "",
    notes: client.notes ?? "",
    billingAddressLine1: client.billingAddressLine1 ?? "",
    billingAddressLine2: client.billingAddressLine2 ?? "",
    billingCity: client.billingCity ?? "",
    billingRegion: client.billingRegion ?? "",
    billingPostalCode: client.billingPostalCode ?? "",
    billingCountry: client.billingCountry ?? "",
  };
}

function valuesFromForm(form: FormData): ClientFormValues {
  const read = (name: keyof ClientFormValues) => String(form.get(name) ?? "");

  return {
    name: read("name"),
    companyEmail: read("companyEmail"),
    phone: read("phone"),
    industry: read("industry"),
    notes: read("notes"),
    billingAddressLine1: read("billingAddressLine1"),
    billingAddressLine2: read("billingAddressLine2"),
    billingCity: read("billingCity"),
    billingRegion: read("billingRegion"),
    billingPostalCode: read("billingPostalCode"),
    billingCountry: read("billingCountry"),
  };
}

type FormState = {
  readonly values: ClientFormValues;
  readonly error?: ActionError;
};

export type ClientFormProps = {
  /** Omit to create a new client; pass the current row to edit it. */
  readonly client?: ClientRow;
};

/**
 * The create and edit form, one component for both (spec 0006, AC-1, AC-7).
 *
 * Both actions return the project's ordinary `Result`, so a validation failure
 * renders exactly like any other form's: the field message beside its field,
 * and anything else in an alert above them. A success redirects to the client's
 * detail page, where the saved values show immediately.
 */
export function ClientForm({ client }: ClientFormProps) {
  const router = useRouter();

  const [state, submit] = useActionState<FormState, FormData>(
    async (previous, form) => {
      const values = valuesFromForm(form);

      const result = client
        ? await updateClient({ id: client.id, ...values })
        : await createClient(values);

      if (!result.ok) {
        return { values, error: result.error };
      }

      router.push(`/clients/${result.data.id}`);

      return previous;
    },
    { values: valuesFrom(client) },
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="name"
          label="Client name"
          required
          className="sm:col-span-2"
          error={fieldErrors?.name}
        >
          {(props) => (
            <Input
              {...props}
              name="name"
              defaultValue={state.values.name}
              maxLength={200}
              placeholder="Northwind Coffee"
            />
          )}
        </Field>

        <Field
          name="companyEmail"
          label="Company email"
          error={fieldErrors?.companyEmail}
        >
          {(props) => (
            <Input
              {...props}
              type="email"
              name="companyEmail"
              defaultValue={state.values.companyEmail}
              maxLength={320}
              autoComplete="email"
            />
          )}
        </Field>

        <Field name="phone" label="Phone" error={fieldErrors?.phone}>
          {(props) => (
            <Input
              {...props}
              type="tel"
              name="phone"
              defaultValue={state.values.phone}
              maxLength={50}
              autoComplete="tel"
            />
          )}
        </Field>

        <Field
          name="industry"
          label="Industry"
          className="sm:col-span-2"
          error={fieldErrors?.industry}
        >
          {(props) => (
            <Input
              {...props}
              name="industry"
              defaultValue={state.values.industry}
              maxLength={200}
              placeholder="Coffee roasting"
            />
          )}
        </Field>

        <Field
          name="notes"
          label="Notes"
          description="Only your team sees these."
          className="sm:col-span-2"
          error={fieldErrors?.notes}
        >
          {(props) => (
            <Textarea
              {...props}
              name="notes"
              defaultValue={state.values.notes}
              maxLength={5000}
              rows={4}
            />
          )}
        </Field>
      </div>

      <AddressFields
        legend="Billing address"
        names={{
          line1: "billingAddressLine1",
          line2: "billingAddressLine2",
          city: "billingCity",
          region: "billingRegion",
          postalCode: "billingPostalCode",
          country: "billingCountry",
        }}
        values={{
          line1: state.values.billingAddressLine1,
          line2: state.values.billingAddressLine2,
          city: state.values.billingCity,
          region: state.values.billingRegion,
          postalCode: state.values.billingPostalCode,
          country: state.values.billingCountry,
        }}
        fieldErrors={{
          line1: fieldErrors?.billingAddressLine1,
          line2: fieldErrors?.billingAddressLine2,
          city: fieldErrors?.billingCity,
          region: fieldErrors?.billingRegion,
          postalCode: fieldErrors?.billingPostalCode,
          country: fieldErrors?.billingCountry,
        }}
      />

      <SubmitButton className="self-start" pendingLabel="Saving…">
        {client ? "Save changes" : "Create client"}
      </SubmitButton>
    </form>
  );
}
