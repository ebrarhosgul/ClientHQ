/**
 * @vitest-environment node
 *
 * covers: spec 0019 AC-23
 *
 * Every value is optional and read straight from `process.env`, on purpose
 * (see the file's own docblock): observability being off must never crash a
 * process that has not configured the rest of the environment. `env.ts`'s
 * own test proves the eleven variables are named in the schema; this is the
 * fallback behaviour on top.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { observabilityEnv } from "./observability-env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("observabilityEnv", () => {
  it("is all undefined, with the EU PostHog default host, when nothing is set", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "");
    vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "");
    vi.stubEnv("POSTHOG_PROJECT_ID", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");

    const env = observabilityEnv();

    expect(env.sentryDsn).toBeUndefined();
    expect(env.posthogKey).toBeUndefined();
    expect(env.posthogHost).toBe("https://eu.i.posthog.com");
    expect(env.posthogPersonalApiKey).toBeUndefined();
    expect(env.posthogProjectId).toBeUndefined();
    expect(env.vercelEnv).toBeUndefined();
    expect(env.commitSha).toBeUndefined();
  });

  it("reads every value that is set", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://key@o0.ingest.sentry.io/0");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://custom.posthog.test");
    vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "phx_test");
    vi.stubEnv("POSTHOG_PROJECT_ID", "12345");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc123");

    expect(observabilityEnv()).toMatchObject({
      sentryDsn: "https://key@o0.ingest.sentry.io/0",
      posthogKey: "phc_test",
      posthogHost: "https://custom.posthog.test",
      posthogPersonalApiKey: "phx_test",
      posthogProjectId: "12345",
      vercelEnv: "preview",
      commitSha: "abc123",
    });
  });

  it("reads nodeEnv straight from the environment", () => {
    expect(observabilityEnv().nodeEnv).toBe("test");
  });
});
