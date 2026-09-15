"use client";

import { Ban, CircleCheck, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";

import type { InvoiceStatus } from "@/db/schema";
import type { ActionError } from "@/db/tenant";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { ConfirmDialog } from "@/ui/patterns/confirm-dialog";
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
import { Textarea } from "@/ui/primitives/textarea";

import { issueInvoice } from "../issue-invoice";
import { resendInvoiceNotification } from "../resend-invoice-notification";
import { nextActions } from "../status";
import { markInvoicePaid, voidInvoice } from "../transition-invoice";

type MoveProps = {
  readonly invoiceId: string;
  readonly from: InvoiceStatus;
  /**
   * Called after every result, success or conflict alike, with the error
   * when there was one. The parent owns the message and the refresh: the
   * refresh that follows a conflict brings back a different set of buttons
   * and unmounts the one that was clicked (spec 0012, AC-8).
   */
  readonly onDone: (error?: ActionError) => void;
};

/** Issue, behind a confirm that warns when nobody would be emailed (AC-5, AC-6). */
function IssueButton({
  invoiceId,
  lineCount,
  contactCount,
  onDone,
}: {
  readonly invoiceId: string;
  readonly lineCount: number;
  readonly contactCount: number;
  readonly onDone: (error?: ActionError) => void;
}) {
  const recipients =
    contactCount === 0
      ? "Nobody will be emailed: this client has no contacts with an email address. Add one first if they should be told."
      : contactCount === 1
        ? "The client's one contact will be emailed the amount and due date."
        : `The client's ${contactCount} contacts will be emailed the amount and due date.`;

  return (
    <ConfirmDialog
      trigger={
        <Button disabled={lineCount === 0}>
          <Send />
          Issue invoice
        </Button>
      }
      title="Issue this invoice?"
      description={`It takes the next number in your sequence and its lines, dates and notes stop changing. ${recipients}`}
      confirmLabel="Issue"
      pendingLabel="Issuing…"
      onConfirm={async () => {
        const result = await issueInvoice({ id: invoiceId });

        if (!result.ok) {
          return {
            ok: false,
            message: <ActionErrorMessage error={result.error} />,
          };
        }

        onDone();

        return { ok: true };
      }}
    />
  );
}

/** Void, with an optional reason that travels on the event (AC-9). */
function VoidDialog({ invoiceId, from, onDone }: MoveProps) {
  const [open, setOpen] = useState(false);

  const [state, submit] = useActionState<
    { readonly error?: ActionError },
    FormData
  >(async (_previous, form) => {
    const result = await voidInvoice({
      id: invoiceId,
      from,
      reason: String(form.get("reason") ?? ""),
    });

    if (!result.ok && result.error.code === "validation") {
      return { error: result.error };
    }

    setOpen(false);
    onDone(result.ok ? undefined : result.error);

    return {};
  }, {});

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Ban />
          Void
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Void this invoice?</DialogTitle>
            <DialogDescription>
              {from === "draft"
                ? "The draft is kept in your records as void and cannot be edited or issued afterwards."
                : "Void is final. The invoice keeps its number and stays in your records, but the client no longer sees it. To bill this work, issue a new invoice."}
            </DialogDescription>
          </DialogHeader>

          <Field
            name="void-reason"
            label="Reason"
            description="Optional. Kept in the invoice's history."
            error={state.error?.fieldErrors?.reason}
          >
            {(props) => (
              <Textarea
                {...props}
                name="reason"
                maxLength={500}
                rows={3}
                placeholder="Duplicate of INV-0012"
              />
            )}
          </Field>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <SubmitButton variant="destructive" pendingLabel="Voiding…">
              Void invoice
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Mark paid, with the paid date staff choose (AC-8). */
function MarkPaidDialog({
  invoiceId,
  from,
  issueDate,
  today,
  onDone,
}: MoveProps & {
  readonly issueDate: string | null;
  readonly today: string;
}) {
  const [open, setOpen] = useState(false);

  const [state, submit] = useActionState<
    { readonly paidOn: string; readonly error?: ActionError },
    FormData
  >(
    async (_previous, form) => {
      const paidOn = String(form.get("paidOn") ?? "");
      const result = await markInvoicePaid({ id: invoiceId, from, paidOn });

      if (!result.ok && result.error.code === "validation") {
        return { paidOn, error: result.error };
      }

      setOpen(false);
      onDone(result.ok ? undefined : result.error);

      return { paidOn };
    },
    { paidOn: today },
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <CircleCheck />
          Mark paid
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Mark this invoice paid?</DialogTitle>
            <DialogDescription>
              Paid is final. Record the day the money arrived; it cannot be
              before the issue date or after today.
            </DialogDescription>
          </DialogHeader>

          <Field
            name="paid-on"
            label="Paid on"
            required
            error={state.error?.fieldErrors?.paidOn}
          >
            {(props) => (
              <Input
                {...props}
                type="date"
                name="paidOn"
                defaultValue={state.paidOn}
                min={issueDate ?? undefined}
                max={today}
                className="max-w-48"
              />
            )}
          </Field>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <SubmitButton pendingLabel="Marking paid…">Mark paid</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Resend the issue email, subject to the five minute cooldown (AC-7). */
export function ResendButton({
  invoiceId,
  onDone,
  variant = "outline",
}: {
  readonly invoiceId: string;
  readonly onDone: (error?: ActionError) => void;
  readonly variant?: "outline" | "default";
}) {
  return (
    <form
      action={async () => {
        const result = await resendInvoiceNotification({ id: invoiceId });
        onDone(result.ok ? undefined : result.error);
      }}
    >
      <SubmitButton variant={variant} pendingLabel="Sending…">
        <Send />
        Resend notification
      </SubmitButton>
    </form>
  );
}

export type InvoiceActionsProps = {
  readonly invoiceId: string;
  readonly status: InvoiceStatus;
  readonly issueDate: string | null;
  readonly lineCount: number;
  /** How many of the client's contacts would be emailed on issue. */
  readonly contactCount: number;
  /** Today's UTC day, from the page, so the paid date prefill and bounds agree with the server. */
  readonly today: string;
};

/**
 * Exactly the buttons `nextActions` says are valid right now (spec 0012,
 * AC-11): issue and void on a draft; mark paid, void and resend on sent and
 * overdue; nothing on paid and void. The same pure module the actions read,
 * so the buttons a person sees and the moves the server allows cannot drift
 * apart.
 *
 * The last error sits beside the group rather than inside a button, so the
 * conflict sentence is still on screen once the refresh has replaced the
 * buttons with the fresh set, or removed them all.
 */
export function InvoiceActions({
  invoiceId,
  status,
  issueDate,
  lineCount,
  contactCount,
  today,
}: InvoiceActionsProps) {
  const router = useRouter();
  const [error, setError] = useState<ActionError | undefined>(undefined);
  const actions = nextActions(status);

  if (actions.length === 0 && error === undefined) {
    return undefined;
  }

  const onDone = (nextError?: ActionError) => {
    setError(nextError);
    router.refresh();
  };

  return (
    <div className="flex flex-col items-start gap-2">
      {actions.length > 0 ? (
        <div
          role="group"
          aria-label="Invoice actions"
          className="flex flex-wrap items-center gap-2"
        >
          {actions.includes("issue") ? (
            <IssueButton
              invoiceId={invoiceId}
              lineCount={lineCount}
              contactCount={contactCount}
              onDone={onDone}
            />
          ) : undefined}
          {actions.includes("mark_paid") ? (
            <MarkPaidDialog
              invoiceId={invoiceId}
              from={status}
              issueDate={issueDate}
              today={today}
              onDone={onDone}
            />
          ) : undefined}
          {actions.includes("resend") ? (
            <ResendButton invoiceId={invoiceId} onDone={onDone} />
          ) : undefined}
          {actions.includes("void") ? (
            <VoidDialog invoiceId={invoiceId} from={status} onDone={onDone} />
          ) : undefined}
        </div>
      ) : undefined}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          <ActionErrorMessage error={error} />
        </p>
      ) : undefined}
    </div>
  );
}
