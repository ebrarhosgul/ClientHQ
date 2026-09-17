/**
 * @vitest-environment node
 *
 * covers: spec 0015 AC-14
 *
 * One JSON line per Clerk webhook outcome that is not "handled", carrying
 * `event`, `outcome`, `eventId`, `eventType`, `reason` and `at`, and never a
 * payload, an email address, a name or an image URL. Shaped like
 * `src/payments/log.test.ts` on the same one call, one line rule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logClerkWebhook } from "./webhook-log";

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-17T10:00:00.000Z"));
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

describe("logClerkWebhook (AC-14)", () => {
  it("writes exactly one line with every field a failure carries", () => {
    logClerkWebhook({
      outcome: "failed",
      eventId: "evt_1",
      eventType: "organization.updated",
      clerkOrgId: "org_1",
      reason: "connection reset",
    });

    expect(loggedLine()).toStrictEqual({
      event: "clerk.webhook",
      outcome: "failed",
      eventId: "evt_1",
      eventType: "organization.updated",
      clerkOrgId: "org_1",
      reason: "connection reset",
      at: "2026-09-17T10:00:00.000Z",
    });
  });

  it("carries no identifier on the unverified path, where none can be trusted", () => {
    logClerkWebhook({ outcome: "unverified", reason: "bad_signature" });

    const line = loggedLine();

    expect(line).toStrictEqual({
      event: "clerk.webhook",
      outcome: "unverified",
      reason: "bad_signature",
      at: "2026-09-17T10:00:00.000Z",
    });
    expect(line).not.toHaveProperty("eventId");
    expect(line).not.toHaveProperty("eventType");
    expect(line).not.toHaveProperty("clerkOrgId");
    expect(line).not.toHaveProperty("clerkUserId");
  });

  it("carries only the identifier the reference actually names", () => {
    logClerkWebhook({
      outcome: "refused",
      eventId: "evt_2",
      eventType: "user.deleted",
      clerkUserId: "user_1",
      reason: "user_deleted",
    });

    const line = loggedLine();

    expect(line).toMatchObject({ clerkUserId: "user_1" });
    expect(line).not.toHaveProperty("clerkOrgId");
  });

  it("never carries an email address, a name or an image URL, whatever the reason string holds", () => {
    logClerkWebhook({
      outcome: "refused",
      eventId: "evt_3",
      eventType: "user.updated",
      clerkUserId: "user_1",
      reason: "user_deleted",
    });

    const raw = warn.mock.calls[0]?.[0] as string;

    expect(raw).not.toContain("@");
    expect(raw).not.toContain("http");
  });

  it("stamps the line with the current time in ISO 8601", () => {
    vi.setSystemTime(new Date("2026-12-31T23:59:59.999Z"));

    logClerkWebhook({ outcome: "ignored", reason: "unsubscribed_event_type" });

    expect(loggedLine().at).toBe("2026-12-31T23:59:59.999Z");
  });

  it("is valid JSON on a single line, so a log collector can parse it", () => {
    logClerkWebhook({
      outcome: "duplicate",
      eventId: "evt_4",
      eventType: "organizationMembership.created",
      clerkOrgId: "org_1",
      clerkUserId: "user_1",
      reason: "already_processed",
    });

    const raw = warn.mock.calls[0]?.[0] as string;

    expect(raw).not.toContain("\n");
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
