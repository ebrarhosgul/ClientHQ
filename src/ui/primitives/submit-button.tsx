"use client";

import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";

import { Button, type ButtonProps } from "./button";

export type SubmitButtonProps = Omit<ButtonProps, "type" | "asChild"> & {
  /** Shown while the form this button belongs to is in flight. */
  readonly pendingLabel?: string;
};

/**
 * The submit button, which knows on its own when its form is working.
 *
 * `useFormStatus` reads the state of the *enclosing* form, so this has to be a
 * child of the `<form>` rather than the thing that renders it. That is the
 * whole reason it is a separate component from `Button`.
 *
 * The spinner is decorative: it is hidden from assistive technology and, under
 * `prefers-reduced-motion`, it does not turn (AC-15). What actually announces
 * the state is `aria-busy` plus the pending label, so the state is never
 * carried by movement alone.
 */
export function SubmitButton({
  children,
  disabled,
  pendingLabel = "Working…",
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button
      {...props}
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
    >
      {pending ? (
        <>
          <LoaderCircle aria-hidden className="animate-spin" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
