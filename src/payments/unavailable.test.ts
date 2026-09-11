/**
 * @vitest-environment node
 *
 * covers: spec 0007 API surface, both actions answer `unavailable` on a Stripe
 * failure
 *
 * `throughStripe` is the one place a provider failure becomes the project's own
 * refusal. Two things are pinned: the agency never sees Stripe's message, which
 * can name a key or an account, and the log line that does carry it has the
 * shape the tenant layer's log lines have.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isTenantActionError } from "@/db/tenant/errors";

import { throughStripe } from "./unavailable";

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** The one JSON line written, parsed. */
function loggedLine(): Record<string, unknown> {
  expect(warn).toHaveBeenCalledTimes(1);

  return JSON.parse(warn.mock.calls[0]?.[0] as string) as Record<
    string,
    unknown
  >;
}

describe("throughStripe", () => {
  it("returns what the call returned, and logs nothing, when Stripe answers", async () => {
    const result = await throughStripe(
      "checkout.sessions.create",
      async () => ({
        url: "https://checkout.stripe.com/x",
      }),
    );

    expect(result).toStrictEqual({ url: "https://checkout.stripe.com/x" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("turns a Stripe failure into an unavailable action error", async () => {
    const attempt = throughStripe("checkout.sessions.create", async () => {
      throw new Error("Invalid API Key provided: sk_test_****");
    });

    await expect(attempt).rejects.toSatisfy(
      (thrown: unknown) =>
        isTenantActionError(thrown) && thrown.error.code === "unavailable",
    );
  });

  it("tells the agency nothing was charged, and nothing of what Stripe said", async () => {
    const attempt = throughStripe("billingPortal.sessions.create", async () => {
      throw new Error("No such customer: 'cus_123' on acct_456");
    });

    await expect(attempt).rejects.toSatisfy((thrown: unknown) => {
      if (!isTenantActionError(thrown)) {
        return false;
      }

      const { message } = thrown.error;

      return (
        /nothing was charged/i.test(message) &&
        !message.includes("cus_123") &&
        !message.includes("acct_456")
      );
    });
  });

  it("writes exactly one JSON line naming the operation and Stripe's reason", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T10:00:00.000Z"));

    await throughStripe("checkout.sessions.create", async () => {
      throw new Error("rate limited");
    }).catch(() => undefined);

    expect(loggedLine()).toStrictEqual({
      event: "stripe.request_failed",
      operation: "checkout.sessions.create",
      reason: "rate limited",
      at: "2026-09-11T10:00:00.000Z",
    });
  });

  it("logs unknown_error when what was thrown is not an Error at all", async () => {
    await throughStripe("checkout.sessions.create", async () => {
      throw "a bare string";
    }).catch(() => undefined);

    expect(loggedLine().reason).toBe("unknown_error");
  });
});
