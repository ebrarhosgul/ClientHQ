/**
 * @vitest-environment node
 *
 * covers: spec 0019 AC-4, AC-6, AC-21
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: true,
  setTag: vi.fn(),
  setUser: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  setTag: mocks.setTag,
  setUser: mocks.setUser,
  captureMessage: mocks.captureMessage,
  captureException: mocks.captureException,
}));

vi.mock("./configured", () => ({
  isSentryConfigured: () => mocks.configured,
}));

const { reportException, reportSignal, setTenantScope } =
  await import("./sentry");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured = true;
});

describe("when Sentry is not configured", () => {
  it("makes no SDK call at all", () => {
    mocks.configured = false;

    setTenantScope({ orgId: "org_1", clerkUserId: "clerk_1" });
    reportSignal("access.invariant", { level: "error", fingerprint: ["x"] });
    reportException(new Error("boom"), { fingerprint: ["x"] });

    expect(mocks.setTag).not.toHaveBeenCalled();
    expect(mocks.captureMessage).not.toHaveBeenCalled();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });
});

describe("setTenantScope", () => {
  it("stamps org_id and the Clerk user id", () => {
    setTenantScope({ orgId: "org_1", clerkUserId: "clerk_1" });

    expect(mocks.setTag).toHaveBeenCalledWith("org_id", "org_1");
    expect(mocks.setUser).toHaveBeenCalledWith({ id: "clerk_1" });
  });

  it("never throws into its caller when the SDK call itself throws", () => {
    mocks.setTag.mockImplementation(() => {
      throw new Error("SDK is unhappy");
    });

    expect(() =>
      setTenantScope({ orgId: "org_1", clerkUserId: "clerk_1" }),
    ).not.toThrow();
  });
});

describe("reportSignal", () => {
  it("passes the level, tags, extra and fingerprint through", () => {
    reportSignal("cron.sweep_failed: clerk_reconcile", {
      level: "error",
      tags: { org_id: "org_1" },
      extra: { sweep: "clerk_reconcile" },
      fingerprint: ["cron.sweep_failed", "clerk_reconcile"],
    });

    expect(mocks.captureMessage).toHaveBeenCalledWith(
      "cron.sweep_failed: clerk_reconcile",
      {
        level: "error",
        tags: { org_id: "org_1" },
        extra: { sweep: "clerk_reconcile" },
        fingerprint: ["cron.sweep_failed", "clerk_reconcile"],
      },
    );
  });

  it("drops a tag whose value is undefined rather than sending it", () => {
    reportSignal("cron.sweep_failed", {
      level: "warning",
      tags: { org_id: undefined },
      fingerprint: ["cron.sweep_failed"],
    });

    expect(mocks.captureMessage).toHaveBeenCalledWith(
      "cron.sweep_failed",
      expect.objectContaining({ tags: undefined }),
    );
  });

  it("sends undefined rather than an empty object when there are no tags or extra at all", () => {
    reportSignal("access.invariant", {
      level: "error",
      fingerprint: ["access.invariant"],
    });

    expect(mocks.captureMessage).toHaveBeenCalledWith(
      "access.invariant",
      expect.objectContaining({ tags: undefined, extra: undefined }),
    );
  });

  it("never throws into its caller when the SDK call itself throws", () => {
    mocks.captureMessage.mockImplementation(() => {
      throw new Error("SDK is unhappy");
    });

    expect(() =>
      reportSignal("access.invariant", {
        level: "error",
        fingerprint: ["x"],
      }),
    ).not.toThrow();
  });
});

describe("reportException", () => {
  it("captures the thrown value with tags and fingerprint, no level", () => {
    const error = new Error("stuck past_due");

    reportException(error, {
      tags: { org_id: "org_1" },
      fingerprint: ["access.invariant"],
    });

    expect(mocks.captureException).toHaveBeenCalledWith(error, {
      tags: { org_id: "org_1" },
      fingerprint: ["access.invariant"],
    });
  });

  it("never throws into its caller when the SDK call itself throws", () => {
    mocks.captureException.mockImplementation(() => {
      throw new Error("SDK is unhappy");
    });

    expect(() =>
      reportException(new Error("boom"), { fingerprint: ["x"] }),
    ).not.toThrow();
  });
});
