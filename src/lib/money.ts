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

/**
 * The three additions from spec 0012: the two parsers that turn what a person
 * typed into the integers the columns hold, and the one formatter that turns
 * the integers back into money a person reads. All three assume a currency
 * with two minor unit digits (spec 0012 Follow-up records the zero decimal
 * currency gap).
 */

/** A major unit amount as typed: up to 8 whole digits, at most 2 decimals. */
const MONEY_INPUT_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

/** A percent as typed: 0 to 100 with at most 2 decimals. */
const PERCENT_INPUT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

const HUNDRED = BigInt(100);

/** The most a line's unit amount may be, in cents (spec 0012, AC-3). */
export const MAX_UNIT_AMOUNT_CENTS = 99_999_999;

export type ParsedInput<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

/**
 * `"12.5"` becomes `1250` cents, `"0.07"` becomes `7`, `"1,000"` is refused.
 * Parsed as a decimal string, never through a float, so `"0.29"` is exactly
 * 29 and not 28.999999. The bound is the one AC-3 sets, 99,999,999 cents.
 */
export function parseMoneyInput(input: string): ParsedInput<number> {
  const trimmed = input.trim();

  if (!MONEY_INPUT_PATTERN.test(trimmed)) {
    return {
      ok: false,
      message:
        "Enter an amount like 1250 or 1250.50, with at most two decimals.",
    };
  }

  const [whole, fraction = ""] = trimmed.split(".");
  const cents = BigInt(whole) * HUNDRED + BigInt(fraction.padEnd(2, "0"));

  if (cents > BigInt(MAX_UNIT_AMOUNT_CENTS)) {
    return {
      ok: false,
      message: `Enter an amount of ${formatMoneyPlain(MAX_UNIT_AMOUNT_CENTS)} or less.`,
    };
  }

  return { ok: true, value: Number(cents) };
}

/**
 * `"7.25"` becomes `725` basis points, `"100"` becomes `10000`, `"7.255"` and
 * `"100.01"` are refused. Parsed as a decimal string, never through a float.
 */
export function percentToBasisPoints(input: string): ParsedInput<number> {
  const trimmed = input.trim();

  if (!PERCENT_INPUT_PATTERN.test(trimmed)) {
    return {
      ok: false,
      message: "Enter a percentage like 20 or 7.25, with at most two decimals.",
    };
  }

  const [whole, fraction = ""] = trimmed.split(".");
  const basisPoints = BigInt(whole) * HUNDRED + BigInt(fraction.padEnd(2, "0"));

  if (basisPoints > TEN_THOUSAND) {
    return { ok: false, message: "Enter a percentage between 0 and 100." };
  }

  return { ok: true, value: Number(basisPoints) };
}

/** `1234.56`, no symbol: the number a bound in a message is written with. */
function formatMoneyPlain(cents: number): string {
  const negative = cents < 0;
  const magnitude = Math.abs(cents);
  const whole = Math.floor(magnitude / 100).toLocaleString("en-US");
  const fraction = String(magnitude % 100).padStart(2, "0");

  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/**
 * Whole cents to the money a person reads, in the invoice's own currency:
 * `formatMoney(123456, "USD")` is `$1,234.56`, `formatMoney(123456, "EUR")`
 * is `€1,234.56`. The `en-US` locale regardless of the agency (spec 0012,
 * Consequences), and the split into whole and fraction is done in integers
 * so no float ever meets the amount: `Intl` only ever sees a string.
 */
export function formatMoney(cents: number, currency: string): string {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // `formatToParts` on a placeholder gives the symbol, its placement and any
  // spacing for this currency; the digits are then substituted, once, from
  // the integer split, in the place the first digit run sat.
  const parts = formatter.formatToParts(cents < 0 ? -1 : 1);
  const plain = formatMoneyPlain(cents).replace(/^-/, "");
  const digitRun = new Set(["integer", "group", "decimal", "fraction"]);
  const firstDigit = parts.findIndex((part) => digitRun.has(part.type));

  return parts
    .map((part, index) =>
      index === firstDigit ? plain : digitRun.has(part.type) ? "" : part.value,
    )
    .join("");
}
