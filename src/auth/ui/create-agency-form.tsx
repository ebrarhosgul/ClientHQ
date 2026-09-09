"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";

import { createAgency } from "@/auth/agency";
import type { ActionError } from "@/db/tenant";
import { errorMessage } from "@/ui/patterns/error-messages";
import { Alert, AlertDescription, AlertTitle } from "@/ui/primitives/alert";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";
import { SubmitButton } from "@/ui/primitives/submit-button";

import { useActivateAgency } from "./use-activate-agency";

type FormState = {
  /** What the last attempt entered, so a failed submit does not blank the field. */
  readonly name: string;
  readonly error?: ActionError;
};

const EMPTY: FormState = { name: "" };

/**
 * One field, and the thing it creates is an entire agency.
 *
 * The form posts to a Server Action which parses it again with Zod, so the
 * browser is never the thing that decided the name was acceptable. What comes
 * back is the project's ordinary `Result`, so the failure renders exactly like
 * any other action's: the field message beside the field through `Field`, and
 * anything that is not about the field in an alert above it. Never only in a
 * toast, because an error that scrolls away after four seconds is one nobody
 * read (design.md, accessibility rule 7).
 *
 * Activation happens here rather than in the action because the Clerk session
 * cookie is written in the browser, and it is awaited before navigating so the
 * dashboard is not reached before the organization claim exists (AC-9).
 */
export function CreateAgencyForm() {
  const router = useRouter();
  const { activate } = useActivateAgency();

  const [state, submit] = useActionState(
    async (_previous: FormState, form: FormData): Promise<FormState> => {
      const name = String(form.get("name") ?? "");
      const result = await createAgency({ name });

      if (!result.ok) {
        return { name, error: result.error };
      }

      // `alreadyExisted` means a retried or double submitted request found the
      // agency its first attempt created. Same destination either way (AC-9).
      await activate(result.data.clerkOrgId);
      router.replace("/dashboard");

      return { name };
    },
    EMPTY,
  );

  return (
    <form action={submit} className="flex flex-col gap-4">
      {state.error && state.error.code !== "validation" ? (
        <Alert variant="destructive">
          <AlertTitle>That did not finish</AlertTitle>
          <AlertDescription>
            <p>{errorMessage(state.error)}</p>
          </AlertDescription>
        </Alert>
      ) : undefined}

      <Field
        name="name"
        label="Agency name"
        required
        description="What your clients call you. You can change it later."
        error={state.error?.fieldErrors?.name}
      >
        {(props) => (
          <Input
            {...props}
            name="name"
            defaultValue={state.name}
            autoComplete="organization"
            maxLength={100}
            placeholder="Northwind Studio"
          />
        )}
      </Field>

      <SubmitButton className="w-full" pendingLabel="Creating your agency…">
        Create agency
      </SubmitButton>
    </form>
  );
}
