/**
 * covers: spec 0018 AC-7, AC-8
 *
 * The two structured lines the door emits. `rate-limit.db.test.ts` and
 * `rate-limit.test.ts` already prove the door calls these at the right
 * moments with `toMatchObject`; this pins the exact envelope each line
 * writes, so an extra field (say, the refusal `message` itself) would fail
 * here even though a partial match elsewhere would not notice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logRefused, logSkipped } from "./log";
import type { RateLimitVerdict } from "./window";

const REFUSED: Extract<RateLimitVerdict, { readonly allowed: false }> = {
  allowed: false,
  subject: "org:org-1",
  action: "upload",
  count: 61,
  limit: 60,
  windowStart: new Date("2026-06-15T14:00:00.000Z"),
  retryAfterSeconds: 59,
  message:
    "Your agency has reached its upload allowance of 60 an hour. Try again in about 1 minute.",
};

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-15T14:05:00.000Z"));
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  warn.mockRestore();
});

function loggedLine(): Record<string, unknown> {
  expect(warn).toHaveBeenCalledTimes(1);
  return JSON.parse(warn.mock.calls[0]?.[0] as string) as Record<
    string,
    unknown
  >;
}

describe("logRefused", () => {
  it("writes exactly the refusal's identifiers, no name, email or input field (AC-8)", () => {
    logRefused(REFUSED);

    expect(loggedLine()).toStrictEqual({
      event: "rate_limit.refused",
      subject: "org:org-1",
      action: "upload",
      count: 61,
      limit: 60,
      windowStart: "2026-06-15T14:00:00.000Z",
      at: "2026-06-15T14:05:00.000Z",
    });
  });
});

describe("logSkipped", () => {
  it("writes exactly the store failure's identifiers and the real error name (AC-7)", () => {
    logSkipped({
      subject: "user:user-1",
      action: "create_agency",
      errorName: "TimeoutError",
    });

    expect(loggedLine()).toStrictEqual({
      event: "rate_limit.skipped",
      subject: "user:user-1",
      action: "create_agency",
      errorName: "TimeoutError",
      at: "2026-06-15T14:05:00.000Z",
    });
  });
});
