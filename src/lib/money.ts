/**
 * Invoice arithmetic in whole cents.
 *
 * Every function here works in integers (BigInt underneath) and rounds half
 * away from zero, which is exactly what PostgreSQL `round()` does on `numeric`.
 * The CHECK constraints on `invoices` and `invoice_line_items` recompute the
 * same values in the database, so if these two ever disagreed a correct looking
 * write would be rejected. That is the safe direction, and it is why the money
 * tests assert the two agree at the rounding boundaries.
 *
 * Quantities travel as strings. `invoice_line_items.quantity` is
 * `numeric(12,3)` read back as a string on purpose: a JavaScript number would
 * bring back the float this whole design exists to avoid. Nothing here ever
 * calls `Number()` on a quantity.
 */

/** Exactly what the database column holds: up to 9 whole digits, up to 3 decimals. */
const QUANTITY_PATTERN = /^\d{1,9}(\.\d{1,3})?$/;

const THOUSAND = BigInt(1000);
const TEN_THOUSAND = BigInt(10000);
const INT4_MAX = BigInt(2147483647);

/**
 * Parse a quantity string to an integer count of thousandths.
 *
 * `"2.5"` becomes `2500n`, `"0.001"` becomes `1n`. Accepts only
 * `^\d{1,9}(\.\d{1,3})?$` after trimming and throws on anything else, including
 * scientific notation, negatives and a bare `"."`. Throwing is deliberate: the
 * Zod schema at the boundary has already refused malformed input, so reaching
 * this with a bad string is a programming error, not an expected failure.
 */
export function parseQuantityThousandths(quantity: string): bigint {
  const trimmed = quantity.trim();

  if (!QUANTITY_PATTERN.test(trimmed)) {
    throw new Error(
      `Quantity "${quantity}" is not a plain decimal with at most 9 whole digits and 3 decimals`,
    );
  }

  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole) * THOUSAND + BigInt(fraction.padEnd(3, "0"));
}

/** Is this string a quantity the database column can hold? */
export function isValidQuantity(quantity: string): boolean {
  return QUANTITY_PATTERN.test(quantity.trim());
}

/**
 * Integer division rounding half away from zero, like PostgreSQL `round()`.
 * `divisor` must be positive.
 */
export function divideRoundingHalfAwayFromZero(
  dividend: bigint,
  divisor: bigint,
): bigint {
  if (divisor <= BigInt(0)) {
    throw new Error("divisor must be positive");
  }

  const negative = dividend < BigInt(0);
  const magnitude = negative ? -dividend : dividend;
  const rounded = (magnitude * BigInt(2) + divisor) / (divisor * BigInt(2));

  return negative ? -rounded : rounded;
}

function toCents(value: bigint, what: string): number {
  if (value > INT4_MAX || value < -INT4_MAX) {
    throw new Error(`${what} of ${value} cents does not fit an integer column`);
  }
  return Number(value);
}

/**
 * A line's amount: `round(quantity * unit_amount_cents)`, the same expression
 * as the `invoice_line_items_amount_check` constraint.
 */
export function lineAmountCents(
  quantity: string,
  unitAmountCents: number,
): number {
  const thousandths = parseQuantityThousandths(quantity);
  const product = thousandths * BigInt(unitAmountCents);
  return toCents(
    divideRoundingHalfAwayFromZero(product, THOUSAND),
    "line amount",
  );
}

/**
 * Tax on a subtotal at a rate in basis points (2000 is 20 percent):
 * `round(subtotal_cents * tax_rate_bp / 10000)`, the same expression as the
 * `invoices_tax_check` constraint.
 */
export function taxCents(subtotalCents: number, taxRateBp: number): number {
  const product = BigInt(subtotalCents) * BigInt(taxRateBp);
  return toCents(divideRoundingHalfAwayFromZero(product, TEN_THOUSAND), "tax");
}

export type InvoiceTotals = {
  readonly subtotalCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
};

/**
 * The three totals an invoice stores, from its line amounts and tax rate.
 * `subtotal` is the one value the database cannot check on its own, since it
 * sums across rows; it is computed here and nowhere else.
 */
export function invoiceTotals(
  lineAmountsCents: readonly number[],
  taxRateBp: number,
): InvoiceTotals {
  const subtotal = lineAmountsCents.reduce(
    (sum, amount) => sum + BigInt(amount),
    BigInt(0),
  );
  const subtotalCents = toCents(subtotal, "subtotal");
  const tax = taxCents(subtotalCents, taxRateBp);

  return {
    subtotalCents,
    taxCents: tax,
    totalCents: toCents(subtotal + BigInt(tax), "total"),
  };
}
