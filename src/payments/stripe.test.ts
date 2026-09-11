/**
 * @vitest-environment node
 *
 * covers: spec 0007 build plan task 2, the pinned API version
 *
 * The client is built with the version this code was written against, from the
 * secret in the environment, and once only. The pin is the point: an account
 * whose default version moves in the dashboard must not reshape the payloads a
 * deployed build reads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructed: [] as { key: string; config: Record<string, unknown> }[],
}));

vi.mock("stripe", () => ({
  default: class FakeStripe {
    constructor(key: string, config: Record<string, unknown>) {
      mocks.constructed.push({ key, config });
    }
  },
}));

vi.mock("@/lib/env", () => ({
  env: () => ({ STRIPE_SECRET_KEY: "sk_test_from_env" }),
}));

beforeEach(() => {
  vi.resetModules();
  mocks.constructed.length = 0;
});

describe("stripeClient", () => {
  it("pins the API version and names the app, so a dashboard default never reshapes payloads", async () => {
    const { stripeClient, STRIPE_API_VERSION } = await import("./stripe");

    stripeClient();

    expect(mocks.constructed).toHaveLength(1);
    expect(mocks.constructed[0]?.config).toMatchObject({
      apiVersion: STRIPE_API_VERSION,
      appInfo: { name: "ClientHQ" },
    });
    expect(STRIPE_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\./);
  });

  it("reads the secret key from the validated environment, not process.env", async () => {
    const { stripeClient } = await import("./stripe");

    stripeClient();

    expect(mocks.constructed[0]?.key).toBe("sk_test_from_env");
  });

  it("builds the client once and hands back the same one after that", async () => {
    const { stripeClient } = await import("./stripe");

    const first = stripeClient();
    const second = stripeClient();

    expect(second).toBe(first);
    expect(mocks.constructed).toHaveLength(1);
  });

  it("constructs nothing on import, so importing the module needs no secret", async () => {
    await import("./stripe");

    expect(mocks.constructed).toHaveLength(0);
  });
});
