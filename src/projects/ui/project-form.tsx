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

import { createProject } from "../create-project";
import type { ProjectDetail } from "../queries";
import { updateProject } from "../update-project";

type ProjectFormValues = {
  readonly clientId: string;
  readonly name: string;
  readonly description: string;
  readonly dueDate: string;
};

function emptyValues(
  preselectedClientId: string | undefined,
): ProjectFormValues {
  return {
    clientId: preselectedClientId ?? "",
    name: "",
    description: "",
    dueDate: "",
  };
}

function valuesFrom(
  project: ProjectDetail | undefined,
  preselectedClientId: string | undefined,
): ProjectFormValues {
  if (project === undefined) {
    return emptyValues(preselectedClientId);
  }

  return {
    clientId: project.clientId,
    name: project.name,
    description: project.description ?? "",
    dueDate: project.dueDate ?? "",
  };
}

function valuesFromForm(form: FormData): ProjectFormValues {
  const read = (name: keyof ProjectFormValues) => String(form.get(name) ?? "");

  return {
    clientId: read("clientId"),
    name: read("name"),
    description: read("description"),
    dueDate: read("dueDate"),
  };
}

type FormState = {
  readonly values: ProjectFormValues;
  readonly error?: ActionError;
};

export type ProjectFormProps = {
  /** Omit to create a new project; pass the current row to edit it. */
  readonly project?: ProjectDetail;
  /** The agency's active clients for the picker. Required when creating. */
  readonly clientOptions?: readonly ClientOption[];
  /** Pre-selects a client from `?client=` on `/projects/new`, when it resolves. */
  readonly preselectedClientId?: string;
};

/**
 * The create and edit form, one component for both (spec 0010, AC-1, AC-7).
 *
 * The client is a native `<select>`, not the styled listbox: a plain form
 * control that submits with no JavaScript is the right choice for a picker
 * that only ever narrows to one value (spec 0010, Consequences notes it will
 * want a searchable combobox once an agency has hundreds of clients). The
 * client cannot be changed once a project exists, so the edit form shows it
 * as read-only text instead of a control at all.
 */
export function ProjectForm({
  project,
  clientOptions,
  preselectedClientId,
}: ProjectFormProps) {
  const router = useRouter();

  const [state, submit] = useActionState<FormState, FormData>(
    async (previous, form) => {
      const values = valuesFromForm(form);

      const result = project
        ? await updateProject({
            id: project.id,
            name: values.name,
            description: values.description,
            dueDate: values.dueDate,
          })
        : await createProject({
            clientId: values.clientId,
            name: values.name,
            description: values.description,
            dueDate: values.dueDate,
          });

      if (!result.ok) {
        return { values, error: result.error };
      }

      router.push(`/projects/${result.data.id}`);

      return previous;
    },
    { values: valuesFrom(project, preselectedClientId) },
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
        {project ? (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">Client</span>
            <p className="text-sm text-muted-foreground">
              {project.clientName}
            </p>
          </div>
        ) : (
          <Field
            name="clientId"
            label="Client"
            required
            className="sm:col-span-2"
            error={fieldErrors?.clientId}
          >
            {(props) => (
              <select
                {...props}
                name="clientId"
                defaultValue={state.values.clientId}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-surface aria-invalid:border-destructive"
              >
                <option value="" disabled>
                  Choose a client
                </option>
                {clientOptions?.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        <Field
          name="name"
          label="Project name"
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
              placeholder="Website relaunch"
            />
          )}
        </Field>

        <Field name="dueDate" label="Due date" error={fieldErrors?.dueDate}>
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
          name="description"
          label="Description"
          className="sm:col-span-2"
          error={fieldErrors?.description}
        >
          {(props) => (
            <Textarea
              {...props}
              name="description"
              defaultValue={state.values.description}
              maxLength={5000}
              rows={4}
            />
          )}
        </Field>
      </div>

      <SubmitButton className="self-start" pendingLabel="Saving…">
        {project ? "Save changes" : "Create project"}
      </SubmitButton>
    </form>
  );
}
