"use server";

/**
 * The four line item writes on a draft (spec 0012, AC-3, AC-4).
 *
 * Each is its own transaction that opens with the row locking compare and
 * set on `status = draft` (`lockDraft`), does its one change, then re reads
 * the lines and rewrites the totals (`recalculateTotals`), so the invoice's
 * totals are right after every committed write and a line can never be
 * written to an invoice that has stopped being a draft, even one racing the
 * issue transaction.
 *
 * `position` stays 1 based and contiguous: an add takes the current maximum
 * plus one, a remove shifts every higher line down by one, and a move swaps
 * two neighbours through a temporary position one above the current highest
 * (never 0: the CHECK is `position >= 1`) so the unique constraint never
 * trips.
 */
import { invoiceLineItems } from "@/db/schema";
import { tenantActionError, withTenantAction } from "@/db/tenant";
import { lineAmountCents, type InvoiceTotals } from "@/lib/money";

import {
  linesOf,
  lockDraft,
  recalculateTotals,
  type LineItemRow,
} from "./draft";
import { INVOICE_REVALIDATE } from "./revalidate";
import { MAX_LINES_PER_INVOICE } from "./status";
import {
  addLineItemInput,
  moveLineItemInput,
  removeLineItemInput,
  updateLineItemInput,
} from "./schema";

export type LineWriteResult = {
  readonly line: LineItemRow;
  readonly totals: InvoiceTotals;
};

export type TotalsResult = {
  readonly totals: InvoiceTotals;
};

export type MoveResult = {
  readonly positions: readonly {
    readonly id: string;
    readonly position: number;
  }[];
};

const LINE_TOO_LARGE = {
  code: "validation",
  message: "",
  fieldErrors: {
    unitAmount: [
      "That quantity and amount multiply to more than a line can hold. Reduce one of them.",
    ],
  },
} as const;

/** `round(quantity × unit amount)`, refused with a message rather than a database error when it overflows. */
function amountFor(quantity: string, unitAmountCents: number): number {
  try {
    return lineAmountCents(quantity, unitAmountCents);
  } catch {
    throw tenantActionError(LINE_TOO_LARGE);
  }
}

/** The one line, or `not_found` when it is not on this invoice in this agency. */
async function lineOn(
  lines: readonly LineItemRow[],
  id: string,
): Promise<LineItemRow> {
  const line = lines.find((candidate) => candidate.id === id);

  if (line === undefined) {
    throw tenantActionError({ code: "not_found", message: "" });
  }

  return line;
}

export const addLineItem = withTenantAction({
  name: "addLineItem",
  input: addLineItemInput,
  revalidate: INVOICE_REVALIDATE,
  transaction: true,
  handler: async ({ input, db }): Promise<LineWriteResult> => {
    const invoice = await lockDraft(db, input.invoiceId);
    const lines = await linesOf(db, invoice.id);

    if (lines.length >= MAX_LINES_PER_INVOICE) {
      throw tenantActionError({
        code: "validation",
        message: `An invoice can hold at most ${MAX_LINES_PER_INVOICE} lines.`,
      });
    }

    const position =
      lines.reduce((max, line) => Math.max(max, line.position), 0) + 1;

    const line = await db.insert(invoiceLineItems, {
      invoiceId: invoice.id,
      description: input.description,
      quantity: input.quantity,
      unitAmountCents: input.unitAmount,
      amountCents: amountFor(input.quantity, input.unitAmount),
      position,
    });

    const totals = await recalculateTotals(db, invoice);

    return { line, totals };
  },
});

export const updateLineItem = withTenantAction({
  name: "updateLineItem",
  input: updateLineItemInput,
  revalidate: INVOICE_REVALIDATE,
  transaction: true,
  handler: async ({ input, db }): Promise<LineWriteResult> => {
    const invoice = await lockDraft(db, input.invoiceId);
    const existing = await lineOn(await linesOf(db, invoice.id), input.id);

    const line = await db.update(invoiceLineItems, existing.id, {
      description: input.description,
      quantity: input.quantity,
      unitAmountCents: input.unitAmount,
      amountCents: amountFor(input.quantity, input.unitAmount),
    });

    if (line === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    const totals = await recalculateTotals(db, invoice);

    return { line, totals };
  },
});

export const removeLineItem = withTenantAction({
  name: "removeLineItem",
  input: removeLineItemInput,
  revalidate: INVOICE_REVALIDATE,
  transaction: true,
  handler: async ({ input, db }): Promise<TotalsResult> => {
    const invoice = await lockDraft(db, input.invoiceId);
    const lines = await linesOf(db, invoice.id);
    const removed = await lineOn(lines, input.id);

    await db.delete(invoiceLineItems, removed.id);

    // Close the gap: every higher line moves down by one, lowest first, so
    // no two rows ever share a position on the way.
    const higher = lines.filter((line) => line.position > removed.position);

    for (const line of higher) {
      await db.update(invoiceLineItems, line.id, {
        position: line.position - 1,
      });
    }

    const totals = await recalculateTotals(db, invoice);

    return { totals };
  },
});

export const moveLineItem = withTenantAction({
  name: "moveLineItem",
  input: moveLineItemInput,
  revalidate: INVOICE_REVALIDATE,
  transaction: true,
  handler: async ({ input, db }): Promise<MoveResult> => {
    const invoice = await lockDraft(db, input.invoiceId);
    const lines = await linesOf(db, invoice.id);
    const moving = await lineOn(lines, input.id);

    const targetPosition =
      input.direction === "up" ? moving.position - 1 : moving.position + 1;
    const neighbour = lines.find((line) => line.position === targetPosition);

    // A move past either end is a no op success.
    if (neighbour === undefined) {
      return {
        positions: lines.map(({ id, position }) => ({ id, position })),
      };
    }

    const parking =
      lines.reduce((max, line) => Math.max(max, line.position), 0) + 1;

    await db.update(invoiceLineItems, moving.id, { position: parking });
    await db.update(invoiceLineItems, neighbour.id, {
      position: moving.position,
    });
    await db.update(invoiceLineItems, moving.id, { position: targetPosition });

    const after = await linesOf(db, invoice.id);

    return {
      positions: after.map(({ id, position }) => ({ id, position })),
    };
  },
});
