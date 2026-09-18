/**
 * @vitest-environment node
 *
 * covers: spec 0019 AC-9, AC-12, AC-21, AC-22
 *
 * The client's two promises: it never throws into a caller, and it is silent
 * without a key or under test. `after()` from `next/server` has no request
 * to attach to here, so the flush runs right away, which is what lets the
 * recording sink see it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { analytics, createAnalytics, resetAnalyticsForTests } from "./client";
import { recordingSink } from "./sink";

const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

beforeEach(() => {
  warn.mockClear();
  resetAnalyticsForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function lines(): { event: string; name?: string; errorName?: string }[] {
  return warn.mock.calls.map(([line]) => JSON.parse(String(line)));
}

describe("track", () => {
  it("captures with org_id stamped and the properties parsed, then flushes", async () => {
    const sink = recordingSink();
    const client = createAnalytics({ sink });

    client.track("invoice.issued", {
      distinctId: { kind: "user", clerkUserId: "user_1" },
      orgId: "org_1",
      properties: { invoice_id: "inv_1", is_first: true },
    });

    expect(sink.calls[0]).toEqual({
      kind: "capture",
      message: {
        distinctId: "user_1",
        event: "invoice.issued",
        properties: { invoice_id: "inv_1", is_first: true, org_id: "org_1" },
      },
    });
    // Outside a request the flush runs on the next tick rather than through
    // `after()`.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sink.calls[1]).toEqual({ kind: "flush" });
  });

  it("sends a client event without a person profile (AC-12)", () => {
    const sink = recordingSink();
    const client = createAnalytics({ sink });

    client.track("portal.viewed", {
      distinctId: { kind: "client", clientId: "client_1" },
      orgId: "org_1",
      properties: { client_id: "client_1", path: "/portal" },
    });

    const [call] = sink.calls;

    expect(call?.kind).toBe("capture");
    expect(call?.kind === "capture" && call.message.distinctId).toBe(
      "client:client_1",
    );
    expect(call?.kind === "capture" && call.message.properties).toMatchObject({
      $process_person_profile: false,
    });
  });

  it("drops an event sent for the wrong kind of subject, with one log line", () => {
    const sink = recordingSink();
    const client = createAnalytics({ sink });

    client.track("agency.created", {
      distinctId: { kind: "client", clientId: "client_1" },
      orgId: "org_1",
    });

    expect(sink.calls).toEqual([]);
    expect(lines()).toEqual([
      expect.objectContaining({
        event: "analytics.failed",
        name: "agency.created",
        errorName: "TypeError",
      }),
    ]);
  });

  it("drops properties that do not parse, and never the sink sees them", () => {
    const sink = recordingSink();
    const client = createAnalytics({ sink });

    client.track("invoice.issued", {
      distinctId: { kind: "user", clerkUserId: "user_1" },
      orgId: "org_1",
      // A runtime caller can still hand a wrong value; the parse catches it.
      properties: { invoice_id: "", is_first: true },
    });

    expect(sink.calls).toEqual([]);
    expect(lines()[0]?.event).toBe("analytics.failed");
  });
});

describe("a provider failure never reaches the caller (AC-21)", () => {
  it("swallows a throwing sink on every call and logs once per call", async () => {
    const client = createAnalytics({ sink: recordingSink({ failing: true }) });

    expect(() =>
      client.track("agency.created", {
        distinctId: { kind: "user", clerkUserId: "u" },
        orgId: "o",
      }),
    ).not.toThrow();
    expect(() =>
      client.identify("u", {
        role: "admin",
        created_at: new Date().toISOString(),
      }),
    ).not.toThrow();
    expect(() =>
      client.groupIdentify("o", {
        subscription_status: "none",
        created_at: new Date().toISOString(),
        team_size: 1,
      }),
    ).not.toThrow();
    await expect(client.deletePerson("u")).resolves.toBe(false);
    await expect(client.flush()).resolves.toBeUndefined();

    const events = lines();

    expect(events.every((line) => line.event === "analytics.failed")).toBe(
      true,
    );
    expect(events.map((line) => line.name)).toEqual([
      "agency.created",
      "identify",
      "groupIdentify",
      "deletePerson",
      "flush",
    ]);
    // The error's name, never its message and never the properties.
    expect(JSON.stringify(events)).not.toContain("provider down");
  });
});

describe("the default client (AC-22)", () => {
  it("is a no op under NODE_ENV=test even with a key set, and says so", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");

    expect(analytics().enabled).toBe(false);

    expect(() =>
      analytics().track("agency.created", {
        distinctId: { kind: "user", clerkUserId: "u" },
        orgId: "o",
      }),
    ).not.toThrow();
    expect(lines()).toEqual([]);
  });
});
