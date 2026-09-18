/**
 * @vitest-environment node
 *
 * covers: spec 0019 AC-20, AC-21
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    sentryDsn: undefined as string | undefined,
    posthogKey: undefined as string | undefined,
    posthogHost: "https://eu.i.posthog.com",
    posthogPersonalApiKey: undefined as string | undefined,
    posthogProjectId: undefined as string | undefined,
    vercelEnv: undefined as string | undefined,
    commitSha: undefined as string | undefined,
    nodeEnv: undefined as string | undefined,
  },
  logObservabilityUnconfigured: vi.fn(),
}));

vi.mock("@/lib/observability-env", () => ({
  observabilityEnv: () => mocks.env,
}));

vi.mock("./log", () => ({
  logObservabilityUnconfigured: mocks.logObservabilityUnconfigured,
}));

const {
  isAnalyticsConfigured,
  isErasureConfigured,
  isSentryConfigured,
  resetUnconfiguredReportForTests,
} = await import("./configured");

beforeEach(() => {
  vi.clearAllMocks();
  resetUnconfiguredReportForTests();
  mocks.env.sentryDsn = undefined;
  mocks.env.posthogKey = undefined;
  mocks.env.posthogPersonalApiKey = undefined;
  mocks.env.posthogProjectId = undefined;
  mocks.env.nodeEnv = undefined;
});

describe("isSentryConfigured / isAnalyticsConfigured", () => {
  it("is false without the key, true with one", () => {
    expect(isSentryConfigured()).toBe(false);
    mocks.env.sentryDsn = "https://key@o0.ingest.sentry.io/0";
    expect(isSentryConfigured()).toBe(true);

    expect(isAnalyticsConfigured()).toBe(false);
    mocks.env.posthogKey = "phc_test";
    expect(isAnalyticsConfigured()).toBe(true);
  });
});

describe("isErasureConfigured", () => {
  it("needs both the personal key and the project id", () => {
    expect(isErasureConfigured()).toBe(false);

    mocks.env.posthogPersonalApiKey = "phx_test";
    expect(isErasureConfigured()).toBe(false);

    mocks.env.posthogProjectId = "12345";
    expect(isErasureConfigured()).toBe(true);
  });

  it("never writes the unconfigured log line, even in production", () => {
    mocks.env.nodeEnv = "production";

    isErasureConfigured();

    expect(mocks.logObservabilityUnconfigured).not.toHaveBeenCalled();
  });
});

describe("the one time unconfigured line", () => {
  it("says nothing outside production", () => {
    mocks.env.nodeEnv = "test";

    isSentryConfigured();

    expect(mocks.logObservabilityUnconfigured).not.toHaveBeenCalled();
  });

  it("names both missing keys once, in production, with neither set", () => {
    mocks.env.nodeEnv = "production";

    isSentryConfigured();

    expect(mocks.logObservabilityUnconfigured).toHaveBeenCalledTimes(1);
    expect(mocks.logObservabilityUnconfigured).toHaveBeenCalledWith([
      "NEXT_PUBLIC_SENTRY_DSN",
      "NEXT_PUBLIC_POSTHOG_KEY",
    ]);
  });

  it("says nothing a second time in the same process", () => {
    mocks.env.nodeEnv = "production";

    isSentryConfigured();
    isAnalyticsConfigured();

    expect(mocks.logObservabilityUnconfigured).toHaveBeenCalledTimes(1);
  });

  it("says nothing at all once both keys are set", () => {
    mocks.env.nodeEnv = "production";
    mocks.env.sentryDsn = "https://key@o0.ingest.sentry.io/0";
    mocks.env.posthogKey = "phc_test";

    isSentryConfigured();

    expect(mocks.logObservabilityUnconfigured).not.toHaveBeenCalled();
  });
});
