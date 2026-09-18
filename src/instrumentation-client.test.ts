/**
 * @vitest-environment node
 *
 * covers: spec 0019 AC-1, AC-2, AC-5
 *
 * `sentryOptions` has its own tests in `src/observability/sentry-options.test.ts`;
 * what this file adds on top is the client only replay wiring, so that is
 * what is under test here. The module runs `Sentry.init` at import time, so
 * every case resets the module registry and re-imports it fresh.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  lazyLoadIntegration: vi.fn(),
  addIntegration: vi.fn(),
  replayIntegration: vi.fn((options: unknown) => ({ __replay: options })),
  captureRouterTransitionStart: vi.fn(),
  sentryOptions: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  init: mocks.init,
  lazyLoadIntegration: mocks.lazyLoadIntegration,
  addIntegration: mocks.addIntegration,
  captureRouterTransitionStart: mocks.captureRouterTransitionStart,
}));

vi.mock("@/observability/sentry-options", () => ({
  sentryOptions: mocks.sentryOptions,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.sentryOptions.mockReturnValue({ enabled: false });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("instrumentation-client", () => {
  it("reads the two NEXT_PUBLIC_ variables and asks for the browser runtime", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://key@o0.ingest.sentry.io/0");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", "abc123");

    await import("./instrumentation-client");

    expect(mocks.sentryOptions).toHaveBeenCalledWith("browser", {
      dsn: "https://key@o0.ingest.sentry.io/0",
      vercelEnv: "preview",
      commitSha: "abc123",
    });
  });

  it("initialises with the shared options plus a client only replay sample rate", async () => {
    mocks.sentryOptions.mockReturnValue({ enabled: false, dsn: undefined });

    await import("./instrumentation-client");

    expect(mocks.init).toHaveBeenCalledWith({
      enabled: false,
      dsn: undefined,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1,
    });
  });

  it("never lazy loads Replay when Sentry is disabled", async () => {
    mocks.sentryOptions.mockReturnValue({ enabled: false });

    await import("./instrumentation-client");

    expect(mocks.lazyLoadIntegration).not.toHaveBeenCalled();
  });

  it("lazy loads Replay, masked, once Sentry is enabled", async () => {
    mocks.sentryOptions.mockReturnValue({ enabled: true });
    mocks.lazyLoadIntegration.mockResolvedValue(mocks.replayIntegration);

    await import("./instrumentation-client");

    await vi.waitFor(() => {
      expect(mocks.addIntegration).toHaveBeenCalled();
    });

    expect(mocks.lazyLoadIntegration).toHaveBeenCalledWith("replayIntegration");
    expect(mocks.replayIntegration).toHaveBeenCalledWith({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    });
  });

  it("never throws when Replay fails to load", async () => {
    mocks.sentryOptions.mockReturnValue({ enabled: true });
    mocks.lazyLoadIntegration.mockRejectedValue(new Error("chunk failed"));

    await expect(import("./instrumentation-client")).resolves.toBeDefined();
  });

  it("exports Sentry's own router transition hook", async () => {
    const mod = await import("./instrumentation-client");

    expect(mod.onRouterTransitionStart).toBe(
      mocks.captureRouterTransitionStart,
    );
  });
});
