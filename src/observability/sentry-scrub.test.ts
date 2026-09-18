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
      url: "https://app.example.com/invoices/1",
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
    ],
  };

  it("removes headers, cookies, body and query string but keeps url and method", () => {
    const scrubbed = scrubEvent(event);

    expect(scrubbed.request).toEqual({
      url: "https://app.example.com/invoices/1",
      method: "POST",
    });
  });

  it("keeps only user.id", () => {
    expect(scrubEvent(event).user).toEqual({ id: "user_1" });
  });

  it("drops a console breadcrumb carrying an address and keeps the rest", () => {
    expect(scrubEvent(event).breadcrumbs).toEqual([
      { category: "console", message: "cache warm" },
      { category: "fetch", message: "GET /api" },
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
