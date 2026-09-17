/**
 * @vitest-environment node
 *
 * covers: spec 0015 AC-15, AC-16
 *
 * The route is the thin end of the Clerk webhook: it opens the unscoped
 * handle through `withSystemAccess`, hands the untouched request and a live
 * gateway to `handleClerkWebhook`, and turns the result into a status. The
 * verification, ledger and rollback behaviour is proven in
 * `src/auth/webhook.db.test.ts`; this file proves the wiring, on the shape
 * of `src/app/api/webhooks/stripe/route.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withSystemAccess: vi.fn(),
  handleClerkWebhook: vi.fn(),
  liveClerkGateway: vi.fn(),
}));

/** A database handle that fails loudly on any property access. */
const untouchableDb = new Proxy(
  {},
  {
    get: (_, property) => {
      throw new Error(
        `the database was touched (${String(property)}) on an unscoped call`,
      );
    },
  },
);

vi.mock("@/db/tenant/system", () => ({
  withSystemAccess: mocks.withSystemAccess,
}));

vi.mock("@/auth/clerk", () => ({
  liveClerkGateway: mocks.liveClerkGateway,
}));

vi.mock("@/auth/webhook", () => ({
  handleClerkWebhook: mocks.handleClerkWebhook,
}));

const route = await import("./route");

function request(): Request {
  return new Request("http://localhost/api/webhooks/clerk", {
    method: "POST",
    body: "{}",
  });
}

const gatewayMarker = { marker: "live clerk gateway" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.liveClerkGateway.mockReturnValue(gatewayMarker);
  mocks.withSystemAccess.mockImplementation(
    async (_reason: string, fn: (db: unknown) => Promise<unknown>) =>
      fn(untouchableDb),
  );
  mocks.handleClerkWebhook.mockResolvedValue({
    status: 200,
    outcome: "handled",
    reason: "applied",
  });
});

describe("route configuration (AC-15)", () => {
  it("is never prerendered and runs on Node, where the driver and raw body both work", () => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.runtime).toBe("nodejs");
  });
});

describe("the unscoped handle", () => {
  it("opens it with a reason that says why there is no tenant to scope to", async () => {
    await route.POST(request() as never);

    expect(mocks.withSystemAccess).toHaveBeenCalledTimes(1);
    const [reason] = mocks.withSystemAccess.mock.calls[0] as [string];
    expect(reason).toMatch(/clerk webhook/);
    expect(reason.trim()).not.toBe("");
  });

  it("passes the handle it was given straight to the handler", async () => {
    const handle = { marker: "system handle" };
    mocks.withSystemAccess.mockImplementation(
      async (_reason: string, fn: (db: unknown) => Promise<unknown>) =>
        fn(handle),
    );

    await route.POST(request() as never);

    expect(mocks.handleClerkWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ db: handle }),
    );
  });
});

describe("the request and the gateway", () => {
  it("hands the handler the live gateway", async () => {
    await route.POST(request() as never);

    expect(mocks.liveClerkGateway).toHaveBeenCalledTimes(1);
    expect(mocks.handleClerkWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ gateway: gatewayMarker }),
    );
  });

  it("hands the handler the request untouched, never re reading its body first", async () => {
    const req = request();

    await route.POST(req as never);

    expect(mocks.handleClerkWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ request: req }),
    );
  });
});

describe("the answer Clerk reads", () => {
  it.each([
    [200, "handled"],
    [200, "duplicate"],
    [200, "refused"],
    [200, "ignored"],
    [400, "unverified"],
    [500, "failed"],
  ] as const)("returns %i for a %s outcome", async (status, outcome) => {
    mocks.handleClerkWebhook.mockResolvedValue({
      status,
      outcome,
      reason: "whatever the handler said",
    });

    const response = await route.POST(request() as never);

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toStrictEqual({ outcome });
  });

  it("never puts the reason or the payload in the response body", async () => {
    mocks.handleClerkWebhook.mockResolvedValue({
      status: 500,
      outcome: "failed",
      reason: "connection to db-host-1 reset",
    });

    const response = await route.POST(request() as never);

    const text = await response.text();
    expect(text).not.toContain("db-host-1");
  });

  it("lets an unexpected throw propagate, so Clerk retries", async () => {
    mocks.handleClerkWebhook.mockRejectedValue(new Error("shapes moved"));

    await expect(route.POST(request() as never)).rejects.toThrow(
      "shapes moved",
    );
  });
});
