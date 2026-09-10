"use client";

import { useActionState, useState, type ReactNode } from "react";

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
import { SubmitButton } from "@/ui/primitives/submit-button";
import { Button } from "@/ui/primitives/button";

/**
 * A confirmation gate in front of one action, first needed by the archive
 * confirm dialog (spec 0006, AC-8).
 *
 * The trigger opens the dialog rather than running the action directly; the
 * action itself runs from a form inside it, so the same `useActionState` and
 * `Result` handling every other form in the product uses applies here too. A
 * successful action closes the dialog by unmounting it (`open` follows
 * `pending` back to `false` only after `onConfirmed` runs).
 */
export type ConfirmDialogProps = {
  readonly trigger: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly pendingLabel?: string;
  readonly variant?: "default" | "destructive";
  /** Runs the action and returns whether it succeeded. Throwing is not caught. */
  readonly onConfirm: () => Promise<{
    readonly ok: boolean;
    readonly message?: string;
  }>;
};

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  pendingLabel = "Working…",
  variant = "default",
  onConfirm,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);

  const [state, submit, pending] = useActionState<
    { readonly error?: string },
    FormData
  >(async () => {
    const result = await onConfirm();

    if (result.ok) {
      setOpen(false);
      return {};
    }

    return { error: result.message ?? "That did not work." };
  }, {});

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {state.error ? (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        ) : undefined}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <form action={submit}>
            <SubmitButton
              variant={variant === "destructive" ? "destructive" : "default"}
              pendingLabel={pendingLabel}
            >
              {confirmLabel}
            </SubmitButton>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
