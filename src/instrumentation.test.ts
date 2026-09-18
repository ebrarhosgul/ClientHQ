/**
 * @vitest-environment node
 *
 * covers: spec 0019 AC-1
 *
 * `register()` runs once per server instance and loads whichever config the
 * runtime calls for. Each case resets the module registry so the dynamic
 * `import()` inside `register()` re-resolves against a fresh mock rather
 * than a cached one from an earlier case in this file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureRequestError: vi.fn(),
}));
const serverConfig = vi.hoisted(() => vi.fn());
const edgeConfig = vi.hoisted(() => vi.fn());

vi.mock("@sentry/nextjs", () => ({
  captureRequestError: mocks.captureRequestError,
}));

vi.mock("../sentry.server.config", () => {
  serverConfig();
  return {};
});

vi.mock("../sentry.edge.config", () => {
  edgeConfig();
  return {};
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("register", () => {
  it("loads the Node config in the nodejs runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { register } = await import("./instrumentation");

    await register();

    expect(serverConfig).toHaveBeenCalledTimes(1);
    expect(edgeConfig).not.toHaveBeenCalled();
  });

  it("loads the edge config in the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const { register } = await import("./instrumentation");

    await register();

    expect(edgeConfig).toHaveBeenCalledTimes(1);
    expect(serverConfig).not.toHaveBeenCalled();
  });

  it("loads neither config outside those two runtimes", async () => {
    vi.stubEnv("NEXT_RUNTIME", "");
    const { register } = await import("./instrumentation");

    await register();

    expect(serverConfig).not.toHaveBeenCalled();
    expect(edgeConfig).not.toHaveBeenCalled();
  });
});

describe("onRequestError", () => {
  it("is Sentry's own request error handler", async () => {
    const { onRequestError } = await import("./instrumentation");

    expect(onRequestError).toBe(mocks.captureRequestError);
  });
});
