// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  isUnsampledTransaction,
  sentryOptions,
  TRACES_SAMPLE_RATE,
  tracesSampler,
} from "./sentry-options";

describe("tracesSampler (spec 0019, AC-5)", () => {
  it("returns 0 for the cron and webhook routes, with or without a method", () => {
    expect(tracesSampler({ name: "/api/cron/daily" })).toBe(0);
    expect(tracesSampler({ name: "GET /api/cron/daily" })).toBe(0);
    expect(tracesSampler({ name: "POST /api/webhooks/stripe" })).toBe(0);
    expect(tracesSampler({ name: "/api/webhooks/clerk" })).toBe(0);
  });

  it("returns the fixed rate everywhere else", () => {
    expect(tracesSampler({ name: "GET /dashboard" })).toBe(TRACES_SAMPLE_RATE);
    expect(tracesSampler({ name: "POST /invoices/1" })).toBe(0.1);
    expect(isUnsampledTransaction("/api/health/db")).toBe(false);
  });
});

describe("sentryOptions", () => {
  it("tags the runtime, sets environment and release, and never passes dataCollection", () => {
    const options = sentryOptions("edge", {
      dsn: "https://k@o.ingest.sentry.io/1",
      vercelEnv: "preview",
      commitSha: "abc123",
    });

    expect(options.enabled).toBe(true);
    expect(options.environment).toBe("preview");
    expect(options.release).toBe("abc123");
    expect(options.initialScope.tags.runtime).toBe("edge");
    expect(options.tracesSampleRate).toBe(0.1);
    expect("dataCollection" in options).toBe(false);
    expect("sendDefaultPii" in options).toBe(false);
  });

  it("is disabled with no DSN or outside production and preview", () => {
    expect(
      sentryOptions("node", {
        dsn: undefined,
        vercelEnv: "production",
        commitSha: undefined,
      }).enabled,
    ).toBe(false);
    expect(
      sentryOptions("node", {
        dsn: "https://k@o/1",
        vercelEnv: undefined,
        commitSha: undefined,
      }).enabled,
    ).toBe(false);
  });
});
