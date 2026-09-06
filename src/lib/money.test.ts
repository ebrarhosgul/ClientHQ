/**
 * @vitest-environment node
 *
 * The arithmetic in isolation. `money.db.test.ts` runs the same boundary cases
 * through PostgreSQL to prove the two round the same way.
 */
import { describe, expect, it } from "vitest";

import {
  divideRoundingHalfAwayFromZero,
  invoiceTotals,
  isValidQuantity,
  lineAmountCents,
  parseQuantityThousandths,
  taxCents,
} from "./money";

describe("parseQuantityThousandths", () => {
  it.each([
    ["1", 1000],
    ["2.5", 2500],
    ["0.001", 1],
    ["0.5", 500],
    ["123456789.999", 123456789999],
    [" 3 ", 3000],
  ])("parses %s to %d thousandths", (input, expected) => {
    expect(parseQuantityThousandths(input)).toBe(BigInt(expected));
  });

  it.each([
    "",
    ".",
    "1.",
    ".5",
    "-1",
    "+1",
    "1e3",
    "1.0000",
    "1234567890",
    "1,5",
    "abc",
    "NaN",
    "Infinity",
  ])("rejects %j", (input) => {
    expect(() => parseQuantityThousandths(input)).toThrow();
    expect(isValidQuantity(input)).toBe(false);
  });
});

describe("divideRoundingHalfAwayFromZero", () => {
  it.each([
    [5, 10, 1],
    [4, 10, 0],
    [15, 10, 2],
    [25, 10, 3],
    [-5, 10, -1],
    [-15, 10, -2],
    [0, 10, 0],
  ])("%d / %d rounds to %d", (dividend, divisor, expected) => {
    expect(
      divideRoundingHalfAwayFromZero(BigInt(dividend), BigInt(divisor)),
    ).toBe(BigInt(expected));
  });

  it("refuses a divisor that is not positive", () => {
    expect(() =>
      divideRoundingHalfAwayFromZero(BigInt(1), BigInt(0)),
    ).toThrow();
  });
});

describe("lineAmountCents", () => {
  it.each([
    ["1", 1500, 1500],
    ["2.5", 1000, 2500],
    // Exactly half a cent rounds up, as PostgreSQL round() does.
    ["0.5", 1, 1],
    ["1.5", 1, 2],
    ["2.5", 1, 3],
    ["0.005", 100, 1],
    ["0.004", 100, 0],
    ["0.333", 300, 100],
    ["3", 0, 0],
  ])("%s × %d cents = %d cents", (quantity, unit, expected) => {
    expect(lineAmountCents(quantity, unit)).toBe(expected);
  });

  it("refuses a result that does not fit an integer column", () => {
    expect(() => lineAmountCents("999999999", 2147483647)).toThrow();
  });
});

describe("taxCents", () => {
  it.each([
    [100, 2000, 20],
    // 25 × 15% = 3.75, rounds to 4.
    [25, 1500, 4],
    // 5 × 5% = 0.25, rounds to 0.
    [5, 500, 0],
    // 10 × 5% = 0.5, rounds to 1.
    [10, 500, 1],
    [999, 0, 0],
    [1000000000, 10000, 1000000000],
  ])("%d cents at %d bp = %d cents", (subtotal, rate, expected) => {
    expect(taxCents(subtotal, rate)).toBe(expected);
  });
});

describe("invoiceTotals", () => {
  it("sums the lines and adds the tax, so total = subtotal + tax", () => {
    expect(invoiceTotals([1500, 2500, 1], 2000)).toEqual({
      subtotalCents: 4001,
      taxCents: 800,
      totalCents: 4801,
    });
  });

  it("has a zero subtotal, tax and total for no lines", () => {
    expect(invoiceTotals([], 2000)).toEqual({
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
  });

  it("refuses a total that does not fit an integer column", () => {
    expect(() => invoiceTotals([2000000000], 10000)).toThrow();
  });
});
