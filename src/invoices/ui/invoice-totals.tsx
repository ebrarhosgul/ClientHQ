import { formatTaxLabel, formatTaxRate } from "@/invoices/presentation";
import { formatMoney } from "@/lib/money";
import { cn } from "@/ui/lib/cn";

export type InvoiceTotalsProps = {
  readonly subtotalCents: number;
  readonly taxRateBp: number;
  readonly taxCents: number;
  readonly totalCents: number;
  readonly currency: string;
  readonly className?: string;
};

/** The tax rate input's prefill needs the bare percent; moved to `presentation.ts` (spec 0013). */
export { formatTaxRate };

/**
 * Subtotal, tax and total, in the invoice's own currency (spec 0012, AC-4).
 *
 * A polite live region: after a line write the page refreshes and React
 * updates these figures in place, which is what assistive technology
 * announces (AC-17). `role="status"` sits on a wrapper, not on the `<dl>`,
 * so the list keeps its own semantics; nothing else on the page announces a
 * totals change.
 */
export function InvoiceTotals({
  subtotalCents,
  taxRateBp,
  taxCents,
  totalCents,
  currency,
  className,
}: InvoiceTotalsProps) {
  return (
    <div
      role="status"
      aria-label="Invoice totals"
      className={cn("ml-auto w-full max-w-xs", className)}
    >
      <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm tabular-nums">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="text-right">{formatMoney(subtotalCents, currency)}</dd>
        <dt className="text-muted-foreground">{formatTaxLabel(taxRateBp)}</dt>
        <dd className="text-right">{formatMoney(taxCents, currency)}</dd>
        <dt className="border-t border-border pt-2 text-base font-semibold">
          Total
        </dt>
        <dd className="border-t border-border pt-2 text-right text-base font-semibold">
          {formatMoney(totalCents, currency)}{" "}
          <span className="text-xs font-normal text-muted-foreground">
            {currency}
          </span>
        </dd>
      </dl>
    </div>
  );
}
