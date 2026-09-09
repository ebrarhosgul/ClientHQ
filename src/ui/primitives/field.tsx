import type { ReactNode } from "react";

import { cn } from "@/ui/lib/cn";
import { Label } from "@/ui/primitives/label";

/**
 * One form field: label, control, optional description, error slot.
 *
 * This wrapper exists so no feature has to remember the wiring. It generates
 * the ids, points `aria-describedby` at whichever of the description and the
 * error is present, sets `aria-invalid`, and puts the message beside the field
 * rather than only in a toast (AC-13). Every one of those is easy to forget
 * once and then forget everywhere.
 *
 * The control is rendered through a function so it receives the ids it has to
 * carry. A caller cannot get them wrong, because it never sees them:
 *
 * ```tsx
 * <Field label="Client name" error={result.error?.fieldErrors?.name}>
 *   {(props) => <Input name="name" {...props} />}
 * </Field>
 * ```
 *
 * The error is announced through `role="alert"`, so a person who has just
 * submitted and is not looking at that part of the page still hears it.
 */
export type FieldControlProps = {
  readonly id: string;
  readonly "aria-describedby": string | undefined;
  readonly "aria-invalid": true | undefined;
  readonly required: boolean | undefined;
};

export type FieldProps = {
  readonly name: string;
  readonly label: ReactNode;
  /** Zod's flattened messages for this field, straight off a `Result` failure. */
  readonly error?: readonly string[];
  readonly description?: ReactNode;
  readonly required?: boolean;
  readonly className?: string;
  readonly children: (props: FieldControlProps) => ReactNode;
};

export function Field({
  name,
  label,
  error,
  description,
  required,
  className,
  children,
}: FieldProps) {
  const id = `field-${name}`;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error && error.length > 0 ? `${id}-error` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        ) : undefined}
        {required ? <span className="sr-only">(required)</span> : undefined}
      </Label>

      {children({
        id,
        // Order matters: a screen reader reads the description first, then the
        // error, which is the order a person needs them in.
        "aria-describedby":
          [descriptionId, errorId].filter(Boolean).join(" ") || undefined,
        "aria-invalid": errorId ? true : undefined,
        required,
      })}

      {description ? (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      ) : undefined}

      {errorId ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error?.join(" ")}
        </p>
      ) : undefined}
    </div>
  );
}
