/**
 * @vitest-environment node
 *
 * covers: spec 0007 AC-21
 *
 * One JSON line per webhook outcome that is not "handled", carrying `event`,
 * `outcome`, `eventId`, `eventType`, `reason` and `at`, and on the unverified
 * path no identifier it cannot vouch for. The line is what a person reads when
 * Stripe's delivery log says a webhook was answered 500, so its shape is a
 * contract rather than a detail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logStripeWebhook } from "./log";

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-11T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The one line written, parsed back out of the JSON. */
function loggedLine(): Record<string, unknown> {
  expect(warn).toHaveBeenCalledTimes(1);

  return JSON.parse(warn.mock.calls[0]?.[0] as string) as Record<
    string,
    unknown
  >;
}

describe("logStripeWebhook (AC-21)", () => {
  it("writes exactly one line with every field the spec names, for a failure", () => {
    logStripeWebhook({
      outcome: "failed",
      eventId: "evt_1",
      eventType: "customer.subscription.updated",
      reason: "connection reset",
    });

    expect(loggedLine()).toStrictEqual({
      event: "stripe.webhook",
      outcome: "failed",
      eventId: "evt_1",
      eventType: "customer.subscription.updated",
      reason: "connection reset",
      at: "2026-09-11T10:00:00.000Z",
    });
  });

  it("carries no event id or type on the unverified path, where neither can be trusted", () => {
    logStripeWebhook({ outcome: "unverified", reason: "bad_signature" });

    const line = loggedLine();

    expect(line).toStrictEqual({
      event: "stripe.webhook",
      outcome: "unverified",
      reason: "bad_signature",
      at: "2026-09-11T10:00:00.000Z",
    });
    expect(line).not.toHaveProperty("eventId");
    expect(line).not.toHaveProperty("eventType");
  });

  it("stamps the line with the current time in ISO 8601", () => {
    vi.setSystemTime(new Date("2026-12-31T23:59:59.999Z"));

    logStripeWebhook({ outcome: "ignored", reason: "unsubscribed_event_type" });

    expect(loggedLine().at).toBe("2026-12-31T23:59:59.999Z");
  });

  it("is valid JSON on a single line, so a log collector can parse it", () => {
    logStripeWebhook({
      outcome: "refused",
      eventId: "evt_2",
      eventType: "invoice.payment_failed",
      reason: "org_not_found",
    });

    const raw = warn.mock.calls[0]?.[0] as string;

    expect(raw).not.toContain("\n");
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
