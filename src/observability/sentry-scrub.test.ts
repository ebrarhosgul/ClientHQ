// @vitest-environment node
import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { scrubEvent } from "./sentry-scrub";

describe("scrubEvent (spec 0019, AC-4)", () => {
  const event: ErrorEvent = {
    type: undefined,
    event_id: "abc",
    message: "boom",
    tags: { org_id: "org_1", runtime: "node" },
    user: {
      id: "user_1",
      email: "person@example.com",
      username: "person",
      ip_address: "203.0.113.9",
    },
    request: {
      url: "https://app.example.com/invoices/1?ref=abc",
      method: "POST",
      headers: { authorization: "Bearer secret", cookie: "sid=1" },
      cookies: { sid: "1" },
      data: { name: "Acme", email: "person@example.com" },
      query_string: "token=abc",
    },
    breadcrumbs: [
      { category: "console", message: "sent to person@example.com" },
      { category: "console", message: "cache warm" },
      { category: "fetch", message: "GET /api" },
      {
        category: "fetch",
        data: { method: "GET", url: "https://app.example.com/api?key=xyz" },
      },
      {
        category: "navigation",
        data: {
          from: "/portal/accept?token=raw-invite-token",
          to: "/onboarding",
        },
      },
    ],
  };

  it("removes headers, cookies, body and query string, and reduces url to origin plus pathname", () => {
    const scrubbed = scrubEvent(event);

    expect(scrubbed.request).toEqual({
      url: "https://app.example.com/invoices/1",
      method: "POST",
    });
  });

  it("reduces a request url that carries a live invite token", () => {
    const withToken: ErrorEvent = {
      ...event,
      request: {
        ...event.request,
        url: "https://app.example.com/portal/accept?token=raw-invite-token",
      },
    };

    expect(scrubEvent(withToken).request?.url).toBe(
      "https://app.example.com/portal/accept",
    );
  });

  it("reduces url-shaped fields in breadcrumb data instead of leaving them untouched", () => {
    const scrubbed = scrubEvent(event);

    expect(scrubbed.breadcrumbs).toContainEqual({
      category: "fetch",
      data: { method: "GET", url: "https://app.example.com/api" },
    });
    expect(scrubbed.breadcrumbs).toContainEqual({
      category: "navigation",
      data: { from: "/portal/accept", to: "/onboarding" },
    });
  });

  it("keeps only user.id", () => {
    expect(scrubEvent(event).user).toEqual({ id: "user_1" });
  });

  it("drops a console breadcrumb carrying an address and keeps the rest", () => {
    expect(scrubEvent(event).breadcrumbs).toEqual([
      { category: "console", message: "cache warm" },
      { category: "fetch", message: "GET /api" },
      {
        category: "fetch",
        data: { method: "GET", url: "https://app.example.com/api" },
      },
      {
        category: "navigation",
        data: { from: "/portal/accept", to: "/onboarding" },
      },
    ]);
  });

  it("keeps the org_id tag and the message", () => {
    const scrubbed = scrubEvent(event);

    expect(scrubbed.tags).toEqual({ org_id: "org_1", runtime: "node" });
    expect(scrubbed.message).toBe("boom");
  });

  it("leaves an event with none of those fields untouched", () => {
    const bare: ErrorEvent = { type: undefined, message: "x" };

    expect(scrubEvent(bare)).toEqual(bare);
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(event);
    scrubEvent(event);
    expect(JSON.stringify(event)).toBe(before);
  });
});
