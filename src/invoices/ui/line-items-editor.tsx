"use client";

import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";

import type { ActionError, Result } from "@/db/tenant";
import { formatMoney } from "@/lib/money";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/primitives/table";

import {
  addLineItem,
  moveLineItem,
  removeLineItem,
  updateLineItem,
} from "../line-items";
import type { LineItemRow } from "../queries";
import { MAX_LINES_PER_INVOICE } from "../status";

type LineValues = {
  readonly description: string;
  readonly quantity: string;
  readonly unitAmount: string;
};

type LineFormState = {
  readonly values: LineValues;
  readonly error?: ActionError;
};

const EMPTY_LINE: LineValues = {
  description: "",
  quantity: "1",
  unitAmount: "",
};

function lineValuesFromForm(form: FormData): LineValues {
  const read = (name: keyof LineValues) => String(form.get(name) ?? "");

  return {
    description: read("description"),
    quantity: read("quantity"),
    unitAmount: read("unitAmount"),
  };
}

/** `1250` cents as the `12.50` a person would type back in. */
function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** `2.500` as stored becomes `2.5`; `1.000` becomes `1`. */
function quantityToInput(quantity: string): string {
  return quantity.includes(".")
    ? quantity.replace(/0+$/, "").replace(/\.$/, "")
    : quantity;
}

/**
 * The three fields a line has, shared by the add form and the edit dialog.
 * `idPrefix` keeps the ids distinct when both are on the page; the input
 * names stay the Zod field names, which is what the error lookups read.
 */
function LineFields({
  idPrefix,
  values,
  fieldErrors,
  currency,
}: {
  readonly idPrefix: string;
  readonly values: LineValues;
  readonly fieldErrors: ActionError["fieldErrors"];
  readonly currency: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_7rem_9rem]">
      <Field
        name={`${idPrefix}-description`}
        label="Description"
        required
        error={fieldErrors?.description}
      >
        {(props) => (
          <Input
            {...props}
            name="description"
            defaultValue={values.description}
            maxLength={500}
            placeholder="Discovery workshop"
          />
        )}
      </Field>
      <Field
        name={`${idPrefix}-quantity`}
        label="Quantity"
        required
        error={fieldErrors?.quantity}
      >
        {(props) => (
          <Input
            {...props}
            type="text"
            inputMode="decimal"
            name="quantity"
            defaultValue={values.quantity}
            maxLength={13}
            className="tabular-nums"
          />
        )}
      </Field>
      <Field
        name={`${idPrefix}-unitAmount`}
        label={`Unit amount (${currency})`}
        required
        error={fieldErrors?.unitAmount}
      >
        {(props) => (
          <Input
            {...props}
            type="text"
            inputMode="decimal"
            name="unitAmount"
            defaultValue={values.unitAmount}
            maxLength={11}
            placeholder="0.00"
            className="tabular-nums"
          />
        )}
      </Field>
    </div>
  );
}

function AddLineForm({
  invoiceId,
  currency,
  disabled,
  onDone,
}: {
  readonly invoiceId: string;
  readonly currency: string;
  readonly disabled: boolean;
  readonly onDone: () => void;
}) {
  const [state, submit] = useActionState<LineFormState, FormData>(
    async (_previous, form) => {
      const values = lineValuesFromForm(form);
      const result = await addLineItem({ invoiceId, ...values });

      if (!result.ok) {
        return { values, error: result.error };
      }

      onDone();

      // A fresh form for the next line, so entering several in a row flows.
      return { values: EMPTY_LINE };
    },
    { values: EMPTY_LINE },
  );

  const general =
    state.error && state.error.fieldErrors === undefined
      ? state.error
      : undefined;

  return (
    <form
      action={submit}
      noValidate
      aria-labelledby="add-line-heading"
      // React resets the form after every action; the inputs are uncontrolled
      // and read their default from the state, so a success clears them and a
      // validation failure keeps what was typed.
      className="flex flex-col gap-3 rounded-md border border-dashed border-border p-4"
    >
      <h3 id="add-line-heading" className="text-sm font-medium">
        Add a line
      </h3>

      {general ? (
        <p role="alert" className="text-sm text-destructive">
          <ActionErrorMessage error={general} />
        </p>
      ) : undefined}

      <LineFields
        idPrefix="add-line"
        values={state.values}
        fieldErrors={state.error?.fieldErrors}
        currency={currency}
      />

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton
          variant="outline"
          size="sm"
          pendingLabel="Adding…"
          disabled={disabled}
        >
          <Plus />
          Add line
        </SubmitButton>
        {disabled ? (
          <p className="text-xs text-muted-foreground">
            This invoice has the most lines it can hold ({MAX_LINES_PER_INVOICE}
            ).
          </p>
        ) : undefined}
      </div>
    </form>
  );
}

function EditLineDialog({
  invoiceId,
  line,
  currency,
  onDone,
}: {
  readonly invoiceId: string;
  readonly line: LineItemRow;
  readonly currency: string;
  readonly onDone: () => void;
}) {
  const [open, setOpen] = useState(false);

  const initial: LineValues = {
    description: line.description,
    quantity: quantityToInput(line.quantity),
    unitAmount: centsToInput(line.unitAmountCents),
  };

  const [state, submit] = useActionState<LineFormState, FormData>(
    async (_previous, form) => {
      const values = lineValuesFromForm(form);
      const result = await updateLineItem({
        id: line.id,
        invoiceId,
        ...values,
      });

      if (!result.ok) {
        return { values, error: result.error };
      }

      setOpen(false);
      onDone();

      return { values };
    },
    { values: initial },
  );

  const general =
    state.error && state.error.fieldErrors === undefined
      ? state.error
      : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Edit ${line.description}`}
        >
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Edit line</DialogTitle>
            <DialogDescription>
              The amount is quantity times unit amount, and the totals update
              when you save.
            </DialogDescription>
          </DialogHeader>

          {general ? (
            <p role="alert" className="text-sm text-destructive">
              <ActionErrorMessage error={general} />
            </p>
          ) : undefined}

          <LineFields
            idPrefix={`edit-${line.id}`}
            values={state.values}
            fieldErrors={state.error?.fieldErrors}
            currency={currency}
          />

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <SubmitButton pendingLabel="Saving…">Save line</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A plain button that runs one line action and hands the outcome up. */
function LineActionButton({
  label,
  icon,
  run,
  onDone,
  disabled,
}: {
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly run: () => Promise<Result<unknown>>;
  readonly onDone: (error?: ActionError) => void;
  readonly disabled?: boolean;
}) {
  return (
    <form
      action={async () => {
        const result = await run();
        onDone(result.ok ? undefined : result.error);
      }}
    >
      <Button
        type="submit"
        size="icon-sm"
        variant="ghost"
        aria-label={label}
        disabled={disabled}
      >
        {icon}
      </Button>
    </form>
  );
}

export type LineItemsEditorProps = {
  readonly invoiceId: string;
  readonly currency: string;
  readonly lines: readonly LineItemRow[];
};

/**
 * The draft's lines: add, edit, remove, move up and move down, each its own
 * Server Action (spec 0012, AC-3, AC-11, AC-17).
 *
 * Every control on a row carries that line's description in its accessible
 * name, so "Move up" is never ambiguous to a screen reader. The last error
 * sits below the table rather than inside a row, so a conflict sentence is
 * still on screen once the refresh has replaced the rows. The totals are the
 * parent's: the refresh after every write brings them back through the
 * page, into the live region beside this table.
 */
export function LineItemsEditor({
  invoiceId,
  currency,
  lines,
}: LineItemsEditorProps) {
  const router = useRouter();
  const [error, setError] = useState<ActionError | undefined>(undefined);

  const onDone = (nextError?: ActionError) => {
    setError(nextError);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      {lines.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No lines yet. Add the first one below; the invoice needs at least one
          before it can be issued.
        </p>
      ) : (
        <div className="w-full min-w-0 overflow-x-auto rounded-lg border border-border">
          <Table>
            <caption className="sr-only">
              Line items, {lines.length} of {MAX_LINES_PER_INVOICE}
            </caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="w-px">
                  <span className="sr-only">Position</span>#
                </TableHead>
                <TableHead scope="col">Description</TableHead>
                <TableHead scope="col" className="text-right">
                  Qty
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Unit
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Amount
                </TableHead>
                <TableHead scope="col" className="w-px text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => (
                <TableRow key={line.id}>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {line.position}
                  </TableCell>
                  <TableCell className="max-w-md whitespace-normal">
                    {line.description}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {quantityToInput(line.quantity)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(line.unitAmountCents, currency)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatMoney(line.amountCents, currency)}
                  </TableCell>
                  <TableCell className="w-px">
                    <div className="flex items-center justify-end gap-0.5">
                      <LineActionButton
                        label={`Move ${line.description} up`}
                        icon={<ArrowUp />}
                        disabled={index === 0}
                        run={() =>
                          moveLineItem({
                            id: line.id,
                            invoiceId,
                            direction: "up",
                          })
                        }
                        onDone={onDone}
                      />
                      <LineActionButton
                        label={`Move ${line.description} down`}
                        icon={<ArrowDown />}
                        disabled={index === lines.length - 1}
                        run={() =>
                          moveLineItem({
                            id: line.id,
                            invoiceId,
                            direction: "down",
                          })
                        }
                        onDone={onDone}
                      />
                      <EditLineDialog
                        invoiceId={invoiceId}
                        line={line}
                        currency={currency}
                        onDone={() => onDone()}
                      />
                      <LineActionButton
                        label={`Remove ${line.description}`}
                        icon={<Trash2 />}
                        run={() => removeLineItem({ id: line.id, invoiceId })}
                        onDone={onDone}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          <ActionErrorMessage error={error} />
        </p>
      ) : undefined}

      <AddLineForm
        invoiceId={invoiceId}
        currency={currency}
        disabled={lines.length >= MAX_LINES_PER_INVOICE}
        onDone={() => onDone()}
      />
    </div>
  );
}
