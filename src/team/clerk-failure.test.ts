/**
 * @vitest-environment node
 *
 * covers: spec 0015 AC-11
 *
 * What an action says and logs when Clerk fails: a 429 is always the busy
 * message regardless of phase; every other failure is told apart only by
 * whether it happened before or during the write.
 */
import { describe, expect, it } from "vitest";

import {
  BUSY_MESSAGE,
  READ_FAILED_MESSAGE,
  WRITE_FAILED_MESSAGE,
  throwUnavailable,
  unavailableError,
  unavailableOutcome,
} from "./clerk-failure";

describe("unavailableOutcome", () => {
  it("is unavailable_busy for a rate limit, on either phase", () => {
    expect(unavailableOutcome("rate_limited", "read")).toBe("unavailable_busy");
    expect(unavailableOutcome("rate_limited", "write")).toBe(
      "unavailable_busy",
    );
  });

  it("is unavailable_read for a non rate limit failure on the read phase", () => {
    expect(unavailableOutcome("unreachable", "read")).toBe("unavailable_read");
    expect(unavailableOutcome("not_found", "read")).toBe("unavailable_read");
  });

  it("is unavailable_write for a non rate limit failure on the write phase", () => {
    expect(unavailableOutcome("unreachable", "write")).toBe(
      "unavailable_write",
    );
    expect(unavailableOutcome("duplicate", "write")).toBe("unavailable_write");
  });
});

describe("unavailableError", () => {
  it("is the busy message for a rate limit regardless of phase", () => {
    expect(unavailableError("rate_limited", "read")).toStrictEqual({
      code: "unavailable",
      message: BUSY_MESSAGE,
    });
    expect(unavailableError("rate_limited", "write")).toStrictEqual({
      code: "unavailable",
      message: BUSY_MESSAGE,
    });
  });

  it("says nothing changed for a read failure", () => {
    expect(unavailableError("unreachable", "read")).toStrictEqual({
      code: "unavailable",
      message: READ_FAILED_MESSAGE,
    });
  });

  it("says the change may or may not have applied for a write failure", () => {
    expect(unavailableError("unreachable", "write")).toStrictEqual({
      code: "unavailable",
      message: WRITE_FAILED_MESSAGE,
    });
  });
});

describe("throwUnavailable", () => {
  it("throws a TenantActionError carrying the same error unavailableError would return", () => {
    expect(() => throwUnavailable("unreachable", "write")).toThrow();

    try {
      throwUnavailable("rate_limited", "read");
      expect.unreachable("throwUnavailable must throw");
    } catch (thrown) {
      expect((thrown as Error).name).toBe("TenantActionError");
      expect((thrown as { error: unknown }).error).toStrictEqual({
        code: "unavailable",
        message: BUSY_MESSAGE,
      });
    }
  });
});
