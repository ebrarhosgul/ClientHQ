/**
 * What "today" means, in one place.
 *
 * No timezone is modelled (spec 0002's deferred item), so every calendar day
 * the product computes is the server clock's UTC day: a project's overdue
 * badge (spec 0010), an invoice's issue date, its due date prefill, the paid
 * date bounds and the past due badge (spec 0012), and feature 18's nightly
 * sweep. They all read this function so no two of them can disagree about
 * what day it is. When an agency timezone lands, this is the one function
 * that changes.
 */

/**
 * The server clock's UTC calendar day, `YYYY-MM-DD`.
 *
 * `now` defaults to the real clock; the nightly sweep (spec 0017) passes its
 * own run-start `Date` instead, so every sweep in a run agrees on the day and
 * a test can fix it, without this function's callers elsewhere noticing a
 * change.
 */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * `day` plus `days` calendar days, in UTC, as `YYYY-MM-DD`. Pure: the day is
 * a parameter so a test can fix it and so a prefill and the check against it
 * agree on the same "today".
 */
export function addDaysUtc(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, date + days))
    .toISOString()
    .slice(0, 10);
}

/**
 * Whole calendar days from `from` to `to`, both `YYYY-MM-DD`. Positive when
 * `to` is later. Used for "N days overdue" (spec 0020, AC-5), so a due date of
 * yesterday against today is `1`, never `0` or a fraction: both sides are
 * parsed as UTC midnight, so no daylight or timezone shift can round a day
 * away.
 */
export function daysBetweenUtc(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);

  return Math.round((toMs - fromMs) / 86_400_000);
}

/**
 * `YYYY-MM-DD`, and a real calendar day. Matching the pattern is not enough
 * on its own: `2026-02-30` matches it and is not a real day, so the string is
 * round tripped through `Date.UTC` and compared back to itself (spec 0010 and
 * spec 0012, Value sourcing).
 */
export function isRealCalendarDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);

  if (match === null) {
    return false;
  }

  const [, year, month, day] = match;
  const asDate = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );

  return asDate.toISOString().slice(0, 10) === value;
}
