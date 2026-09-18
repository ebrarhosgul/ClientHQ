/**
 * @vitest-environment node
 *
 * covers: spec 0019 AC-20, AC-21
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  errorName,
  logAnalyticsFailed,
  logErasureFailed,
  logObservabilityUnconfigured,
} from "./log";

const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

beforeEach(() => {
  warn.mockClear();
});

function line(): Record<string, unknown> {
  return JSON.parse(String(warn.mock.calls[0]?.[0])) as Record<string, unknown>;
}

describe("errorName", () => {
  it("is the error's class name for an Error", () => {
    expect(errorName(new TypeError("boom"))).toBe("TypeError");
  });

  it("is the typeof for anything else, and never carries the value itself", () => {
    expect(errorName("boom")).toBe("string");
    expect(errorName(42)).toBe("number");
    expect(errorName(undefined)).toBe("undefined");
  });
});

describe("logObservabilityUnconfigured", () => {
  it("names the missing keys and nothing else", () => {
    logObservabilityUnconfigured(["NEXT_PUBLIC_SENTRY_DSN"]);

    const parsed = line();
    expect(parsed).toMatchObject({
      event: "observability.unconfigured",
      missing: ["NEXT_PUBLIC_SENTRY_DSN"],
    });
    expect(parsed.at).toEqual(expect.any(String));
  });
});

describe("logAnalyticsFailed", () => {
  it("names the call and the error's class, never its message", () => {
    logAnalyticsFailed("invoice.issued", new Error("a secret detail"));

    const parsed = line();
    expect(parsed).toMatchObject({
      event: "analytics.failed",
      name: "invoice.issued",
      errorName: "Error",
    });
    expect(JSON.stringify(parsed)).not.toContain("a secret detail");
  });
});

describe("logErasureFailed", () => {
  it("names the Clerk user id and the error's class", () => {
    logErasureFailed("clerk_1", new RangeError("nope"));

    expect(line()).toMatchObject({
      event: "analytics.erasure_failed",
      clerkUserId: "clerk_1",
      errorName: "RangeError",
    });
  });
});
