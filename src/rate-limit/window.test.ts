/**
 * covers: spec 0018 AC-4, AC-5
 *
 * The pure arithmetic: which window an attempt falls in, how long until it
 * resets, and the sentence that says so. No database and no clock mocking
 * needed, every function takes `now` as a parameter.
 */
import { describe, expect, it } from "vitest";

import { CREATE_AGENCY, INVOICE_EMAIL, UPLOAD } from "./policies";
import { refusalMessage, retryAfterSeconds, windowStart } from "./window";

describe("windowStart", () => {
  it("aligns an hourly window to the top of the hour", () => {
    expect(windowStart(new Date("2026-06-15T14:37:22.500Z"), 3600)).toEqual(
      new Date("2026-06-15T14:00:00.000Z"),
    );
  });

  it("starts a new hourly window exactly on the hour", () => {
    expect(windowStart(new Date("2026-06-15T14:00:00.000Z"), 3600)).toEqual(
      new Date("2026-06-15T14:00:00.000Z"),
    );
  });

  it("aligns a daily window to 00:00 UTC", () => {
    expect(windowStart(new Date("2026-06-15T23:59:59.000Z"), 86400)).toEqual(
      new Date("2026-06-15T00:00:00.000Z"),
    );
  });
});

describe("retryAfterSeconds", () => {
  it("counts whole seconds up to the window's reset, rounded up", () => {
    const start = new Date("2026-06-15T14:00:00.000Z");

    expect(
      retryAfterSeconds(start, 3600, new Date("2026-06-15T14:59:01.400Z")),
    ).toBe(59);
  });
});

describe("refusalMessage", () => {
  it("reads in about 1 minute at 59 seconds (AC-5)", () => {
    expect(refusalMessage(UPLOAD, 59)).toBe(
      "Your agency has reached its upload allowance of 60 an hour. Try again in about 1 minute.",
    );
  });

  it("pluralises minutes under an hour", () => {
    expect(refusalMessage(UPLOAD, 600)).toBe(
      "Your agency has reached its upload allowance of 60 an hour. Try again in about 10 minutes.",
    );
  });

  it("reads in about 1 hour at 3599 seconds, never 60 minutes (AC-5)", () => {
    expect(refusalMessage(INVOICE_EMAIL, 3599)).toBe(
      "Your agency has reached its allowance of 50 invoice emails a day. Try again in about 1 hour.",
    );
  });

  it("reads in about 3 hours at 7201 seconds", () => {
    expect(refusalMessage(CREATE_AGENCY, 7201)).toBe(
      "You have reached the allowance of 3 new agencies a day. Try again in about 3 hours.",
    );
  });

  it("never reads a count of zero minutes", () => {
    expect(refusalMessage(UPLOAD, 0)).toBe(
      "Your agency has reached its upload allowance of 60 an hour. Try again in about 1 minute.",
    );
  });
});
