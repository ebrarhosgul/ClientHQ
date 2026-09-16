/**
 * The one place every string on the invoice PDF, and on the frozen document
 * `/invoices/[id]` shows once an invoice leaves `draft`, comes from (spec
 * 0013, AC-3, AC-4). A pure function over the frozen rows: no React, no IO,
 * so the PDF and the screen cannot disagree on a value, only on layout.
 */
import { formatMoney } from "@/lib/money";

import type { LineItemRow } from "./draft";
import {
  formatInvoiceNumber,
  isPastDue,
  type ClientVisibleStatus,
} from "./status";

/** The six billing address columns `clients` carries (spec 0002), all nullable. */
export type BillingAddressClient = {
  readonly billingAddressLine1: string | null;
  readonly billingAddressLine2: string | null;
  readonly billingCity: string | null;
  readonly billingRegion: string | null;
  readonly billingPostalCode: string | null;
  readonly billingCountry: string | null;
};

function nonBlank(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * The client's billing address, one line per row (spec 0013, Value sourcing):
 * address line 1, address line 2, then city/region/postal joined by ", ",
 * then country. Blank lines are dropped rather than shown empty.
 */
export function billingAddressLines(
  client: BillingAddressClient,
): readonly string[] {
  const cityLine = [
    client.billingCity,
    client.billingRegion,
    client.billingPostalCode,
  ]
    .filter(nonBlank)
    .join(", ");

  return [
    client.billingAddressLine1,
    client.billingAddressLine2,
    cityLine === "" ? null : cityLine,
    client.billingCountry,
  ].filter(nonBlank);
}

/**
 * `"2.500"` as stored reads as `"2.5"`; `"1.000"` as `"1"`. Moved here from
 * `invoice-document.tsx` (spec 0013): the PDF needs the same trim.
 */
export function displayQuantity(quantity: string): string {
  return quantity.includes(".")
    ? quantity.replace(/0+$/, "").replace(/\.$/, "")
    : quantity;
}

/**
 * `725` basis points as `"7.25%"`, with no trailing zero past the point.
 * Moved here from `invoice-totals.tsx`, which re-exports it: the tax rate
 * input's prefill (`invoice-header-form.tsx`) needs the bare percent, and
 * `formatTaxLabel` below needs the same math.
 */
export function formatTaxRate(taxRateBp: number): string {
  const whole = Math.floor(taxRateBp / 100);
  const fraction = taxRateBp % 100;

  return fraction === 0
    ? `${whole}%`
    : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}%`;
}

/**
 * `725` as `"Tax (7.25%)"`, `0` as `"Tax (0%)"` (spec 0013, AC-3). Exported
 * for `InvoiceTotals`, which no longer builds this text in JSX.
 */
export function formatTaxLabel(taxRateBp: number): string {
  return `Tax (${formatTaxRate(taxRateBp)})`;
}

/**
 * Exhaustive over exactly the three statuses a PDF ever exists for (spec
 * 0013, Value sourcing): the only statuses `presentInvoice` is ever called
 * with, since a PDF and this frozen document both gate on `isClientVisible`
 * first. A `void` invoice's on screen document keeps its own, unrelated
 * rendering; there is no fourth entry to keep that boundary honest.
 */
const STATUS_LABELS: Readonly<Record<ClientVisibleStatus, string>> = {
  sent: "Sent",
  overdue: "Overdue",
  paid: "Paid",
};

function paidOnLine(paidAt: Date | null): string | undefined {
  return paidAt === null
    ? undefined
    : `Paid on ${paidAt.toISOString().slice(0, 10)}`;
}

/** `YYYY-MM-DD HH:MM UTC`, for the PDF's footer (spec 0013, AC-3). */
function formatGenerated(generatedAt: Date): string {
  const iso = generatedAt.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export type InvoicePresentationInvoice = {
  readonly number: number;
  readonly status: ClientVisibleStatus;
  readonly issueDate: string | null;
  readonly dueDate: string | null;
  readonly currency: string;
  readonly taxRateBp: number;
  readonly subtotalCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
  readonly notes: string | null;
  readonly paidAt: Date | null;
};

export type InvoicePresentationInput = {
  readonly invoice: InvoicePresentationInvoice;
  readonly client: { readonly name: string } & BillingAddressClient;
  readonly lines: readonly Pick<
    LineItemRow,
    "id" | "description" | "quantity" | "unitAmountCents" | "amountCents"
  >[];
  readonly agencyName: string;
  /** `todayUtc()` (`src/lib/dates.ts`), passed in so every caller agrees on the day. */
  readonly todayUtc: string;
  /** A `Date` the caller creates once per request/render. */
  readonly generatedAt: Date;
};

export type InvoicePresentation = {
  readonly agencyName: string;
  readonly title: string;
  readonly number: string;
  readonly status: {
    readonly label: string;
    readonly pastDue: boolean;
    readonly paidOn?: string;
  };
  readonly issued: string;
  readonly due: string;
  readonly billTo: {
    readonly name: string;
    readonly lines: readonly string[];
  };
  readonly lines: readonly {
    readonly id: string;
    readonly description: string;
    readonly quantity: string;
    readonly unit: string;
    readonly amount: string;
  }[];
  readonly totals: {
    readonly subtotal: string;
    readonly taxLabel: string;
    readonly tax: string;
    readonly total: string;
  };
  readonly notes?: string;
  readonly generated: string;
  readonly documentTitle: string;
};

/**
 * Every string the PDF, and the screen's frozen document, show for an
 * invoice in a client visible status (spec 0013, AC-3, AC-4). Never throws
 * on a valid row.
 */
export function presentInvoice({
  invoice,
  client,
  lines,
  agencyName,
  todayUtc,
  generatedAt,
}: InvoicePresentationInput): InvoicePresentation {
  const number = formatInvoiceNumber(invoice.number);

  return {
    agencyName,
    title: "Invoice",
    number,
    status: {
      label: STATUS_LABELS[invoice.status],
      pastDue: isPastDue(invoice.status, invoice.dueDate, todayUtc),
      paidOn: paidOnLine(invoice.paidAt),
    },
    issued: invoice.issueDate ?? "",
    due: invoice.dueDate ?? "",
    billTo: {
      name: client.name,
      lines: billingAddressLines(client),
    },
    lines: lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: displayQuantity(line.quantity),
      unit: formatMoney(line.unitAmountCents, invoice.currency),
      amount: formatMoney(line.amountCents, invoice.currency),
    })),
    totals: {
      subtotal: formatMoney(invoice.subtotalCents, invoice.currency),
      taxLabel: formatTaxLabel(invoice.taxRateBp),
      tax: formatMoney(invoice.taxCents, invoice.currency),
      total: formatMoney(invoice.totalCents, invoice.currency),
    },
    notes: invoice.notes ?? undefined,
    generated: formatGenerated(generatedAt),
    // The issue email's subject rule (spec 0012): "Invoice <number> from <agency>".
    documentTitle: `Invoice ${number} from ${agencyName}`,
  };
}
