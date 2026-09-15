/**
 * The input schemas for every invoice Server Action (spec 0012, AC-2, AC-3,
 * AC-8, AC-9).
 *
 * They describe forms, not rows, the same way `src/projects/schema.ts` does:
 * an optional field arrives as `""` from an untouched control, so it is
 * preprocessed to `undefined` before its own check runs. Money and percents
 * arrive as the strings a person typed and leave as the integers the columns
 * hold, parsed by `src/lib/money.ts` and never through a float.
 */
import { z } from "zod";

import { INVOICE_STATUSES } from "@/db/schema";
import { isRealCalendarDay } from "@/lib/dates";
import { parseMoneyInput, percentToBasisPoints } from "@/lib/money";

import { statusesAllowing } from "./status";

/** `""` (or whitespace only) becomes `undefined`, so a blank field is absent. */
function blankToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

/**
 * An optional, trimmed text capped at `max` characters, with a blank input
 * becoming an explicit `null` so it reaches Drizzle's `.set()` and clears the
 * column rather than being silently dropped.
 */
function clearableText(max: number): z.ZodType<string | null> {
  return z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .max(max, `Use ${max} characters or fewer.`)
      .optional()
      .transform((value) => value ?? null),
  );
}

/** `YYYY-MM-DD` and a real calendar day; the same round trip check projects use. */
const calendarDay = z
  .string()
  .trim()
  .refine(isRealCalendarDay, "Enter a real date.");

/** `invoices.id` and `invoice_line_items.id` are uuid columns; any other shape resolves not found (AC-14). */
export const invoiceId = z.uuid();
export const lineItemId = z.uuid();

const clientId = z.uuid("Choose a client.");

/** A tax rate as typed (`7.25`), stored as basis points (`725`). */
const taxRatePercent = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const parsed = percentToBasisPoints(value);

    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.message });

      return z.NEVER;
    }

    return parsed.value;
  });

/** A unit amount as typed in the major unit (`12.50`), stored as cents (`1250`). */
const unitAmount = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const parsed = parseMoneyInput(value);

    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.message });

      return z.NEVER;
    }

    return parsed.value;
  });

/** What `numeric(12,3)` can hold, and above zero (AC-3). */
const quantity = z
  .string()
  .trim()
  .regex(
    /^\d{1,9}(\.\d{1,3})?$/,
    "Enter a quantity like 1, 2.5 or 0.125, with at most three decimals.",
  )
  .refine((value) => Number(value) > 0, "Enter a quantity above zero.");

const description = z
  .string()
  .trim()
  .min(1, "Enter a description.")
  .max(500, "Use 500 characters or fewer.");

/** The line fields shared by add and update. */
const lineFields = {
  description,
  quantity,
  unitAmount,
} as const;

export const createInvoiceDraftInput = z.object({
  clientId,
});

export const updateInvoiceDraftInput = z.object({
  id: invoiceId,
  clientId,
  dueDate: calendarDay,
  taxRatePercent,
  notes: clearableText(5000),
});

export const addLineItemInput = z.object({
  invoiceId,
  ...lineFields,
});

export const updateLineItemInput = z.object({
  id: lineItemId,
  invoiceId,
  ...lineFields,
});

export const removeLineItemInput = z.object({
  id: lineItemId,
  invoiceId,
});

export const LINE_MOVE_DIRECTIONS = ["up", "down"] as const;

export const moveLineItemInput = z.object({
  id: lineItemId,
  invoiceId,
  direction: z.enum(LINE_MOVE_DIRECTIONS),
});

export const issueInvoiceInput = z.object({
  id: invoiceId,
});

/**
 * The compare and set moves carry the status the button was rendered from
 * (AC-8, AC-9). Each `from` enum is exactly the set `nextActions` allows the
 * action on, so a stale or forged `from` is refused at the boundary.
 */
function fromStatuses(action: Parameters<typeof statusesAllowing>[0]) {
  const allowed = statusesAllowing(action);

  return z
    .enum(INVOICE_STATUSES)
    .refine(
      (status) => allowed.includes(status),
      `This is only possible on an invoice that is ${allowed.join(" or ")}.`,
    );
}

export const markInvoicePaidInput = z.object({
  id: invoiceId,
  from: fromStatuses("mark_paid"),
  paidOn: calendarDay,
});

export const voidInvoiceInput = z.object({
  id: invoiceId,
  from: fromStatuses("void"),
  reason: clearableText(500),
});

export const resendInvoiceNotificationInput = z.object({
  id: invoiceId,
});

export type CreateInvoiceDraftInput = z.infer<typeof createInvoiceDraftInput>;
export type UpdateInvoiceDraftInput = z.infer<typeof updateInvoiceDraftInput>;
export type AddLineItemInput = z.infer<typeof addLineItemInput>;
export type UpdateLineItemInput = z.infer<typeof updateLineItemInput>;
export type RemoveLineItemInput = z.infer<typeof removeLineItemInput>;
export type MoveLineItemInput = z.infer<typeof moveLineItemInput>;
export type LineMoveDirection = (typeof LINE_MOVE_DIRECTIONS)[number];
export type IssueInvoiceInput = z.infer<typeof issueInvoiceInput>;
export type MarkInvoicePaidInput = z.infer<typeof markInvoicePaidInput>;
export type VoidInvoiceInput = z.infer<typeof voidInvoiceInput>;
export type ResendInvoiceNotificationInput = z.infer<
  typeof resendInvoiceNotificationInput
>;
