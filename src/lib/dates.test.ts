/**
 * covers: spec 0012 AC-1, AC-2, AC-8, AC-12, Value sourcing "Today"
 *
 * The one place every calendar day the product computes comes from. No
 * database and no clock mocking needed: `todayUtc` is exercised as a real
 * UTC day, and `addDaysUtc`/`isRealCalendarDay` are pure functions of their
 * string inputs.
 */
import { describe, expect, it } from "vitest";

import {
  addDaysUtc,
  daysBetweenUtc,
  isRealCalendarDay,
  todayUtc,
} from "./dates";

describe("todayUtc", () => {
  it("returns the UTC calendar day as YYYY-MM-DD", () => {
    const value = todayUtc();

    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(value).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe("addDaysUtc", () => {
  it("adds calendar days within a month", () => {
    expect(addDaysUtc("2026-01-01", 30)).toBe("2026-01-31");
  });

  it("carries over a month boundary", () => {
    expect(addDaysUtc("2026-01-15", 20)).toBe("2026-02-04");
  });

  it("carries over a year boundary", () => {
    expect(addDaysUtc("2026-12-20", 15)).toBe("2027-01-04");
  });

  it("crosses February in a leap year", () => {
    expect(addDaysUtc("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("crosses February in a non leap year", () => {
    expect(addDaysUtc("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("subtracts with a negative count", () => {
    expect(addDaysUtc("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("is a no op with zero days", () => {
    expect(addDaysUtc("2026-06-15", 0)).toBe("2026-06-15");
  });
});

describe("isRealCalendarDay", () => {
  it("accepts a real day", () => {
    expect(isRealCalendarDay("2026-09-16")).toBe(true);
  });

  it("accepts the last day of a leap February", () => {
    expect(isRealCalendarDay("2028-02-29")).toBe(true);
  });

  it("refuses the 30th of February (Value sourcing, AC-2)", () => {
    expect(isRealCalendarDay("2026-02-30")).toBe(false);
  });

  it("refuses the 29th of February in a non leap year", () => {
    expect(isRealCalendarDay("2026-02-29")).toBe(false);
  });

  it("refuses a value that does not even match the pattern", () => {
    expect(isRealCalendarDay("15/10/2026")).toBe(false);
    expect(isRealCalendarDay("2026-9-16")).toBe(false);
    expect(isRealCalendarDay("")).toBe(false);
  });

  it("refuses month 13 and day 0", () => {
    expect(isRealCalendarDay("2026-13-01")).toBe(false);
    expect(isRealCalendarDay("2026-01-00")).toBe(false);
  });
});

describe("daysBetweenUtc (spec 0020, AC-5)", () => {
  it("is one for a due date of yesterday", () => {
    expect(daysBetweenUtc("2026-09-23", "2026-09-24")).toBe(1);
  });

  it("is zero for the same day", () => {
    expect(daysBetweenUtc("2026-09-24", "2026-09-24")).toBe(0);
  });

  it("carries over a month boundary", () => {
    expect(daysBetweenUtc("2026-08-31", "2026-09-02")).toBe(2);
  });

  it("is negative when `to` is earlier than `from`", () => {
    expect(daysBetweenUtc("2026-09-24", "2026-09-20")).toBe(-4);
  });
});
